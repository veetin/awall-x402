import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { newConsoleSessionId, newConsoleUserId } from "./ids.js";
import { consoleSessions, consoleUsers, type ConsoleSession, type ConsoleUser } from "./schema.js";

/**
 * Persistence for the console's own users and sessions.
 *
 * Nothing here hashes anything: the password hash and the session token digest
 * arrive already computed, so the cryptographic choices live in one place in
 * the gateway and this package stays the storage layer it is everywhere else.
 */

export type CreateConsoleUserInput = {
  username: string;
  /** argon2id hash in PHC string format. This package never sees a password. */
  passwordHash: string;
};

export type CreateConsoleUserResult =
  | { ok: true; user: ConsoleUser }
  | { ok: false; reason: "username_taken" };

/** Postgres unique-violation code, which is how a taken username reports itself. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code: unknown = Reflect.get(error, "code");
  if (code === UNIQUE_VIOLATION) return true;
  // PGlite reports the same failure through a nested cause.
  const cause: unknown = Reflect.get(error, "cause");
  return cause === undefined ? false : isUniqueViolation(cause);
}

/**
 * Create a console user.
 *
 * @param db - Connection or open transaction.
 * @param input - Username and the already-computed password hash.
 * @returns The stored row, or why it was not stored.
 */
export async function createConsoleUser(
  db: Database,
  input: CreateConsoleUserInput,
): Promise<CreateConsoleUserResult> {
  const row = {
    id: newConsoleUserId(),
    username: input.username,
    passwordHash: input.passwordHash,
  };
  try {
    const [user] = await db.insert(consoleUsers).values(row).returning();
    if (!user) return { ok: false, reason: "username_taken" };
    return { ok: true, user };
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return { ok: false, reason: "username_taken" };
    throw error;
  }
}

/**
 * Read a console user by username.
 *
 * A disabled user is returned like any other: the caller still has to run the
 * password hash before it answers, so that a disabled account is no faster to
 * probe than an active one.
 *
 * @param db - Connection or open transaction.
 * @param username - Username as typed.
 * @returns The row, or `null` when no such username exists.
 */
export async function findConsoleUserByUsername(
  db: Database,
  username: string,
): Promise<ConsoleUser | null> {
  const [user] = await db
    .select()
    .from(consoleUsers)
    .where(eq(consoleUsers.username, username))
    .limit(1);
  return user ?? null;
}

/**
 * Record a successful sign-in.
 *
 * @param db - Connection or open transaction.
 * @param userId - User that signed in.
 * @param at - When the sign-in happened.
 */
export async function touchConsoleUserLogin(
  db: Database,
  userId: string,
  at: Date = new Date(),
): Promise<void> {
  await db.update(consoleUsers).set({ lastLoginAt: at }).where(eq(consoleUsers.id, userId));
}

/**
 * Revoke a user without deleting the row, and drop every session it holds.
 *
 * The audit trail keeps naming this user, so the row stays and `disabled_at`
 * carries the revocation. Live sessions go with it: a disabled user must not
 * keep working with a cookie it already has.
 *
 * @param db - Connection or open transaction.
 * @param userId - User to revoke.
 * @param at - When the revocation happened.
 * @returns Whether a user was disabled by this call.
 */
export async function disableConsoleUser(
  db: Database,
  userId: string,
  at: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const disabled = await tx
      .update(consoleUsers)
      .set({ disabledAt: at })
      .where(and(eq(consoleUsers.id, userId), isNull(consoleUsers.disabledAt)))
      .returning({ id: consoleUsers.id });
    await tx
      .update(consoleSessions)
      .set({ revokedAt: at })
      .where(and(eq(consoleSessions.userId, userId), isNull(consoleSessions.revokedAt)));
    return disabled.length > 0;
  });
}

export type CreateConsoleSessionInput = {
  userId: string;
  /** SHA-256 of the session token, hex. The clear token never arrives here. */
  tokenHash: string;
  expiresAt: Date;
};

/**
 * Open a session for a user.
 *
 * @param db - Connection or open transaction.
 * @param input - User, token digest and expiry.
 * @returns The stored row.
 */
export async function createConsoleSession(
  db: Database,
  input: CreateConsoleSessionInput,
): Promise<ConsoleSession> {
  const [session] = await db
    .insert(consoleSessions)
    .values({
      id: newConsoleSessionId(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!session) throw new Error("ledger: console session insert returned no row");
  return session;
}

/** A session that is live, together with the user holding it. */
export type ConsoleSessionActor = {
  sessionId: string;
  userId: string;
  username: string;
  expiresAt: Date;
};

/**
 * Resolve a session token digest to the user behind it.
 *
 * Expired, revoked and disabled are one answer — `null` — because the caller
 * turns all three into the same `401`. There is nothing for a client to learn
 * from which of them applied.
 *
 * @param db - Connection or open transaction.
 * @param tokenHash - SHA-256 of the token presented in the cookie, hex.
 * @param now - Current time, so a test can age a session.
 * @returns The live session and its user, or `null`.
 */
export async function findLiveConsoleSession(
  db: Database,
  tokenHash: string,
  now: Date = new Date(),
): Promise<ConsoleSessionActor | null> {
  const [row] = await db
    .select({
      sessionId: consoleSessions.id,
      userId: consoleUsers.id,
      username: consoleUsers.username,
      expiresAt: consoleSessions.expiresAt,
    })
    .from(consoleSessions)
    .innerJoin(consoleUsers, eq(consoleUsers.id, consoleSessions.userId))
    .where(
      and(
        eq(consoleSessions.tokenHash, tokenHash),
        isNull(consoleSessions.revokedAt),
        isNull(consoleUsers.disabledAt),
        sql`${consoleSessions.expiresAt} > ${now}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Revoke one session, on logout.
 *
 * @param db - Connection or open transaction.
 * @param sessionId - Session to revoke.
 * @param at - When the logout happened.
 * @returns Whether this call revoked a session that was still live.
 */
export async function revokeConsoleSession(
  db: Database,
  sessionId: string,
  at: Date = new Date(),
): Promise<boolean> {
  const revoked = await db
    .update(consoleSessions)
    .set({ revokedAt: at })
    .where(and(eq(consoleSessions.id, sessionId), isNull(consoleSessions.revokedAt)))
    .returning({ id: consoleSessions.id });
  return revoked.length > 0;
}

/**
 * Count the users that may still sign in.
 *
 * The bootstrap script reads this to tell "no users yet" from "a user exists
 * and you typed the wrong name".
 *
 * @param db - Connection or open transaction.
 * @returns How many users have no `disabled_at`.
 */
export async function countActiveConsoleUsers(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(consoleUsers)
    .where(isNull(consoleUsers.disabledAt));
  return row?.total ?? 0;
}
