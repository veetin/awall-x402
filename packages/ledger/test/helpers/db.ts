import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  createOffer,
  ensureIdentity,
  grantCredits,
  newIdentityId,
  recordUsageEvent,
  schema,
} from "../../src/index.js";
import type { Database } from "../../src/db.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

function open() {
  return drizzle(new PGlite(), { schema });
}

/** A Drizzle connection backed by in-process PGlite. */
export type TestDb = ReturnType<typeof open>;

/**
 * Start Postgres in process with PGlite and apply the generated migrations.
 *
 * No Docker and no server: the tests run the real SQL the migration emits.
 */
export async function createTestDb(): Promise<TestDb> {
  const db = open();
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Create an identity with a starting balance, granted through the ledger. */
export async function seedIdentity(db: Database, startingCredits = 0): Promise<string> {
  const id = newIdentityId();
  await ensureIdentity(db, { id, kind: "api_key", apiKeyHash: `hash_${id}` });
  if (startingCredits > 0) {
    await grantTestCredits(db, id, startingCredits, `seed:${id}`);
  }
  return id;
}

/** Create the offer a grant needs, then credit the pack. */
export async function grantTestCredits(
  db: Database,
  identityId: string,
  credits: number,
  idempotencyKey: string,
): Promise<void> {
  const offer = await createOffer(db, {
    identityId,
    packCredits: credits,
    priceUsdcAtomic: "5000000",
    priceXlmAtomic: "50000000",
    priceBrlCents: 250,
    multiplier: 1,
    network: "stellar:testnet",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    xlmAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    payTo: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    rails: ["exact"],
  });
  await grantCredits(db, {
    identityId,
    offerId: offer.id,
    credits,
    payment: {
      rail: "exact",
      amount: offer.priceUsdcAtomic,
      asset: offer.asset,
      network: offer.network,
      idempotencyKey,
      txHash: "a".repeat(64),
      payer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    },
  });
}

/** Record a usage event, so a debit or a refund can reference it. */
export async function seedUsageEvent(
  db: Database,
  identityId: string,
  credits: number,
): Promise<bigint> {
  const event = await recordUsageEvent(db, {
    identityId,
    method: "POST",
    route: "POST /v1/*",
    credits,
    decision: "allow_credit",
    requestHash: `hash_${Math.random().toString(36).slice(2)}`,
  });
  return event.id;
}

/** Deterministic PRNG, so a failing property test is reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
