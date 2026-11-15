import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { newPaymentId } from "./ids.js";
import { creditLedger, identities, offers, payments } from "./schema.js";

/** Credit amounts are whole numbers; accept either representation. */
export type CreditAmount = number | bigint;

function toCredits(value: CreditAmount, label: string): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new RangeError(`${label} must be positive`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return BigInt(value);
}

export type DebitInput = {
  identityId: string;
  /** Credits to charge. Must be positive. */
  credits: CreditAmount;
  /** `usage_events.id` of the request being charged. */
  usageEventId?: bigint | null;
};

export type DebitSuccess = { ok: true; balanceAfter: bigint; entryId: bigint };
export type DebitFailure = {
  ok: false;
  reason: "unknown_identity" | "insufficient_credits";
  /** Balance at the moment of the attempt. Zero for an unknown identity. */
  balance: bigint;
};
export type DebitResult = DebitSuccess | DebitFailure;

/**
 * Charge credits for a served request.
 *
 * Locks the identity row with `SELECT … FOR UPDATE`, so concurrent requests from
 * the same identity serialize and the balance never goes negative. On an
 * insufficient balance nothing is written and the caller emits a 402.
 *
 * @param db - Connection or open transaction.
 * @param input - Identity, credits and the usage event being charged.
 * @returns The new balance, or why the debit did not happen.
 */
export async function debitCredits(db: Database, input: DebitInput): Promise<DebitResult> {
  const amount = toCredits(input.credits, "debit amount");
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ balance: identities.creditBalance })
      .from(identities)
      .where(eq(identities.id, input.identityId))
      .for("update");
    if (!locked) return { ok: false, reason: "unknown_identity", balance: 0n };
    if (locked.balance < amount) {
      return { ok: false, reason: "insufficient_credits", balance: locked.balance };
    }
    const balanceAfter = locked.balance - amount;
    return writeEntry(tx, {
      identityId: input.identityId,
      delta: -amount,
      reason: "debit",
      usageEventId: input.usageEventId ?? null,
      paymentId: null,
      balanceAfter,
    });
  });
}

export type RefundInput = {
  identityId: string;
  /** Credits to give back. Must be positive. */
  credits: CreditAmount;
  /** `usage_events.id` of the failed request. */
  usageEventId: bigint;
};

export type RefundResult = DebitSuccess | { ok: false; reason: "unknown_identity" };

/**
 * Give credits back after the origin failed with 5xx.
 *
 * The client does not pay for our error. Written as a positive `refund` entry
 * referencing the usage event, in the same transaction as the balance update.
 *
 * @param db - Connection or open transaction.
 * @param input - Identity, credits and the usage event being refunded.
 * @returns The new balance, or why the refund did not happen.
 */
export async function refundCredits(db: Database, input: RefundInput): Promise<RefundResult> {
  const amount = toCredits(input.credits, "refund amount");
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ balance: identities.creditBalance })
      .from(identities)
      .where(eq(identities.id, input.identityId))
      .for("update");
    if (!locked) return { ok: false, reason: "unknown_identity" };
    return writeEntry(tx, {
      identityId: input.identityId,
      delta: amount,
      reason: "refund",
      usageEventId: input.usageEventId,
      paymentId: null,
      balanceAfter: locked.balance + amount,
    });
  });
}

export type GrantInput = {
  identityId: string;
  /** Offer the payment settles. Marked `paid` in the same transaction. */
  offerId: string;
  /** Credits the pack buys, normally `offers.pack_credits`. */
  credits: CreditAmount;
  payment: {
    /** `exact` | `pix`. */
    rail: "exact" | "pix";
    /** Atomic units (crypto) or centavos (Pix), as an integer string. */
    amount: string;
    asset: string;
    network: string;
    /** On-chain transaction hash, or `pix:<chargeId>`. UNIQUE in the table. */
    idempotencyKey: string;
    txHash?: string | null;
    payer?: string | null;
    /** Raw `SettlementResponse`, for audit. */
    settleResponse?: unknown;
    /** Defaults to `settled`. Only a settled payment credits the ledger. */
    status?: "settled" | "failed" | "pending";
    errorReason?: string | null;
  };
};

export type GrantResult = {
  ok: true;
  paymentId: string;
  /** False when the payment had already been processed, or did not settle. */
  credited: boolean;
  /** True when this call found the payment already recorded. */
  alreadyProcessed: boolean;
  /** Balance after the original processing of this idempotency key. */
  balanceAfter: bigint;
  /** `credit_ledger.id` of the grant, when one exists. */
  entryId: bigint | null;
};

/**
 * Credit a paid pack, exactly once per payment.
 *
 * Inserts into `payments` with `ON CONFLICT (idempotency_key) DO NOTHING`. When
 * nothing is inserted the payment was already processed: nothing is credited and
 * the result of that original processing is returned. A duplicate webhook or a
 * settle retry is therefore harmless.
 *
 * @param db - Connection or open transaction.
 * @param input - Identity, offer, credits and the settlement to record.
 * @returns The payment id, whether this call credited, and the resulting balance.
 */
