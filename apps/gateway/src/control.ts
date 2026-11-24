import { createHash, timingSafeEqual } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import type { Hono } from "hono";
import {
  listAdminAudit,
  listIdentities,
  listLedgerEntries,
  listOffers,
  listPayments,
  listPolicyVersions,
  listUsageEvents,
  listUsageRollups,
  purgeUsageEvents,
  savePolicyVersion,
  summarizeRevenue,
  summarizeUsage,
  writeAdminAudit,
  type Database,
} from "@awall/ledger";
import { abuseMultiplier, policySchema, type Policy } from "@awall/policy";
import { checkStellarExactSupport, type FacilitatorClient } from "@awall/settlement";
import type { AbacatePayClient } from "@awall/pix";
import type { GatewayConfig } from "./config.js";
import { log } from "./log.js";

export type LiveEvent =
  | {
      type: "request";
      at: string;
      identityId: string;
      route: string;
      decision: string;
      credits: number;
      originStatus: number | null;
      latencyMs: number;
      quotaScope: string;
    }
  | {
      type: "payment";
      at: string;
      identityId: string;
      rail: string;
      amount: string;
      asset: string;
      creditedCredits: number;
      transaction: string;
    };

export type PolicyHolder = {
  current(): Policy;
  source(): "yaml" | "override";
  replace(policy: Policy, source: "yaml" | "override"): void;
};

type Listener = (event: LiveEvent) => void;

/** In-process fan-out for the live console. One gateway process, one bus. */
export class LiveBus {
  private readonly listeners = new Set<Listener>();

