/**
 * Gateway the console talks to. Override with VITE_AWALL_URL at build time.
 *
 * The default is the empty string, meaning the same origin the console is
 * served from. The session cookie is `SameSite=Strict`, so it only travels on
 * same-site requests: in the compose stack Caddy serves both from one host,
 * and in development the Vite dev server proxies `/awall` to the gateway.
 */
export function gatewayUrl(): string {
  const configured = import.meta.env.VITE_AWALL_URL;
  const base = typeof configured === "string" ? configured : "";
  return base.replace(/\/$/, "");
}

/**
 * Credentials the login form starts filled in with. Set both
 * VITE_DEMO_USERNAME and VITE_DEMO_PASSWORD at build time to open the console
 * with one click, which is what a hackathon demo wants.
 *
 * The values are baked into the public bundle, so they must belong to a
 * throwaway user on a throwaway deployment. Without both variables the form
 * starts empty.
 */
export function demoCredentials(): { username: string; password: string } | null {
  const username = import.meta.env.VITE_DEMO_USERNAME;
  const password = import.meta.env.VITE_DEMO_PASSWORD;
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (username === "" || password === "") return null;
  return { username, password };
}

export async function publicGet(path: string): Promise<Response> {
  return fetch(`${gatewayUrl()}${path}`);
}

/**
 * Hand a signed payment to the gateway for one offer.
 *
 * The offer id is the capability: the browser at the checkout holds the link
 * and nothing else, so there is no API key here and none is needed. The
 * credits land on the offer's own identity, whoever posts this.
 *
 * @param offerId - Offer being paid.
 * @param payment - The `PAYMENT-SIGNATURE` value a wallet produced.
 * @returns The gateway's answer, already parsed.
 */
export async function payOffer(
  offerId: string,
  payment: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${gatewayUrl()}/awall/offers/${offerId}/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

/**
 * Call a control-plane endpoint as the signed-in operator.
 *
 * Authentication is the session cookie, which is `HttpOnly`: this code cannot
 * read it and does not need to. `credentials: "include"` is what makes the
 * browser attach it when the gateway sits on another port.
 *
 * @param path - Path under the control prefix.
 * @param init - Request options, as `fetch` takes them.
 * @returns The gateway's response, status included.
 */
export async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${gatewayUrl()}${path}`, { ...init, headers, credentials: "include" });
}

/** The operator a session names, as `GET /awall/auth/me` reports it. */
export type ConsoleUser = { id: string; username: string };

/**
 * Who the current session belongs to.
 *
 * @returns The user, or `null` when there is no session - including when the
 *   caller is holding the admin token instead, which names nobody.
 */
export async function whoami(): Promise<ConsoleUser | null> {
  const response = await admin("/awall/auth/me");
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { user?: ConsoleUser | null };
  return body.user ?? null;
}

/**
 * Sign in with a username and password.
 *
 * The password goes in the body, never in the URL, and nothing here keeps it
 * after the call. The session arrives as an `HttpOnly` cookie the gateway set,
 * so there is no token for this code to store.
 *
 * @param username - Username as typed.
 * @param password - Password as typed.
 * @returns The signed-in user, or why the attempt failed.
 */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true; user: ConsoleUser } | { ok: false; status: number }> {
  const response = await admin("/awall/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) return { ok: false, status: response.status };
  const body = (await response.json().catch(() => ({}))) as { user?: ConsoleUser };
  if (!body.user) return { ok: false, status: response.status };
  return { ok: true, user: body.user };
}

/** End the session and clear the cookie. */
export async function logout(): Promise<void> {
  await admin("/awall/auth/logout", { method: "POST" });
}

export type LiveEvent = {
  type: "request" | "payment";
  at: string;
  identityId: string;
  route?: string;
  decision?: string;
  credits?: number;
  originStatus?: number | null;
  latencyMs?: number;
  rail?: string;
  amount?: string;
  asset?: string;
  creditedCredits?: number;
  transaction?: string;
};

/**
 * Mint a single-use ticket for the live stream.
 *
 * `EventSource` cannot send a session cookie to another origin, so something
 * has to ride in the URL. No credential ever does: a URL ends up in the
 * gateway access log, in every proxy in front of it and in browser history.
 * This ticket is minted on an authenticated call, works once, and expires in
 * seconds.
 *
 * @returns The ticket value.
 * @throws When the gateway refuses the session or answers no ticket.
 */
export async function streamTicket(): Promise<string> {
  const response = await admin("/awall/stats/stream-ticket", { method: "POST" });
  if (!response.ok) throw new Error(`${response.status}`);
  const body: { ticket?: unknown } = await response.json();
  if (typeof body.ticket !== "string" || body.ticket.length === 0) {
    throw new Error("no_ticket");
  }
  return body.ticket;
}

/** Stream URL for a minted ticket. No credential is ever put in this URL. */
export function streamUrl(ticket: string): string {
  return `${gatewayUrl()}/awall/stats/stream?ticket=${encodeURIComponent(ticket)}`;
}

/** A page of rows, as every paged control-plane endpoint reports it. */
export type PageInfo = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};
