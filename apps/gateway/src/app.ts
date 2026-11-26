import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  bumpUsageRollup,
  createOffer,
  debitCredits,
  ensureIdentity,
  getBalance,
  recordUsageEvent,
  refundCredits,
  updateAbuseScore,
  type Database,
  type Decision as LedgerDecision,
} from "@awall/ledger";
import {
  RouteTable,
  abuseScoreOf,
  pricedAbuseScore,
  decide,
  ignoresCacheValidators,
  initialAbuseState,
  observeAbuse,
  priceFor,
  type AbuseState,
  type BucketLimits,
  type Policy,
} from "@awall/policy";
import type { FacilitatorClient } from "@awall/settlement";
import type { AbacatePayClient } from "@awall/pix";
import {
  HEADER_PAYMENT_RESPONSE,
  paymentResponseHeader,
  settlePayment,
  type SettleSuccess,
} from "./settle.js";
import { createPixCharge, handlePixWebhook, offerStatus } from "./pix-flow.js";
import { MemoryQuota, type Quota } from "./quota.js";
import { ReservationStore } from "./reservations.js";
import { forward, isTimeout, readBody } from "./proxy.js";
import { meteredCost } from "./meter.js";
import { buildPaymentRequired, encodeHeader } from "./x402.js";
import { describeIdentity } from "./identity.js";
import { log } from "./log.js";
import {
  LiveBus,
  createPolicyHolder,
  mountControl,
  type LiveEvent,
  type PolicyHolder,
} from "./control.js";
import type { GatewayConfig } from "./config.js";

export type GatewayDeps = {
  db: Database;
  facilitator?: FacilitatorClient | null;
  pix?: AbacatePayClient | null;
  quota?: Quota;
  /** Clock override, milliseconds. */
  now?: () => number;
};

type Spend =
  | { kind: "free"; credits: number; bucketKey?: string; limits?: BucketLimits }
  | { kind: "credit"; credits: number; bucketKey: string; limits: BucketLimits };

type Reservation = {
  identityId: string;
  route: string;
  spend: Spend;
  metered: boolean;
  scope: string;
};

/**
 * Best-effort client address, used only by the fingerprint fallback.
 *
 * @param c - Request context.
 * @param trustProxy - Whether `X-Forwarded-For` may be believed.
 * @returns The client address, or `"unknown"`.
 */
function remoteAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // no socket (tests, or a non-node runtime)
  }
  return "unknown";
}

function requestHash(method: string, path: string, search: string, body?: Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(method);
  hash.update("\n");
  hash.update(path);
  hash.update(search);
  if (body && body.byteLength > 0) hash.update(body);
  return hash.digest("hex");
}

/**
 * Build the gateway application.
 *
 * @param config - Gateway configuration.
 * @param initialPolicy - Policy loaded from YAML, unless an active override exists.
 * @param deps - Ledger and the payment clients. Tests inject both.
 * @returns A Hono app, ready to serve or to drive from tests.
 */
