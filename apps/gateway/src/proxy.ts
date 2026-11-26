/** Headers that must not be forwarded to the origin. */
const STRIPPED = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "payment-signature",
  "content-length",
]);

export type BodyRead =
  | { ok: true; body?: Uint8Array }
  | { ok: false; status: 413; error: "body_too_large" };

/**
 * Read the request body, refusing anything over the configured limit.
 *
 * @param request - Incoming request.
 * @param maxBytes - Maximum accepted body size.
 * @returns The bytes, or a 413.
 */
export async function readBody(request: Request, maxBytes: number): Promise<BodyRead> {
  if (request.method === "GET" || request.method === "HEAD") return { ok: true };
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    return { ok: false, status: 413, error: "body_too_large" };
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > maxBytes) return { ok: false, status: 413, error: "body_too_large" };
  return { ok: true, body };
}

/**
 * Forward a request to the origin.
 *
 * The body is passed in because the caller already read it, to hash it and to
 * enforce the size limit. A timeout becomes a thrown `TimeoutError`, which the
 * gateway turns into 504 rather than an opaque 500.
 *
 * @param request - Incoming request, used for method and headers.
 * @param origin - Base URL of the protected API.
 * @param body - Body bytes, already size-checked.
 * @param timeoutMs - How long to wait for the origin.
 * @returns The origin response.
 */
export async function forward(
  request: Request,
  origin: string,
  body: Uint8Array | undefined,
  timeoutMs: number,
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!STRIPPED.has(name.toLowerCase())) headers.set(name, value);
  }

  return fetch(target, {
    method: request.method,
    headers,
    body: body ? Buffer.from(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** True when the failure is the origin timeout, not a connection error. */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
