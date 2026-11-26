/** Gateway the console talks to. Override with VITE_AWALL_URL at build time. */
export function gatewayUrl(): string {
  const configured = import.meta.env.VITE_AWALL_URL;
  const base = typeof configured === "string" && configured.length > 0 ? configured : "http://127.0.0.1:8402";
  return base.replace(/\/$/, "");
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

export async function admin(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${gatewayUrl()}${path}`, { ...init, headers });
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
 * `EventSource` cannot send an `Authorization` header, so something has to ride
 * in the URL. The admin token never does: a URL ends up in the gateway access
 * log, in every proxy in front of it and in browser history. This ticket is
 * minted with the header, works once, and expires in seconds.
 *
 * @param token - Admin token, sent in the header of this request only.
 * @returns The ticket value.
 * @throws When the gateway refuses the token or answers no ticket.
 */
export async function streamTicket(token: string): Promise<string> {
  const response = await admin("/awall/stats/stream-ticket", token, { method: "POST" });
  if (!response.ok) throw new Error(`${response.status}`);
  const body: { ticket?: unknown } = await response.json();
  if (typeof body.ticket !== "string" || body.ticket.length === 0) {
    throw new Error("no_ticket");
  }
  return body.ticket;
}

/** Stream URL for a minted ticket. Never called with the admin token. */
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
