import { argon2, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import {
  createConsoleSession,
  findConsoleUserByUsername,
  findLiveConsoleSession,
  touchConsoleUserLogin,
  type ConsoleSessionActor,
  type Database,
} from "@awall/ledger";

/**
 * Password and session handling for the operator console.
 *
 * Everything cryptographic about console login lives here, so there is one
 * place to read the parameters and one place to change them.
 */

/**
 * argon2id parameters.
 *
 * The OWASP baseline for argon2id: 19 MiB of memory, two passes, one lane.
 * They are written into every hash in PHC format, so raising the cost later
 * does not invalidate the hashes already stored - an old hash still verifies
 * with the cost it was made with.
 */
const ARGON2 = {
  /** Memory cost, in 1 KiB blocks. 19456 blocks is 19 MiB. */
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  /** Derived key length, in bytes. */
  tagLength: 32,
  /** Salt length, in bytes. */
  nonceLength: 16,
} as const;

/** Cookie carrying the session token. The token itself never leaves it. */
export const SESSION_COOKIE = "awall_session";

/** How long a console session lasts. A working day, then sign in again. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Bytes of entropy in a session token. */
const SESSION_TOKEN_BYTES = 32;

/** Longest password accepted, so a huge body cannot buy a long hash. */
export const MAX_PASSWORD_BYTES = 1024;

/** Longest username accepted. Matches the width of an audit trail actor. */
export const MAX_USERNAME_LENGTH = 120;

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

type Cost = {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
};

/**
 * Run argon2id.
 *
 * The asynchronous form is the one used on the request path: the synchronous
 * call would hold the event loop for the whole memory-hard derivation.
 *
 * @param password - Clear password.
 * @param nonce - Salt.
 * @param cost - Memory, passes, lanes and the output length.
 * @returns The derived key.
 */
function derive(password: string, nonce: Uint8Array, cost: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce,
        memory: cost.memory,
        passes: cost.passes,
        parallelism: cost.parallelism,
        tagLength: cost.tagLength,
      },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

/**
 * Hash a password for storage.
 *
 * @param password - Clear password. It is never logged, stored or returned.
 * @returns A PHC string: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(ARGON2.nonceLength);
  const derived = await derive(password, nonce, ARGON2);
  const params = `m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}`;
  return `$argon2id$v=19$${params}$${base64url(nonce)}$${base64url(derived)}`;
}

type ParsedHash = {
  memory: number;
  passes: number;
  parallelism: number;
  nonce: Buffer;
  tag: Buffer;
};

function parseParams(field: string): { memory: number; passes: number; parallelism: number } | null {
  const values = new Map<string, number>();
  for (const part of field.split(",")) {
    const [key, raw] = part.split("=", 2);
    if (!key || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    values.set(key, value);
  }
  const memory = values.get("m");
  const passes = values.get("t");
  const parallelism = values.get("p");
  if (memory === undefined || passes === undefined || parallelism === undefined) return null;
  return { memory, passes, parallelism };
}

/**
 * Read a stored PHC string back into its parts.
 *
 * @param stored - Value from `console_users.password_hash`.
 * @returns The parameters and digests, or `null` when the string is not one.
 */
function parseHash(stored: string): ParsedHash | null {
  const fields = stored.split("$");
  // `$argon2id$v=19$m=…$<salt>$<hash>` splits into six, the first one empty.
  if (fields.length !== 6) return null;
  if (fields[0] !== "" || fields[1] !== "argon2id" || fields[2] !== "v=19") return null;
  const params = parseParams(fields[3] ?? "");
  if (!params) return null;
  const nonce = Buffer.from(fields[4] ?? "", "base64url");
  const tag = Buffer.from(fields[5] ?? "", "base64url");
  if (nonce.byteLength < 8 || tag.byteLength < 4) return null;
  return { ...params, nonce, tag };
}

/**
 * Check a password against a stored hash, in constant time.
 *
 * The comparison is `timingSafeEqual` over equal-length digests, so a partial
 * match is no faster than no match at all.
 *
 * @param password - Clear password as typed.
 * @param stored - Value from `console_users.password_hash`.
 * @returns Whether the password produces the stored hash.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const derived = await derive(password, parsed.nonce, {
    memory: parsed.memory,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
    tagLength: parsed.tag.byteLength,
  });
  if (derived.byteLength !== parsed.tag.byteLength) return false;
  return timingSafeEqual(derived, parsed.tag);
}

/**
 * A hash to verify against when the username does not exist.
 *
 * Without it, an unknown username answers before argon2 has run and a caller
 * can time which usernames exist. The password is random bytes that nothing
 * ever types, so this hash authenticates nobody - it only costs the same work
 * the real path costs.
 */
let decoyHash: Promise<string> | null = null;

function decoy(): Promise<string> {
  decoyHash ??= hashPassword(base64url(randomBytes(32)));
  return decoyHash;
}

/** A fresh session token. Returned once, to the cookie, and never stored. */
export function newSessionToken(): string {
  return base64url(randomBytes(SESSION_TOKEN_BYTES));
}

/** SHA-256 of a session token, hex. This is what the database holds. */
export function sessionTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type LoginInput = { username: string; password: string };

export type LoginResult =
  | {
      ok: true;
      /** Clear session token, for the cookie. It is not stored anywhere. */
      token: string;
      expiresAt: Date;
      user: { id: string; username: string };
    }
  | { ok: false; reason: "invalid_credentials" };

/**
 * Sign a user in.
 *
 * Unknown username, wrong password and disabled user are one answer, and all
 * three pay for one argon2id hash: the caller learns nothing from the message,
 * the status or the time about which usernames exist. Neither the password nor
 * anything derived from it appears in the result.
 *
 * @param db - Ledger connection.
 * @param input - Username and password as typed.
 * @param now - Current time, so a test can control the expiry.
 * @returns The session to hand to the cookie, or that the credentials failed.
 */
export async function login(
  db: Database,
  input: LoginInput,
  now: Date = new Date(),
): Promise<LoginResult> {
  const found = await findConsoleUserByUsername(db, input.username);
  // No such user, or a disabled one: hash against the decoy, so the answer
  // costs the same as a wrong password for a user that does exist.
  const user = found !== null && found.disabledAt === null ? found : null;
  const against = user?.passwordHash ?? (await decoy());
  const matches = await verifyPassword(input.password, against);
  if (user === null || !matches) return { ok: false, reason: "invalid_credentials" };

  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await createConsoleSession(db, {
    userId: user.id,
    tokenHash: sessionTokenDigest(token),
    expiresAt,
  });
  await touchConsoleUserLogin(db, user.id, now);
  return { ok: true, token, expiresAt, user: { id: user.id, username: user.username } };
}

/**
 * Resolve a session cookie to the user holding it.
 *
 * @param db - Ledger connection.
 * @param token - Clear token from the cookie, or `undefined` when absent.
 * @param now - Current time, so a test can age a session.
 * @returns The live session and its user, or `null`.
 */
export async function resolveSession(
  db: Database,
  token: string | undefined,
  now: Date = new Date(),
): Promise<ConsoleSessionActor | null> {
  if (!token) return null;
  return findLiveConsoleSession(db, sessionTokenDigest(token), now);
}
