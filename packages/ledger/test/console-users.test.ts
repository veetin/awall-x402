import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  countActiveConsoleUsers,
  createConsoleSession,
  createConsoleUser,
  disableConsoleUser,
  findConsoleUserByUsername,
  findLiveConsoleSession,
  revokeConsoleSession,
  touchConsoleUserLogin,
} from "../src/index.js";
import { createTestDb } from "./helpers/db.js";

/** Stand-in for a real password hash: this package never computes one. */
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$ZGVyaXZlZGtleWRlcml2ZWRrZXk";

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function inAnHour(): Date {
  return new Date(Date.now() + 3_600_000);
}

describe("console users", () => {
  it("stores a user and finds it by username", async () => {
    const db = await createTestDb();

    expect(await countActiveConsoleUsers(db)).toBe(0);
    const created = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.user.id.startsWith("usr_")).toBe(true);
    expect(created.user.lastLoginAt).toBeNull();
    expect(created.user.disabledAt).toBeNull();

    const found = await findConsoleUserByUsername(db, "ada");
    expect(found?.id).toBe(created.user.id);
    expect(found?.passwordHash).toBe(HASH);
    expect(await findConsoleUserByUsername(db, "nobody")).toBeNull();
    expect(await countActiveConsoleUsers(db)).toBe(1);
  });

  it("refuses a username that is taken, without throwing", async () => {
    const db = await createTestDb();
    expect((await createConsoleUser(db, { username: "ada", passwordHash: HASH })).ok).toBe(true);

    const again = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    expect(again).toEqual({ ok: false, reason: "username_taken" });
  });

  it("records the last sign-in", async () => {
    const db = await createTestDb();
    const created = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    if (!created.ok) throw new Error("setup failed");

    const at = new Date("2026-11-20T10:00:00.000Z");
    await touchConsoleUserLogin(db, created.user.id, at);
    const found = await findConsoleUserByUsername(db, "ada");
    expect(found?.lastLoginAt?.toISOString()).toBe(at.toISOString());
  });
});

describe("console sessions", () => {
  it("resolves a live session to its user", async () => {
    const db = await createTestDb();
    const created = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    if (!created.ok) throw new Error("setup failed");

    const session = await createConsoleSession(db, {
      userId: created.user.id,
      tokenHash: digest("token"),
      expiresAt: inAnHour(),
    });
    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.revokedAt).toBeNull();

    const actor = await findLiveConsoleSession(db, digest("token"));
    expect(actor).toMatchObject({ sessionId: session.id, username: "ada" });
    // A digest the store never saw resolves to nothing, like any other miss.
    expect(await findLiveConsoleSession(db, digest("other"))).toBeNull();
  });

  it("rejects an expired session", async () => {
    const db = await createTestDb();
    const created = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    if (!created.ok) throw new Error("setup failed");
    await createConsoleSession(db, {
      userId: created.user.id,
      tokenHash: digest("token"),
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(await findLiveConsoleSession(db, digest("token"))).toBeNull();
  });

  it("rejects a revoked session and revokes it only once", async () => {
    const db = await createTestDb();
    const created = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    if (!created.ok) throw new Error("setup failed");
    const session = await createConsoleSession(db, {
      userId: created.user.id,
      tokenHash: digest("token"),
      expiresAt: inAnHour(),
    });

    expect(await revokeConsoleSession(db, session.id)).toBe(true);
    expect(await findLiveConsoleSession(db, digest("token"))).toBeNull();
    // A second logout on the same cookie changes nothing.
    expect(await revokeConsoleSession(db, session.id)).toBe(false);
  });

  it("drops the sessions of a disabled user and keeps the row", async () => {
    const db = await createTestDb();
    const created = await createConsoleUser(db, { username: "ada", passwordHash: HASH });
    if (!created.ok) throw new Error("setup failed");
    await createConsoleSession(db, {
      userId: created.user.id,
      tokenHash: digest("token"),
      expiresAt: inAnHour(),
    });

    expect(await disableConsoleUser(db, created.user.id)).toBe(true);
    expect(await findLiveConsoleSession(db, digest("token"))).toBeNull();
    expect(await countActiveConsoleUsers(db)).toBe(0);

    // The row stays, so the audit trail still resolves the username.
    const found = await findConsoleUserByUsername(db, "ada");
    expect(found?.id).toBe(created.user.id);
    expect(found?.disabledAt).not.toBeNull();
    expect(await disableConsoleUser(db, created.user.id)).toBe(false);
  });
});
