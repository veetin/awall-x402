import { randomBytes } from "node:crypto";
import type { Price } from "@awall/policy";

export type Offer = {
  id: string;
  identityId: string;
  packCredits: number;
  usdcAtomic: string;
  brlCents: number;
  multiplier: number;
  status: "pending" | "paid" | "expired";
  expiresAt: number;
  createdAt: number;
};

const OFFER_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory offer store.
 *
 * Offers move to Postgres with the ledger; the schema is already specified in
 * docs/04-modelo-dados.md. Keeping them in memory here means a restart voids
 * unpaid offers, which is acceptable only before the ledger lands.
 */
export class OfferStore {
  private readonly byId = new Map<string, Offer>();

  create(identityId: string, price: Price, now: number = Date.now()): Offer {
    const offer: Offer = {
      id: `ofr_${randomBytes(12).toString("hex")}`,
      identityId,
      packCredits: price.packCredits,
      usdcAtomic: price.usdcAtomic,
      brlCents: price.brlCents,
      multiplier: price.multiplier,
      status: "pending",
      expiresAt: now + OFFER_TTL_MS,
      createdAt: now,
    };
    this.byId.set(offer.id, offer);
    return offer;
  }

  get(id: string, now: number = Date.now()): Offer | undefined {
    const offer = this.byId.get(id);
    if (!offer) return undefined;
    if (offer.status === "pending" && offer.expiresAt <= now) {
      offer.status = "expired";
    }
    return offer;
  }
}
