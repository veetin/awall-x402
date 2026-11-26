import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import type { Hono } from "hono";
import {
  getIdentity,
  listAdminAudit,
  listIdentities,
  listLedgerEntries,
  listOffers,
  listPayments,
  listPolicyVersions,
  listUsageEvents,
  listUsageRollups,
  probeDatabase,
  purgeUsageEvents,
  savePolicyVersion,
  summarizeAbuse,
  summarizeRevenue,
  summarizeUsage,
  writeAdminAudit,
  type Database,
} from "@awall/ledger";
import {
  RouteTable,
  abuseMultiplier,
  decide,
  policySchema,
  type Policy,
} from "@awall/policy";
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

/**
 * How long a stream ticket stays valid.
 *
 * `EventSource` cannot send an `Authorization` header, so the browser has to
 * put something in the URL. A URL reaches access logs, proxy logs and browser
 * history, so what travels there is this ticket and never the admin token: it
 * dies after one use and after a few seconds.
 */
export const STREAM_TICKET_TTL_MS = 30_000;

/** Tickets held at once. A console tab needs one; the rest is noise. */
const MAX_LIVE_TICKETS = 64;

/** SHA-256 of a ticket. The store keeps the digest, never the ticket itself. */
function ticketDigest(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

/**
 * Single-use tickets for the SSE stream.
 *
 * In process memory, like the live bus and the free-quota bucket: the gateway is
 * single-instance while those are, and `docs/07-producao.md` records the cut.
 */
export class StreamTicketStore {
  private readonly expiresAt = new Map<string, number>();

  /**
   * Mint a ticket. The caller has already proved it holds the admin token.
   *
   * @param now - Current epoch milliseconds.
   * @returns The ticket and how long it lasts.
   */
  issue(now: number = Date.now()): { ticket: string; expiresInMs: number } {
    this.prune(now);
    while (this.expiresAt.size >= MAX_LIVE_TICKETS) {
      const oldest = this.expiresAt.keys().next();
      if (oldest.done) break;
      this.expiresAt.delete(oldest.value);
    }
    const ticket = randomBytes(32).toString("base64url");
    this.expiresAt.set(ticketDigest(ticket), now + STREAM_TICKET_TTL_MS);
    return { ticket, expiresInMs: STREAM_TICKET_TTL_MS };
  }

  /**
   * Spend a ticket. A ticket works once, whether or not it had expired.
   *
   * @param ticket - Value read from the query string.
   * @param now - Current epoch milliseconds.
   * @returns `true` when the ticket was live.
   */
  consume(ticket: string | undefined, now: number = Date.now()): boolean {
    this.prune(now);
    if (!ticket) return false;
    const digest = ticketDigest(ticket);
    const expiresAt = this.expiresAt.get(digest);
    if (expiresAt === undefined) return false;
    this.expiresAt.delete(digest);
    return expiresAt > now;
  }

  private prune(now: number): void {
    for (const [digest, at] of this.expiresAt) {
      if (at <= now) this.expiresAt.delete(digest);
    }
  }
}

/** Largest page the control plane serves. Documented in docs/08-dashboard.md. */
export const MAX_PAGE_LIMIT = 200;
/** Page size when the caller asks for none. */
export const DEFAULT_PAGE_LIMIT = 50;

type Page = { limit: number; offset: number };

/**
 * Read `limit` and `offset` from the query string.
 *
 * Anything unparseable falls back to the default instead of answering 400: the
 * console builds these, and a bad page is not worth a failed screen.
 *
 * @param limitParam - Raw `limit` query parameter.
 * @param offsetParam - Raw `offset` query parameter.
 * @returns A limit inside `[1, MAX_PAGE_LIMIT]` and a non-negative offset.
 */
function readPage(limitParam: string | undefined, offsetParam: string | undefined): Page {
  return {
    limit: boundedInt(limitParam, DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
    offset: boundedInt(offsetParam, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Split a page of `limit + 1` rows into what to show and whether more exist.
 *
 * @param rows - Rows read with `limit + 1` as the SQL limit.
 * @param page - The requested page.
 * @returns The rows to serialize and the page descriptor for the response.
 */
function splitPage<T>(
  rows: T[],
  page: Page,
): { rows: T[]; page: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null } } {
  const hasMore = rows.length > page.limit;
  return {
    rows: hasMore ? rows.slice(0, page.limit) : rows,
    page: {
      limit: page.limit,
      offset: page.offset,
      hasMore,
      nextOffset: hasMore ? page.offset + page.limit : null,
    },
  };
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
  const streamPath = `${prefix}/stats/stream`;
  const tickets = new StreamTicketStore();

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
    if (authorized(c.req.raw.headers, deps.config.adminToken)) return next();
    // Only the stream takes a ticket, and only a ticket: the admin token never
    // travels in a query string, because a query string is logged everywhere.
    if (path === streamPath && tickets.consume(c.req.query("ticket"))) return next();
    return c.json({ error: "unauthorized" }, 401);
  });

  app.post(`${prefix}/stats/stream-ticket`, (c) => {
    const minted = tickets.issue();
    // The ticket itself is never logged, here or anywhere else.
    log({ msg: "stream ticket issued", actor: actorOf(c.req.raw.headers) });
    return c.json({ ticket: minted.ticket, expiresInMs: minted.expiresInMs });
  });

  app.get(streamPath, (c) => {
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
    const revenue = (await summarizeRevenue(deps.db, from)).map((row) => ({
      ...row,
      code: assetCode(row, deps.config),
    }));
    const byDecision: Record<string, number> = {};
    let credits = 0;
    for (const row of usage) {
      byDecision[row.decision] = row.requests;
      credits += row.credits;
    }
    // Averaged in SQL over every identity. Averaging a page would describe the
    // page and claim to describe the tenant.
    const abuse = await summarizeAbuse(deps.db);
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
        identities: abuse.identities,
        avgScore: abuse.avgScore,
        avgMultiplier: abuseMultiplier(abuse.avgScore, policy.pricing.max_multiplier),
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
    const page = readPage(c.req.query("limit"), c.req.query("offset"));
    // One row past the page, so the answer can say whether another page exists
    // instead of truncating in silence.
    const read = splitPage(await listIdentities(deps.db, page.limit + 1, page.offset), page);
    return c.json({
      identities: read.rows.map((identity) => ({
        id: identity.id,
        kind: identity.kind,
        wallet: identity.wallet,
        abuseScore: identity.abuseScore,
        multiplier: abuseMultiplier(identity.abuseScore, policy.pricing.max_multiplier),
        creditBalance: identity.creditBalance.toString(),
        firstSeenAt: identity.firstSeenAt.toISOString(),
        lastSeenAt: identity.lastSeenAt.toISOString(),
      })),
      page: read.page,
    });
  });

  app.get(`${prefix}/identities/:id`, async (c) => {
    const id = c.req.param("id");
    const policy = deps.holder.current();
    // Read the row by key. Scanning a page of identities to find one both
    // missed anybody past the page and did the work of a full table read.
    const identity = await getIdentity(deps.db, id);
    if (!identity) return c.json({ error: "identity_not_found" }, 404);
    const page = readPage(c.req.query("limit"), c.req.query("offset"));
    const ledger = splitPage(
      await listLedgerEntries(deps.db, id, page.limit + 1, page.offset),
      page,
    );
    // Receipts still come from the newest page of offers, so an identity whose
    // offers fell off that page shows none. Paging them needs an identity
    // filter in @awall/ledger and is not part of this change.
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
      ledger: ledger.rows.map(jsonSafe),
      ledgerPage: ledger.page,
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
    const policy = deps.holder.current();
    // Time the thing the field is named after. The table is built outside the
    // measurement because the request path builds it once, not per decision.
    const routes = new RouteTable(policy);
    const probe = decisionProbe(policy);
    const decisionStarted = performance.now();
    const decision = decide(policy, routes, probe.method, probe.path);
    const decisionMs = Math.round((performance.now() - decisionStarted) * 1000) / 1000;
    const database = await probeDatabase(deps.db);
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
      decision: { probe: `${probe.method} ${probe.path}`, kind: decision.kind },
      routes: policy.routes.length,
      facilitator,
      pix: deps.pix ? { status: "configured" } : { status: "not_configured" },
      payTo: deps.config.payTo ? "configured" : "missing",
      database: database.ok
        ? { status: "ok", latencyMs: database.latencyMs }
        : { status: "error", latencyMs: database.latencyMs, code: database.code },
    });
  });
}