export function createApp(config: GatewayConfig, initialPolicy: Policy, deps: GatewayDeps) {
  const db = deps.db;
  const facilitator = deps.facilitator ?? null;
  const pix = deps.pix ?? null;
  const quota = deps.quota ?? new MemoryQuota();
  const now = deps.now ?? Date.now;
  const bus = new LiveBus();
  const baseHolder = createPolicyHolder(initialPolicy);
  let table = new RouteTable(initialPolicy);
  const holder: PolicyHolder = {
    current: () => baseHolder.current(),
    source: () => baseHolder.source(),
    replace(next, source) {
      baseHolder.replace(next, source);
      table = new RouteTable(next);
    },
  };
  const abuse = new Map<string, AbuseState>();
  const reservations = new ReservationStore<Reservation>();
  const prefix = config.controlPrefix;

  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true, network: config.network }));

  mountControl(app, { db, config, holder, bus, facilitator, pix });

  app.get(`${prefix}/offers/:id`, async (c) => {
    const result = await offerStatus(db, pix, c.req.param("id"), now());
    return c.json(result.body, result.status as 200);
  });

  app.post(`${prefix}/webhooks/abacatepay`, async (c) => {
    const raw = await c.req.text();
    const result = await handlePixWebhook(db, pix, config, raw, c.req.raw.headers, new URL(c.req.url));
    return c.json(result.body, result.status as 200);
  });

  app.get(`${prefix}/decide`, (c) =>
    handle(c, {
      method: c.req.header("x-forwarded-method") ?? "GET",
      path: pathOf(c.req.header("x-forwarded-uri") ?? "/"),
      search: searchOf(c.req.header("x-forwarded-uri") ?? "/"),
      decide: true,
    }),
  );

  app.post(`${prefix}/usage`, async (c) => {
    const body = await c.req.json().catch(() => null);
    const reservationId =
      body && typeof body === "object" && typeof body.reservationId === "string"
        ? body.reservationId
        : "";
    // An expired reservation is refused exactly like an unknown one: after the
    // lifetime the edge no longer gets to decide what this request cost.
    const reservation = reservations.take(reservationId, now());
    if (!reservation) return c.json({ error: "reservation_not_found" }, 404);
    const originStatus = typeof body.originStatus === "number" ? body.originStatus : null;
    const outputTokens = typeof body.outputTokens === "number" ? body.outputTokens : null;
    const spend = reservation.spend;
    let charged = spend.credits;
    const failed = originStatus !== null && originStatus >= 500;
    if (failed) {
      if (spend.kind === "free" && spend.bucketKey && spend.limits) {
        await quota.refund(spend.bucketKey, spend.limits, spend.credits, now());
      }
      charged = 0;
    } else if (reservation.metered && outputTokens !== null) {
      charged = await applyMeter(spend, reservation.identityId, Math.max(1, Math.ceil(outputTokens)));
    }
    const eventId = await track({
      identityId: reservation.identityId,
      method: "POST",
      route: reservation.route,
      credits: charged,
      decision: charged === 0 ? "refunded" : spend.kind === "credit" ? "allow_credit" : "allow_free",
      originStatus,
      latencyMs: null,
      requestHash: reservationId,
      scope: reservation.scope,
    });
    if (spend.kind === "credit" && spend.credits > charged) {
      await refundCredits(db, {
        identityId: reservation.identityId,
        credits: spend.credits - charged,
        usageEventId: eventId,
      });
    }
    return c.json({ credits: charged, originStatus });
  });

  app.all("*", (c) => {
    const url = new URL(c.req.url);
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      return c.json({ error: "not_found" }, 404);
    }
    return handle(c, { method: c.req.method, path: url.pathname, search: url.search, decide: false });
  });

  return app;

  async function handle(
    c: Context,
    input: { method: string; path: string; search: string; decide: boolean },
  ): Promise<Response> {
    if (input.decide && c.req.header("payment-signature")) {
      return c.json(
        {
          error: "payment_signature_bypasses_forward_auth",
          hint: "Route requests that carry PAYMENT-SIGNATURE straight to the gateway. Verify and settle take longer than an auth timeout.",
        },
        400,
      );
    }

    const described = describeIdentity(c.req.raw.headers, remoteAddress(c, config.trustProxy));
    const identity = await ensureIdentity(db, described);
    let state = abuse.get(identity.id) ?? initialAbuseState(identity.abuseScore);
    const policy = holder.current();
    const decision = decide(policy, table, input.method, input.path);

    // The route is refused before any money moves. Settling first would take the
    // client's payment for a request that is then answered 404: paid and refused.
    if (decision.kind === "deny") {
      return c.json({ error: decision.reason, path: input.path }, 404);
    }

    const routeLabel = decision.route?.match ?? `${input.method} ${input.path}`;

    let settled: SettleSuccess | undefined;
    if (!input.decide && c.req.header("payment-signature")) {
      const result = await settlePayment(
        db,
        facilitator,
        c.req.header("payment-signature") ?? "",
        identity.id,
      );
      if (!result.ok) {
        rememberAbuse(
          identity.id,
          state,
          c.req.raw.headers,
          requestHash(input.method, input.path, input.search),
          null,
        );
        if (result.response) c.header(HEADER_PAYMENT_RESPONSE, paymentResponseHeader(result.response) ?? "");
        c.header("X-AWall-Identity", identity.id);
        c.header("X-AWall-Abuse-Score", abuseScoreOf(state).toFixed(2));
        log({
          msg: "payment rejected",
          identityId: identity.id,
          error: result.error,
          errorReason: result.errorReason,
        });
        return c.json({ error: result.error, errorReason: result.errorReason }, 402);
      }
      settled = result;
      bus.publish({
        type: "payment",
        at: new Date(now()).toISOString(),
        identityId: identity.id,
        rail: "exact",
        amount: result.paid.amount,
        asset: result.paid.asset,
        creditedCredits: result.offer.packCredits,
        transaction: result.response.transaction,
      });
    }

    const bodyRead = input.decide ? { ok: true as const } : await readBody(c.req.raw, config.maxBodyBytes);
    if (!bodyRead.ok) return c.json({ error: bodyRead.error }, 413);

    const hash = requestHash(input.method, input.path, input.search, bodyRead.body);
    const started = now();

    if (decision.kind === "free") {
      if (input.decide) {
        return allowHeaders(c, identity.id, state, 0, "none", null, undefined);
      }
      return proxy(c, {
        identityId: identity.id,
        state,
        route: routeLabel,
        scope: "none",
        spend: { kind: "free", credits: 0 },
        metered: false,
        hash,
        started,
        body: bodyRead.body,
        settled,
      });
    }

    const bucketKey = `${identity.id}|${decision.scope}`;
    const took = await quota.take(bucketKey, decision.limits, decision.credits, now());
    let spend: Spend;
    if (took) {
      spend = { kind: "free", credits: decision.credits, bucketKey, limits: decision.limits };
    } else {
      const debited = await debitCredits(db, { identityId: identity.id, credits: decision.credits });
      if (!debited.ok) {
        const price = priceFor(policy, pricedAbuseScore(state));
        let offer = await createOffer(db, {
          identityId: identity.id,
          packCredits: price.packCredits,
          priceUsdcAtomic: price.usdcAtomic,
          priceXlmAtomic: price.xlmAtomic,
          priceBrlCents: price.brlCents,
          multiplier: price.multiplier,
          network: config.network,
          asset: config.asset,
          xlmAsset: config.xlmAsset,
          payTo: config.payTo,
          rails: ["exact", "pix"],
        });
        offer = await createPixCharge(db, pix, offer);
        const required = buildPaymentRequired(c.req.url, offer, config, prefix);
        await track({
          identityId: identity.id,
          method: input.method,
          route: routeLabel,
          credits: decision.credits,
          decision: "payment_required",
          originStatus: null,
          latencyMs: now() - started,
          requestHash: hash,
          scope: decision.scope,
        });
        rememberAbuse(identity.id, state, c.req.raw.headers, hash, null);
        c.header("PAYMENT-REQUIRED", encodeHeader(required));
        c.header("Retry-After", "2");
        c.header("X-AWall-Identity", identity.id);
        c.header("X-AWall-Cost-Credits", String(decision.credits));
        c.header("X-AWall-Credits-Remaining", "0");
        c.header("X-AWall-Abuse-Score", abuseScoreOf(state).toFixed(2));
        c.header("X-AWall-Price-Multiplier", price.multiplier.toFixed(2));
        return c.json(required, 402);
      }
      spend = { kind: "credit", credits: decision.credits, bucketKey, limits: decision.limits };
    }

    if (input.decide) {
      const reservationId = randomBytes(16).toString("hex");
      reservations.set(
        reservationId,
        {
          identityId: identity.id,
          route: routeLabel,
          spend,
          metered: decision.metered,
          scope: decision.scope,
        },
        now(),
      );
      const remaining = await quota.remaining(bucketKey, decision.limits, now());
      return allowHeaders(c, identity.id, state, decision.credits, decision.scope, remaining, reservationId);
    }

    return proxy(c, {
      identityId: identity.id,
      state,
      route: routeLabel,
      scope: decision.scope,
      spend,
      metered: decision.metered,
      hash,
      started,
      body: bodyRead.body,
      settled,
    });
  }

  async function proxy(
    c: Context,
    input: {
      identityId: string;
      state: AbuseState;
      route: string;
      scope: string;
      spend: Spend;
      metered: boolean;
      hash: string;
      started: number;
      body?: Uint8Array;
      settled?: SettleSuccess;
    },
  ): Promise<Response> {
    const policy = holder.current();
    let response: Response;
    try {
      response = await forward(c.req.raw, policy.origin, input.body, config.originTimeoutMs);
    } catch (error) {
      if (input.spend.kind === "free" && input.spend.bucketKey && input.spend.limits) {
        await quota.refund(input.spend.bucketKey, input.spend.limits, input.spend.credits, now());
      }
      const eventId = await track({
        identityId: input.identityId,
        method: c.req.method,
        route: input.route,
        credits: 0,
        decision: "refunded",
        originStatus: null,
        latencyMs: now() - input.started,
        requestHash: input.hash,
        scope: input.scope,
      });
      if (input.spend.kind === "credit" && input.spend.credits > 0) {
        await refundCredits(db, {
          identityId: input.identityId,
          credits: input.spend.credits,
          usageEventId: eventId,
        });
      }
      rememberAbuse(input.identityId, input.state, c.req.raw.headers, input.hash, null);
      const status = isTimeout(error) ? 504 : 502;
      log({ msg: "origin failed", identityId: input.identityId, status, route: input.route });
      return c.json({ error: status === 504 ? "origin_timeout" : "origin_unreachable" }, status);
    }

    const text = await response.text();
    let charged = input.spend.credits;
    const failed = response.status >= 500;
    if (failed && input.spend.kind === "free" && input.spend.bucketKey && input.spend.limits) {
      await quota.refund(input.spend.bucketKey, input.spend.limits, input.spend.credits, now());
      charged = 0;
    } else if (failed) {
      charged = 0;
    } else if (input.metered) {
      charged = await applyMeter(input.spend, input.identityId, meteredCost(text, input.spend.credits));
    }

    const eventId = await track({
      identityId: input.identityId,
      method: c.req.method,
      route: input.route,
      credits: charged,
      decision: failed
        ? "refunded"
        : input.spend.kind === "credit" && input.spend.credits > 0
          ? "allow_credit"
          : "allow_free",
      originStatus: response.status,
      latencyMs: now() - input.started,
      requestHash: input.hash,
      scope: input.scope,
    });
    if (input.spend.kind === "credit" && input.spend.credits > charged) {
      await refundCredits(db, {
        identityId: input.identityId,
        credits: input.spend.credits - charged,
        usageEventId: eventId,
      });
    }
    rememberAbuse(input.identityId, input.state, c.req.raw.headers, input.hash, response.status);

    const headers = new Headers();
    for (const [name, value] of response.headers) headers.set(name, value);
    headers.set("X-AWall-Identity", input.identityId);
    headers.set("X-AWall-Cost-Credits", String(charged));
    headers.set("X-AWall-Abuse-Score", abuseScoreOf(abuse.get(input.identityId) ?? input.state).toFixed(2));
    headers.set("X-AWall-Latency-Ms", String(Math.max(0, now() - input.started)));
    if (input.scope !== "none" && input.spend.bucketKey && input.spend.limits) {
      headers.set("X-AWall-Quota-Scope", input.scope);
      headers.set(
        "X-AWall-Free-Remaining-Credits",
        String(await quota.remaining(input.spend.bucketKey, input.spend.limits, now())),
      );
    }
    const balance = await getBalance(db, input.identityId);
    if (balance !== null) headers.set("X-AWall-Credits-Remaining", balance.toString());
    if (input.settled) {
      const receipt = paymentResponseHeader(input.settled.response);
      if (receipt) headers.set(HEADER_PAYMENT_RESPONSE, receipt);
    }
    return new Response(text, { status: response.status, headers });
  }

  async function applyMeter(spend: Spend, identityId: string, actual: number): Promise<number> {
    if (actual === spend.credits) return actual;
    if (spend.kind === "free" && spend.bucketKey && spend.limits) {
      if (actual < spend.credits) await quota.refund(spend.bucketKey, spend.limits, spend.credits - actual, now());
      else await quota.take(spend.bucketKey, spend.limits, actual - spend.credits, now());
      return actual;
    }
    if (actual > spend.credits) {
      const extra = await debitCredits(db, { identityId, credits: actual - spend.credits });
      return extra.ok ? actual : spend.credits;
    }
    return actual;
  }

  function rememberAbuse(
    identityId: string,
    state: AbuseState,
    headers: Headers,
    hash: string,
    originStatus: number | null,
  ): void {
    const next = observeAbuse(state, {
      now: now(),
      requestHash: hash,
      originStatus,
      ignoresCacheValidators: ignoresCacheValidators(headers),
    });
    abuse.set(identityId, next);
    void updateAbuseScore(db, identityId, abuseScoreOf(next)).catch((error: unknown) => {
      log({ msg: "abuse score not saved", identityId, error: error instanceof Error ? error.message : "error" });
    });
  }

  async function track(input: {
    identityId: string;
    method: string;
    route: string;
    credits: number;
    decision: LedgerDecision;
    originStatus: number | null;
    latencyMs: number | null;
    requestHash: string;
    scope: string;
  }): Promise<bigint> {
    const stored = await recordUsageEvent(db, {
      identityId: input.identityId,
      method: input.method,
      route: input.route,
      credits: input.credits,
      decision: input.decision,
      originStatus: input.originStatus,
      latencyMs: input.latencyMs,
      requestHash: input.requestHash,
    });
    await bumpUsageRollup(db, {
      identityId: input.identityId,
      route: input.route,
      at: new Date(now()),
      credits: input.credits,
      paidCredits: input.decision === "allow_credit" ? input.credits : 0,
    });
    const event: LiveEvent = {
      type: "request",
      at: new Date(now()).toISOString(),
      identityId: input.identityId,
      route: input.route,
      decision: input.decision,
      credits: input.credits,
      originStatus: input.originStatus,
      latencyMs: input.latencyMs ?? 0,
      quotaScope: input.scope,
    };
    bus.publish(event);
    return stored.id;
  }

  function allowHeaders(
    c: Context,
    identityId: string,
    state: AbuseState,
    credits: number,
    scope: string,
    remaining: number | null,
    reservationId: string | undefined,
  ): Response {
    c.header("X-AWall-Identity", identityId);
    c.header("X-AWall-Cost-Credits", String(credits));
    c.header("X-AWall-Abuse-Score", abuseScoreOf(state).toFixed(2));
    if (scope !== "none") c.header("X-AWall-Quota-Scope", scope);
    if (remaining !== null) c.header("X-AWall-Free-Remaining-Credits", String(remaining));
    if (reservationId) c.header("X-AWall-Reservation", reservationId);
    c.status(204);
    return c.body(null);
  }
}

function pathOf(uri: string): string {
  const q = uri.indexOf("?");
  return (q === -1 ? uri : uri.slice(0, q)) || "/";
}

function searchOf(uri: string): string {
  const q = uri.indexOf("?");
  return q === -1 ? "" : uri.slice(q);
}
