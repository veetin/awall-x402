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
]);

/**
 * Forward a request to the origin.
 *
 * @param request - Incoming request.
 * @param origin - Base URL of the protected API.
 * @returns The origin response.
 */
export async function forward(request: Request, origin: string): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!STRIPPED.has(name.toLowerCase())) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });
}
