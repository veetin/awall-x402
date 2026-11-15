import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Credit is an append-only ledger; `identities.credit_balance` is a projection.
 * No code path writes the balance without inserting the matching `credit_ledger`
 * row in the same transaction. See docs/04-modelo-dados.md.
 *
 * Money and credits are integers or integer strings, never floats. `abuse_score`
 * and `multiplier` are the only `real` columns: they are ratios, not money.
 */

/** Who consumes the API. */
export const identities = pgTable(
  "identities",
  {
    /** `idt_` + nanoid. */
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    /** SHA-256 of the API key; never the key itself. */
    apiKeyHash: text("api_key_hash"),
    /** Stellar address when known: `G…`/`C…` (56 chars) or `M…` muxed (69). */
    wallet: text("wallet"),
    /** Hash of IP + ASN + User-Agent. */
    fingerprint: text("fingerprint"),
    /** 0..1, exponential moving average. */
    abuseScore: real("abuse_score").notNull().default(0),
    /** Materialized balance, only ever updated together with a ledger entry. */
    creditBalance: bigint("credit_balance", { mode: "bigint" }).notNull().default(sql`0`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("identities_api_key_hash_key")
      .on(table.apiKeyHash)
      .where(sql`${table.apiKeyHash} is not null`),
    uniqueIndex("identities_wallet_key")
      .on(table.wallet)
      .where(sql`${table.wallet} is not null`),
    uniqueIndex("identities_fingerprint_key")
      .on(table.fingerprint)
      .where(sql`${table.fingerprint} is not null`),
  ],
);

/** One row per request. Source of the dashboard and of the impact metric. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => identities.id),
    method: text("method").notNull(),
    /** Policy pattern that matched, not the raw path. */
    route: text("route").notNull(),
    /** Credits charged. */
    credits: integer("credits").notNull(),
    /** `allow_free` | `allow_credit` | `payment_required` | `refunded`. */
    decision: text("decision").notNull(),
    originStatus: integer("origin_status"),
    latencyMs: integer("latency_ms"),
    /** Hash of method + path + query + body, to spot duplicates. */
    requestHash: text("request_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_events_identity_created_idx").on(table.identityId, table.createdAt.desc()),
    index("usage_events_created_idx").on(table.createdAt.desc()),
  ],
);

/** Payment terms issued in a 402. Lives for 15 minutes. */
export const offers = pgTable("offers", {
  /** `ofr_` + nanoid, surfaced as `extra.offerId`. */
  id: text("id").primaryKey(),
  identityId: text("identity_id")
    .notNull()
    .references(() => identities.id),
  /** Credits the payment buys. */
  packCredits: integer("pack_credits").notNull(),
  /** Atomic units with 7 decimals (Stellar), as an integer string. */
  priceUsdcAtomic: text("price_usdc_atomic").notNull(),
  priceBrlCents: integer("price_brl_cents").notNull(),
  /** Abuse multiplier applied to the base price. */
  multiplier: real("multiplier").notNull().default(1),
  /** CAIP-2, e.g. `stellar:testnet`. */
  network: text("network").notNull(),
  /** SEP-41 token contract (`C…`) or ISO 4217 code. */
  asset: text("asset").notNull(),
  /** Receiving wallet, or `merchant` on the Pix rail. */
  payTo: text("pay_to").notNull(),
  /** `{exact,pix}`. */
  rails: text("rails").array().notNull(),
  pixChargeId: text("pix_charge_id"),
  /** Pix copy-and-paste code. */
  pixBrCode: text("pix_br_code"),
  /** `pending` | `paid` | `expired` | `canceled`. */
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Actual settlement, on either rail. */
export const payments = pgTable("payments", {
  /** `pay_` + nanoid. */
  id: text("id").primaryKey(),
  offerId: text("offer_id")
    .notNull()
    .references(() => offers.id),
  /** `exact` | `pix`. */
  rail: text("rail").notNull(),
  /** Atomic units (crypto) or centavos (Pix), as an integer string. */
  amount: text("amount").notNull(),
  asset: text("asset").notNull(),
  network: text("network").notNull(),
  /**
   * On-chain transaction hash, or `pix:<chargeId>`. The UNIQUE constraint is the
   * defense against a duplicate webhook and against a settle retry.
   */
  idempotencyKey: text("idempotency_key").notNull().unique(),
  /** Stellar hash, 64 hex characters. */
  txHash: text("tx_hash"),
  /** Payer address when there is one; empty on the Pix rail, by scheme decision. */
  payer: text("payer"),
  /** Raw `SettlementResponse`, kept for audit. */
  settleResponse: jsonb("settle_response"),
  /** `settled` | `failed` | `pending`. */
  status: text("status").notNull(),
  /** x402 error code. */
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only credit entries. `sum(delta_credits)` equals the identity balance. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => identities.id),
    /** Positive on credit, negative on debit. */
    deltaCredits: bigint("delta_credits", { mode: "bigint" }).notNull(),
    /** `grant` | `debit` | `refund` | `expiry`. */
    reason: text("reason").notNull(),
    /** Set on `grant`. */
    paymentId: text("payment_id").references(() => payments.id),
    /** Set on `debit` and `refund`. */
    usageEventId: bigint("usage_event_id", { mode: "bigint" }).references(() => usageEvents.id),
    /** Resulting balance, for cross-checking. */
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("credit_ledger_identity_id_idx").on(table.identityId, table.id.desc()),
  ],
);

export const schema = { identities, usageEvents, offers, payments, creditLedger };

export type Identity = typeof identities.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