/**
 * Pick the request the decision timing is measured on.
 *
 * The first configured route, so the number comes from this tenant's own policy
 * rather than from an invented path. Without routes, the `defaults.unmatched`
 * branch is what a request would hit anyway.
 *
 * @param policy - Policy in force.
 * @returns Method and path to hand to `decide`.
 */
function decisionProbe(policy: Policy): { method: string; path: string } {
  const [method, path] = policy.routes[0]?.match.split(/\s+/, 2) ?? [];
  if (!method || !path) return { method: "GET", path: "/" };
  return { method, path: path.endsWith("*") ? path.slice(0, -1) : path };
}

/**
 * Readable code of a revenue row's asset.
 *
 * The ledger stores the SEP-41 contract, which says nothing to a reader. The
 * console groups the cards by this code, so USDC and XLM never share a total.
 */
function assetCode(row: { rail: string; asset: string }, config: GatewayConfig): string {
  if (row.rail === "pix") return "BRL";
  if (row.asset === config.asset) return "USDC";
  if (row.asset === config.xlmAsset) return "XLM";
  return row.asset;
}

function isPublicControl(path: string, prefix: string, method: string): boolean {
  if (path === `${prefix}/offers` || path.startsWith(`${prefix}/offers/`)) return true;
  if (path === `${prefix}/webhooks/abacatepay`) return true;
  // Envoy ext_authz calls the decision route with the original path appended,
  // so the whole subtree is the same public endpoint.
  if (path === `${prefix}/decide` || path.startsWith(`${prefix}/decide/`)) return true;
  // The edge reports metered usage with a reservation id. That id is the capability.
  if (path === `${prefix}/usage` && method === "POST") return true;
  return false;
}

/**
 * Check the admin token, from the `Authorization` header alone.
 *
 * There is deliberately no query-string path: a token in a URL lands in the
 * edge access log, in the proxy log and in browser history. Browsers that
 * cannot send the header mint a ticket instead; see {@link StreamTicketStore}.
 *
 * @param headers - Request headers.
 * @param expected - `AWALL_ADMIN_TOKEN`. Empty means every route answers 401.
 * @returns Whether the caller presented the admin token.
 */
function authorized(headers: Headers, expected: string): boolean {
  if (!expected) return false;
  const header = headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const presented = header.slice(7).trim();
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
