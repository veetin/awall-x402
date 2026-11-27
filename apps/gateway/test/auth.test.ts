import { describe, expect, it, vi } from "vitest";
import {
  createConsoleSession,
  createConsoleUser,
  disableConsoleUser,
  findConsoleUserByUsername,
  type Database,
} from "@awall/ledger";
import { policySchema } from "@awall/policy";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { hashPassword, sessionTokenDigest, verifyPassword } from "../src/auth.js";
import { createTestDb } from "./db.js";

const config = readConfig({
  AWALL_PORT: "8402",
  STELLAR_PAY_TO: "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
  AWALL_ADMIN_TOKEN: "admin-secret",
  AWALL_CONSOLE_ORIGIN: "http://localhost:4179",
} as NodeJS.ProcessEnv);

const policy = policySchema.parse({
  origin: "http://127.0.0.1:59999",
  free_tier: { window_seconds: 60, credits: 4, burst: 0 },
  pricing: {
    pack_credits: 10000,
    price_usdc: "0.50",
    price_xlm: "5.00",
    price_brl_cents: 290,
    max_multiplier: 3,
  },
  routes: [{ match: "GET /v1/search", credits: 2 }],
});

/**
 * argon2id is memory-hard on purpose: 19 MiB and two passes per hash. Every
 * test here also starts its own PGlite, and the suite runs the files in
 * parallel, so the default five seconds is not enough headroom on a loaded
 * machine. The work is the point of the hash, not a slow test.
 */
vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = "correct horse battery staple";

/** One hash, reused across the tests that only need a stored user. */
const storedHash = hashPassword(PASSWORD);

async function seedUser(db: Database, username = "ada"): Promise<string> {
  const created = await createConsoleUser(db, { username, passwordHash: await storedHash });
  if (!created.ok) throw new Error("setup failed: username taken");
  return created.user.id;
}

function appWith(db: Database): ReturnType<typeof createApp> {
  return createApp(config, policy, { db });
}

/** Post credentials to the login endpoint. */
async function postLogin(
  app: ReturnType<typeof createApp>,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
  const response = await app.request("/awall/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    setCookie: response.headers.get("set-cookie"),
  };
}

/** The `name=value` pair a browser would send back. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

/** Sign in and return the cookie header to replay. */
async function signedInCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const login = await postLogin(app, { username: "ada", password: PASSWORD });
  expect(login.status).toBe(200);
  expect(login.setCookie).not.toBeNull();
  return cookiePair(login.setCookie ?? "");
}

describe("password hash", () => {
  it("accepts the right password and refuses a wrong one", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    // The password itself is nowhere in the stored value.
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash, so the same password stores differently", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    expect(await verifyPassword(PASSWORD, second)).toBe(true);
  });

  it("refuses a stored value that is not a hash, instead of throwing", async () => {
    for (const broken of ["", "plain-text", "$argon2id$v=19$m=19456,t=2,p=1$short$short", "$$$$$"]) {
      expect(await verifyPassword(PASSWORD, broken)).toBe(false);
    }
  });
});

describe("console login", () => {
  it("issues an HttpOnly, SameSite=Strict cookie and names the user", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    const login = await postLogin(app, { username: "ada", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body["user"]).toMatchObject({ username: "ada" });

    const cookie = login.setCookie ?? "";
    expect(cookie).toContain("awall_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    // Plain HTTP in the test, so no Secure: the flag follows the scheme.
    expect(cookie).not.toContain("Secure");
    // The token rides the cookie and the body never repeats it.
    expect(JSON.stringify(login.body)).not.toContain("awall_session");

    const me = await app.request("/awall/auth/me", { headers: { cookie: cookiePair(cookie) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ auth: "session", user: { username: "ada" } });

    // The sign-in is recorded on the user row.
    const stored = await findConsoleUserByUsername(db, "ada");
    expect(stored?.lastLoginAt).not.toBeNull();
  });

  it("marks the cookie Secure when the request arrives over HTTPS", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    const direct = await app.request("https://awall.example/awall/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "ada", password: PASSWORD }),
    });
    expect(direct.status).toBe(200);
    expect(direct.headers.get("set-cookie")).toContain("Secure");

    // Behind an edge proxy the scheme arrives in the header instead.
    const forwarded = await app.request("/awall/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ username: "ada", password: PASSWORD }),
    });
    expect(forwarded.status).toBe(200);
    expect(forwarded.headers.get("set-cookie")).toContain("Secure");
  });

  it("answers an unknown user and a wrong password identically", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    const unknown = await postLogin(app, { username: "nobody", password: PASSWORD });
    const wrong = await postLogin(app, { username: "ada", password: "not the password" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual({ error: "invalid_credentials" });
    expect(wrong.body).toEqual(unknown.body);
    expect(unknown.setCookie).toBeNull();
    expect(wrong.setCookie).toBeNull();
    // Nothing in the answer names the password or echoes the username.
    expect(JSON.stringify(unknown.body)).not.toContain("nobody");
    expect(JSON.stringify(wrong.body)).not.toContain("not the password");
  });

  it("spends the same work on an unknown user as on a wrong password", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    /** Median of three, so one scheduling hiccup does not decide the test. */
    async function median(username: string): Promise<number> {
      const samples: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        const answer = await postLogin(app, { username, password: "not the password" });
        expect(answer.status).toBe(401);
        samples.push(performance.now() - started);
      }
      return samples.sort((a, b) => a - b)[1] ?? 0;
    }

    const unknown = await median("nobody");
    const wrong = await median("ada");

    // Both paths run one argon2id hash, so neither is a quick answer.
    expect(unknown).toBeGreaterThan(5);
    expect(wrong).toBeGreaterThan(5);
    // And neither is a multiple of the other, which is what would leak.
    const ratio = unknown / wrong;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  it("refuses a body that is not a pair of strings", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    for (const body of [{}, { username: "ada" }, { username: "ada", password: 1 }, { username: "   ", password: "x" }]) {
      const answer = await postLogin(app, body);
      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ error: "invalid_body" });
    }
  });
});