  publish(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createPolicyHolder(initial: Policy): PolicyHolder {
  let policy = initial;
  let source: "yaml" | "override" = "yaml";
  return {
    current: () => policy,
    source: () => source,
    replace(next, nextSource) {
      policy = next;
      source = nextSource;
    },
  };
}

type ControlDeps = {
  db: Database;
  config: GatewayConfig;
  holder: PolicyHolder;
  bus: LiveBus;
  facilitator: FacilitatorClient | null;
  pix: AbacatePayClient | null;
};

/**
 * Mount the operator API.
 *
 * Every route here requires `AWALL_ADMIN_TOKEN`. The public offer status and
 * the Pix webhook are mounted separately and stay unauthenticated.
 *
 * @param app - Hono application.
 * @param deps - Ledger, policy and the live event bus.
 */
export function mountControl(app: Hono, deps: ControlDeps): void {
  const prefix = deps.config.controlPrefix;

  app.use(
    `${prefix}/*`,
    cors({
      origin: (origin) => {
        if (!origin) return deps.config.consoleOrigins[0] ?? "";
        return deps.config.consoleOrigins.includes(origin) ? origin : "";
      },
      allowHeaders: ["Authorization", "Content-Type", "X-AWall-Actor"],
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.use(`${prefix}/*`, async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method === "OPTIONS") return next();
    if (isPublicControl(path, prefix, c.req.method)) return next();
    if (!authorized(c.req.raw.headers, c.req.query("access_token"), deps.config.adminToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  app.get(`${prefix}/stats/stream`, (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = deps.bus.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(() => unsubscribe());
      while (true) {
        await stream.sleep(15_000);
        await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });

  app.get(`${prefix}/stats/summary`, async (c) => {
    const window = c.req.query("window") ?? "1h";
    const from = windowStart(window);
    const usage = await summarizeUsage(deps.db, from);
    const revenue = await summarizeRevenue(deps.db, from);
    const byDecision: Record<string, number> = {};
    let credits = 0;
    for (const row of usage) {
      byDecision[row.decision] = row.requests;
      credits += row.credits;
    }
    const identities = await listIdentities(deps.db, 500);
    const scores = identities.map((identity) => identity.abuseScore);
    const avgScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const policy = deps.holder.current();
    return c.json({
      window,
      from: from.toISOString(),
      requests: usage.reduce((sum, row) => sum + row.requests, 0),
      byDecision,
      recoveredRequests: byDecision["allow_credit"] ?? 0,
      credits,
      revenue,
      infra: {
        usdPerCredit: deps.config.infraUsdPerCredit,
        estimatedUsd: credits * deps.config.infraUsdPerCredit,
      },
      abuse: {
        avgScore,
        avgMultiplier: abuseMultiplier(avgScore, policy.pricing.max_multiplier),
      },
    });
  });

  app.get(`${prefix}/usage`, async (c) => {
    const rows = await listUsageEvents(deps.db, {
      from: parseDate(c.req.query("from")),
      to: parseDate(c.req.query("to")),
      identityId: c.req.query("identityId"),
      decision: c.req.query("decision"),
    });
    return c.json({ events: rows.map(jsonSafe) });
  });

  app.get(`${prefix}/usage/rollups`, async (c) => {
    const rows = await listUsageRollups(deps.db, {
      from: parseDate(c.req.query("from")),
      to: parseDate(c.req.query("to")),
      identityId: c.req.query("identityId"),
    });
    return c.json({ rollups: rows.map(jsonSafe) });
  });

  app.post(`${prefix}/maintenance/purge`, async (c) => {
    const olderThan = new Date(Date.now() - deps.config.usageRetentionMs);
    const deleted = await purgeUsageEvents(deps.db, olderThan);
    await writeAdminAudit(deps.db, {
      action: "purge_usage_events",
      actor: actorOf(c.req.raw.headers),
      payload: { olderThan: olderThan.toISOString(), deleted },
      result: "ok",
    });
    return c.json({ deleted, olderThan: olderThan.toISOString() });
  });

  app.get(`${prefix}/identities`, async (c) => {
    const policy = deps.holder.current();
    const rows = await listIdentities(deps.db);
    return c.json({
      identities: rows.map((identity) => ({
        id: identity.id,
        kind: identity.kind,
        wallet: identity.wallet,
        abuseScore: identity.abuseScore,
        multiplier: abuseMultiplier(identity.abuseScore, policy.pricing.max_multiplier),
        creditBalance: identity.creditBalance.toString(),
        firstSeenAt: identity.firstSeenAt.toISOString(),
        lastSeenAt: identity.lastSeenAt.toISOString(),
      })),
    });
  });

  app.get(`${prefix}/identities/:id`, async (c) => {
    const id = c.req.param("id");
    const policy = deps.holder.current();
    const rows = await listIdentities(deps.db, 1000);
    const identity = rows.find((row) => row.id === id);
    if (!identity) return c.json({ error: "identity_not_found" }, 404);
    const entries = await listLedgerEntries(deps.db, id);
    const ownedOffers = (await listOffers(deps.db)).filter((offer) => offer.identityId === id);
    const payments = (await listPayments(deps.db)).filter((payment) =>
      ownedOffers.some((offer) => offer.id === payment.offerId),
    );
    return c.json({
      identity: {
        id: identity.id,
        kind: identity.kind,
        wallet: identity.wallet,
        abuseScore: identity.abuseScore,
        multiplier: abuseMultiplier(identity.abuseScore, policy.pricing.max_multiplier),
        creditBalance: identity.creditBalance.toString(),
        firstSeenAt: identity.firstSeenAt.toISOString(),
        lastSeenAt: identity.lastSeenAt.toISOString(),
      },
      ledger: entries.map(jsonSafe),
      payments: payments.map(jsonSafe),
    });
  });

  app.get(`${prefix}/payments`, async (c) => {
    const status = c.req.query("status");
    const [paymentRows, offerRows] = await Promise.all([
      listPayments(deps.db, status),
      listOffers(deps.db),
    ]);
    return c.json({ payments: paymentRows.map(jsonSafe), offers: offerRows.map(jsonSafe) });
  });

  app.get(`${prefix}/policy`, async (c) => {
    const versions = await listPolicyVersions(deps.db);
    return c.json({
      source: deps.holder.source(),
      policy: deps.holder.current(),
      versions: versions.map(jsonSafe),
    });
  });

  app.put(`${prefix}/policy`, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = policySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_policy", issues: parsed.error.issues }, 400);
    }
    const actor = actorOf(c.req.raw.headers);
    const contentHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const version = await savePolicyVersion(deps.db, {
      content: parsed.data,
      contentHash,
      appliedBy: actor,
    });
    deps.holder.replace(parsed.data, "override");
    await writeAdminAudit(deps.db, {
      action: "apply_policy",
      actor,
      payload: { versionId: version.id, contentHash },
      result: "ok",
    });
    log({ msg: "policy applied", versionId: version.id, actor });
    return c.json({ version: jsonSafe(version), policy: parsed.data });
  });

  app.get(`${prefix}/audit`, async (c) => {
    const rows = await listAdminAudit(deps.db);
    return c.json({ audit: rows.map(jsonSafe) });
  });

  app.get(`${prefix}/health/checks`, async (c) => {
    const started = Date.now();
    const policy = deps.holder.current();
    const decisionMs = Date.now() - started;
    let facilitator: Record<string, unknown> = { status: "not_configured" };
    if (deps.facilitator) {
      const supported = await deps.facilitator.supported();
      if (!supported.ok) {
        facilitator = { status: "unreachable", kind: supported.failure.kind };
      } else {
        const check = checkStellarExactSupport(
          supported.value,
          deps.config.network as `${string}:${string}`,
        );
        facilitator = check.supported
          ? { status: "ok", scheme: "exact", network: deps.config.network }
          : { status: "unsupported", reason: check.reason };
      }
    }
    return c.json({
      decisionMs,
      routes: policy.routes.length,
      facilitator,
      pix: deps.pix ? { status: "configured" } : { status: "not_configured" },
      payTo: deps.config.payTo ? "configured" : "missing",
      database: "ok",
    });
  });
}

function isPublicControl(path: string, prefix: string, method: string): boolean {
  if (path === `${prefix}/offers` || path.startsWith(`${prefix}/offers/`)) return true;
  if (path === `${prefix}/webhooks/abacatepay`) return true;
  if (path === `${prefix}/decide`) return true;
  // The edge reports metered usage with a reservation id. That id is the capability.
  if (path === `${prefix}/usage` && method === "POST") return true;
  return false;
}

function authorized(headers: Headers, queryToken: string | undefined, expected: string): boolean {
  if (!expected) return false;
  const header = headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (queryToken ?? "");
  if (!presented) return false;
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function actorOf(headers: Headers): string {
  return headers.get("x-awall-actor")?.slice(0, 120) || "admin";
}

function windowStart(window: string): Date {
  const match = /^(\d+)([hd])$/.exec(window);
  const amount = match ? Number(match[1]) : 1;
  const unit = match?.[2] ?? "h";
  const ms = unit === "d" ? amount * 86_400_000 : amount * 3_600_000;
  return new Date(Date.now() - ms);
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner)),
  );
}
