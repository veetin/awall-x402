import { and, eq, lte } from "drizzle-orm";
import type { Database } from "./db.js";
import { newOfferId } from "./ids.js";
import { offers, type Offer } from "./schema.js";

/** An offer lives for 15 minutes. */
export const OFFER_TTL_MS = 15 * 60 * 1000;

export type OfferStatus = "pending" | "paid" | "expired" | "canceled";
export type Rail = "exact" | "pix";

export type CreateOfferInput = {
  identityId: string;
  /** Credits the payment buys. */
  packCredits: number;
  /** Atomic units with 7 decimals (Stellar), as an integer string. */
  priceUsdcAtomic: string;
  priceBrlCents: number;
  /** Abuse multiplier applied to the base price. */
  multiplier: number;
  /** CAIP-2, e.g. `stellar:testnet`. */
  network: string;
  /** SEP-41 token contract (`C…`) or ISO 4217 code. */
  asset: string;
  /** Receiving wallet, or `merchant` on the Pix rail. */
  payTo: string;
  rails: Rail[];
  pixChargeId?: string | null;
  /** Pix copy-and-paste code. */
  pixBrCode?: string | null;
  /** Defaults to now + `OFFER_TTL_MS`. */
  expiresAt?: Date;
  /** Clock override, for tests. */
  now?: Date;
};

/**
 * Store the terms issued in a 402.
 *
 * The charged amount is read back from this row when the client returns with a
 * `PAYMENT-SIGNATURE`: nothing from the client decides the value.
 *
 * @param db - Connection or open transaction.
 * @param input - Terms to store.
 * @returns The stored offer, with its `ofr_` id.
 */
export async function createOffer(db: Database, input: CreateOfferInput): Promise<Offer> {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(offers)
    .values({
      id: newOfferId(),
      identityId: input.identityId,
      packCredits: input.packCredits,
      priceUsdcAtomic: input.priceUsdcAtomic,
      priceBrlCents: input.priceBrlCents,
      multiplier: input.multiplier,
      network: input.network,
      asset: input.asset,
      payTo: input.payTo,
      rails: input.rails,
      pixChargeId: input.pixChargeId ?? null,
      pixBrCode: input.pixBrCode ?? null,
      status: "pending",
      expiresAt: input.expiresAt ?? new Date(now.getTime() + OFFER_TTL_MS),
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error("offers insert returned no row");
  return row;
}

/**
 * Read an offer, expiring it first when its deadline has passed.
 *
 * Expiry is decided here, on the server, never by trusting the
 * `maxTimeoutSeconds` the client sends back.
 *
 * @param db - Connection or open transaction.
 * @param id - Offer id.
 * @param now - Clock override, for tests.
 * @returns The offer, or `null` when unknown.
 */
export async function getOffer(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<Offer | null> {
  await db
    .update(offers)
    .set({ status: "expired" })
    .where(and(eq(offers.id, id), eq(offers.status, "pending"), lte(offers.expiresAt, now)));
  const [row] = await db.select().from(offers).where(eq(offers.id, id));
  return row ?? null;
}

export type MarkOfferPaidResult =
  | { ok: true; offer: Offer }
  | { ok: false; reason: "unknown_offer"; offer: null }
  | { ok: false; reason: "not_pending"; offer: Offer };

/**
 * Move a pending offer to `paid`.
 *
 * Only a `pending` offer moves, so a replayed webhook cannot revive an expired
 * or canceled one. `grantCredits` already does this inside its own transaction;
 * this function is for the Pix flow, which confirms the charge separately.
 *
 * @param db - Connection or open transaction.
 * @param id - Offer id.
 * @returns The paid offer, or why it did not move.
 */
export async function markOfferPaid(db: Database, id: string): Promise<MarkOfferPaidResult> {
  const [updated] = await db
    .update(offers)
    .set({ status: "paid" })
    .where(and(eq(offers.id, id), eq(offers.status, "pending")))
    .returning();
  if (updated) return { ok: true, offer: updated };
  const [existing] = await db.select().from(offers).where(eq(offers.id, id));
  if (!existing) return { ok: false, reason: "unknown_offer", offer: null };
  return { ok: false, reason: "not_pending", offer: existing };
}