export async function grantCredits(db: Database, input: GrantInput): Promise<GrantResult> {
  const amount = toCredits(input.credits, "grant amount");
  const status = input.payment.status ?? "settled";
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(payments)
      .values({
        id: newPaymentId(),
        offerId: input.offerId,
        rail: input.payment.rail,
        amount: input.payment.amount,
        asset: input.payment.asset,
        network: input.payment.network,
        idempotencyKey: input.payment.idempotencyKey,
        txHash: input.payment.txHash ?? null,
        payer: input.payment.payer ?? null,
        settleResponse: input.payment.settleResponse ?? null,
        status,
        errorReason: input.payment.errorReason ?? null,
      })
      .onConflictDoNothing({ target: payments.idempotencyKey })
      .returning({ id: payments.id });

    if (!inserted) return replayGrant(tx, input.payment.idempotencyKey);
    if (status !== "settled") {
      const balance = await balanceOf(tx, input.identityId);
      return {
        ok: true,
        paymentId: inserted.id,
        credited: false,
        alreadyProcessed: false,
        balanceAfter: balance ?? 0n,
        entryId: null,
      };
    }

    await tx
      .update(offers)
      .set({ status: "paid" })
      .where(and(eq(offers.id, input.offerId), eq(offers.status, "pending")));

    const [locked] = await tx
      .select({ balance: identities.creditBalance })
      .from(identities)
      .where(eq(identities.id, input.identityId))
      .for("update");
    if (!locked) throw new Error(`unknown identity: ${input.identityId}`);

    const entry = await writeEntry(tx, {
      identityId: input.identityId,
      delta: amount,
      reason: "grant",
      usageEventId: null,
      paymentId: inserted.id,
      balanceAfter: locked.balance + amount,
    });
    return {
      ok: true,
      paymentId: inserted.id,
      credited: true,
      alreadyProcessed: false,
      balanceAfter: entry.balanceAfter,
      entryId: entry.entryId,
    };
  });
}

/** Read back what the first call with this idempotency key produced. */
async function replayGrant(tx: Database, idempotencyKey: string): Promise<GrantResult> {
  const [existing] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey));
  if (!existing) throw new Error(`payment vanished for idempotency key: ${idempotencyKey}`);
  const [entry] = await tx
    .select({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter })
    .from(creditLedger)
    .where(eq(creditLedger.paymentId, existing.id));
  return {
    ok: true,
    paymentId: existing.id,
    credited: false,
    alreadyProcessed: true,
    balanceAfter: entry?.balanceAfter ?? 0n,
    entryId: entry?.id ?? null,
  };
}

type EntryInput = {
  identityId: string;
  delta: bigint;
  reason: "grant" | "debit" | "refund" | "expiry";
  usageEventId: bigint | null;
  paymentId: string | null;
  balanceAfter: bigint;
};

/**
 * Write the balance and its ledger entry together.
 *
 * Hard rule 6: nothing writes `identities.credit_balance` without inserting the
 * matching `credit_ledger` row in the same transaction.
 */
async function writeEntry(tx: Database, entry: EntryInput): Promise<DebitSuccess> {
  await tx
    .update(identities)
    .set({ creditBalance: entry.balanceAfter, lastSeenAt: new Date() })
    .where(eq(identities.id, entry.identityId));
  const [row] = await tx
    .insert(creditLedger)
    .values({
      identityId: entry.identityId,
      deltaCredits: entry.delta,
      reason: entry.reason,
      paymentId: entry.paymentId,
      usageEventId: entry.usageEventId,
      balanceAfter: entry.balanceAfter,
    })
    .returning({ id: creditLedger.id });
  if (!row) throw new Error("credit_ledger insert returned no row");
  return { ok: true, balanceAfter: entry.balanceAfter, entryId: row.id };
}

async function balanceOf(db: Database, identityId: string): Promise<bigint | null> {
  const [row] = await db
    .select({ balance: identities.creditBalance })
    .from(identities)
    .where(eq(identities.id, identityId));
  return row?.balance ?? null;
}

/**
 * Current credit balance of an identity.
 *
 * @param db - Connection or open transaction.
 * @param identityId - Identity to read.
 * @returns The balance, or `null` when the identity is unknown.
 */
export async function getBalance(db: Database, identityId: string): Promise<bigint | null> {
  return balanceOf(db, identityId);
}

/**
 * Sum of every ledger entry of an identity.
 *
 * The ledger invariant is `ledgerSum === getBalance`. Exposed so the gateway and
 * the tests can assert it.
 *
 * @param db - Connection or open transaction.
 * @param identityId - Identity to read.
 * @returns The sum of `delta_credits`, zero when there are no entries.
 */
export async function ledgerSum(db: Database, identityId: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${creditLedger.deltaCredits}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.identityId, identityId));
  return BigInt(String(row?.total ?? "0"));
}