describe("console session", () => {
  it("opens the control plane with the cookie alone", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);
    const cookie = await signedInCookie(app);

    const anonymous = await app.request("/awall/stats/summary");
    expect(anonymous.status).toBe(401);

    const withSession = await app.request("/awall/stats/summary", { headers: { cookie } });
    expect(withSession.status).toBe(200);
  });

  it("rejects an expired session", async () => {
    const db = await createTestDb();
    const userId = await seedUser(db);
    const app = appWith(db);
    await createConsoleSession(db, {
      userId,
      tokenHash: sessionTokenDigest("stale-token"),
      expiresAt: new Date(Date.now() - 1_000),
    });

    const answer = await app.request("/awall/stats/summary", {
      headers: { cookie: "awall_session=stale-token" },
    });
    expect(answer.status).toBe(401);
    expect(await answer.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a session after logout", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);
    const cookie = await signedInCookie(app);

    const out = await app.request("/awall/auth/logout", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    // The answer clears the cookie in the browser as well.
    expect(out.headers.get("set-cookie")).toContain("awall_session=;");

    const replay = await app.request("/awall/stats/summary", { headers: { cookie } });
    expect(replay.status).toBe(401);
  });

  it("rejects a forged cookie", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    const answer = await app.request("/awall/stats/summary", {
      headers: { cookie: "awall_session=not-a-session" },
    });
    expect(answer.status).toBe(401);
  });

  it("answers 401 on logout when there is no session to end", async () => {
    const db = await createTestDb();
    const app = appWith(db);

    const answer = await app.request("/awall/auth/logout", {
      method: "POST",
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(answer.status).toBe(401);
    expect(await answer.json()).toEqual({ error: "no_session" });
  });
});

describe("disabled console user", () => {
  it("cannot sign in, and loses the session it already holds", async () => {
    const db = await createTestDb();
    const userId = await seedUser(db);
    const app = appWith(db);
    const cookie = await signedInCookie(app);
    expect((await app.request("/awall/stats/summary", { headers: { cookie } })).status).toBe(200);

    expect(await disableConsoleUser(db, userId)).toBe(true);

    // The cookie it was already holding stops working.
    const replay = await app.request("/awall/stats/summary", { headers: { cookie } });
    expect(replay.status).toBe(401);

    // And signing in again answers like any other failed credential.
    const again = await postLogin(app, { username: "ada", password: PASSWORD });
    expect(again.status).toBe(401);
    expect(again.body).toEqual({ error: "invalid_credentials" });
    expect(again.setCookie).toBeNull();
  });
});

describe("admin token with login present", () => {
  it("keeps authenticating the control plane", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);

    const answer = await app.request("/awall/stats/summary", {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(answer.status).toBe(200);

    // It names nobody, so `/auth/me` reports the bearer and no user.
    const me = await app.request("/awall/auth/me", {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(await me.json()).toEqual({ auth: "bearer", user: null });

    const wrong = await app.request("/awall/stats/summary", {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(wrong.status).toBe(401);
  });

  it("records the session user in the audit trail, not the client's header", async () => {
    const db = await createTestDb();
    await seedUser(db);
    const app = appWith(db);
    const cookie = await signedInCookie(app);

    const purged = await app.request("/awall/maintenance/purge", {
      method: "POST",
      // A header the caller chose. The session outranks it.
      headers: { cookie, "x-awall-actor": "someone-else" },
    });
    expect(purged.status).toBe(200);

    const audit = await app.request("/awall/audit", { headers: { cookie } });
    const body = (await audit.json()) as { audit: { action: string; actor: string }[] };
    const entry = body.audit.find((row) => row.action === "purge_usage_events");
    expect(entry?.actor).toBe("ada");

    // With the bearer token there is no session, so the header is all there is.
    const withBearer = await app.request("/awall/maintenance/purge", {
      method: "POST",
      headers: { authorization: "Bearer admin-secret", "x-awall-actor": "cli" },
    });
    expect(withBearer.status).toBe(200);
    const afterBearer = await app.request("/awall/audit", { headers: { cookie } });
    const rows = (await afterBearer.json()) as { audit: { actor: string }[] };
    expect(rows.audit.some((row) => row.actor === "cli")).toBe(true);
  });
});
