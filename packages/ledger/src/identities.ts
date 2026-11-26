import { eq } from "drizzle-orm";
import type { Database } from "./db.js";
import { identities, type Identity } from "./schema.js";

export type IdentityKind = "api_key" | "wallet" | "signed_agent" | "fingerprint";

export type EnsureIdentityInput = {
  /** `idt_` + nanoid. The gateway derives it from the resolved identity. */
  id: string;
  kind: IdentityKind;
  /** SHA-256 of the API key; never the key itself. */
  apiKeyHash?: string | null;
  wallet?: string | null;
  /** Hash of IP + ASN + User-Agent. */
  fingerprint?: string | null;
  abuseScore?: number;
};

/**
 * Insert the identity on first sight, touch `last_seen_at` afterwards.
 *
 * Every other table references `identities`, so the gateway calls this before
 * recording usage or crediting a pack.
 *
 * @param db - Connection or open transaction.
 * @param input - Identity to insert or touch.
 * @returns The stored row.
 */
export async function ensureIdentity(
  db: Database,
  input: EnsureIdentityInput,
): Promise<Identity> {
  const now = new Date();
  const [row] = await db
    .insert(identities)
    .values({
      id: input.id,
      kind: input.kind,
      apiKeyHash: input.apiKeyHash ?? null,
      wallet: input.wallet ?? null,
      fingerprint: input.fingerprint ?? null,
      abuseScore: input.abuseScore ?? 0,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({ target: identities.id, set: { lastSeenAt: now } })
    .returning();
  if (!row) throw new Error(`identity upsert returned no row: ${input.id}`);
  return row;
}

/**
 * Read one identity.
 *
 * @param db - Connection or open transaction.
 * @param id - Identity id.
 * @returns The row, or `null` when unknown.
 */
export async function getIdentity(db: Database, id: string): Promise<Identity | null> {
  const [row] = await db.select().from(identities).where(eq(identities.id, id));
  return row ?? null;
}

/**
 * Persist the abuse score. Does not touch the credit balance.
 *
 * @param db - Connection or open transaction.
 * @param id - Identity id.
 * @param abuseScore - Score in [0, 1].
 */
export async function updateAbuseScore(
  db: Database,
  id: string,
  abuseScore: number,
): Promise<void> {
  const clamped = Math.min(1, Math.max(0, abuseScore));
  await db
    .update(identities)
    .set({ abuseScore: clamped, lastSeenAt: new Date() })
    .where(eq(identities.id, id));
}
