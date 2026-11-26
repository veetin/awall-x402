/** Gateway the console talks to. Override with VITE_AWALL_URL at build time. */
export function gatewayUrl(): string {
  const configured = import.meta.env.VITE_AWALL_URL;
  const base = typeof configured === "string" && configured.length > 0 ? configured : "http://127.0.0.1:8402";
  return base.replace(/\/$/, "");
}

export async function publicGet(path: string): Promise<Response> {
  return fetch(`${gatewayUrl()}${path}`);
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

export function streamUrl(token: string): string {
  return `${gatewayUrl()}/awall/stats/stream?access_token=${encodeURIComponent(token)}`;
}
