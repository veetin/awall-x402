import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "./result.js";

/** Envelope AbacatePay sends on every webhook delivery (`apiVersion: 2`). */
export interface WebhookEnvelope {
  /** Delivery id (`log_...`), repeated across automatic retries: use it to drop duplicates. */
  readonly id: string;
  readonly event: string;
  readonly apiVersion: number;
  readonly devMode: boolean;
  readonly data: Record<string, unknown>;
}

export interface VerifiedWebhook {
  readonly envelope: WebhookEnvelope;
  /**
   * Charge id read from `data.transparent.id`, when present. It is a lookup key
   * only: the status in the body is never trusted. Confirm with `confirmPaid`.
   */
  readonly chargeId: string | null;
  /** `true` when the body signature was checked, not only the shared secret. */
  readonly signatureChecked: boolean;
}

export type WebhookErrorKind =
  | "missing_secret"
  | "secret_mismatch"
  | "missing_signature"
  | "invalid_signature"
  | "invalid_body";

export interface WebhookError {
  readonly kind: WebhookErrorKind;
  readonly message: string;
}

export interface VerifyWebhookOptions {
  /**
   * AbacatePay's body-signing key, as published in their documentation. It is
   * public and shared by all accounts, so a valid signature proves integrity,
   * not authenticity. Supply it to check `X-Webhook-Signature` as well.
   */
  readonly signatureKey?: string;
  /** Reject a delivery that carries no `X-Webhook-Signature`. Needs `signatureKey`. */
  readonly requireSignature?: boolean;
}

/**
 * Sources of the per-delivery metadata: a `Headers` object, a plain header map,
 * a query string, a `URLSearchParams`, a full URL, or several of those.
 */
export type WebhookMetadata =
  | Headers
  | URL
  | URLSearchParams
  | string
  | Readonly<Record<string, string | string[] | undefined>>
  | readonly WebhookMetadata[];

const SECRET_HEADER = "x-webhook-secret";
const SIGNATURE_HEADER = "x-webhook-signature";
const SECRET_QUERY_PARAM = "webhookSecret";

/**
 * Authenticates a webhook delivery with what AbacatePay actually offers:
 *
 * - the shared secret we registered, delivered both in the `X-Webhook-Secret`
 *   header and in the `?webhookSecret=` query parameter. This is the only value
 *   that carries authenticity, and it is a bearer secret, not a signature.
 * - optionally, `X-Webhook-Signature`: HMAC-SHA256 over the raw body, base64,
 *   keyed with AbacatePay's *public* key. It detects a mangled body; it cannot
 *   prove the sender, because the key is published.
 *
 * Passing this check never means a payment happened. See `confirmPaid`.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  headersOrQuery: WebhookMetadata,
  secret: string,
  options: VerifyWebhookOptions = {},
): Result<VerifiedWebhook, WebhookError> {
  if (secret.length === 0) {
    return err({ kind: "missing_secret", message: "no webhook secret configured" });
  }

  const presented = lookup(headersOrQuery, SECRET_HEADER, SECRET_QUERY_PARAM);
  if (presented === undefined) {
    return err({ kind: "missing_secret", message: "delivery carries no webhook secret" });
  }
  if (!constantTimeEquals(presented, secret)) {
    return err({ kind: "secret_mismatch", message: "webhook secret does not match" });
  }

  const bytes = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const signature = lookup(headersOrQuery, SIGNATURE_HEADER);
  let signatureChecked = false;

  if (options.signatureKey !== undefined && options.signatureKey.length > 0) {
    if (signature === undefined) {
      if (options.requireSignature === true) {
        return err({ kind: "missing_signature", message: "delivery carries no body signature" });
      }
    } else {
      const expected = createHmac("sha256", options.signatureKey).update(bytes).digest("base64");
      if (!constantTimeEquals(signature, expected)) {
        return err({ kind: "invalid_signature", message: "body signature does not match" });
      }
      signatureChecked = true;
    }
  } else if (options.requireSignature === true) {
    return err({
      kind: "missing_signature",
      message: "requireSignature needs a signatureKey",
    });
  }

  const envelope = parseEnvelope(bytes);
  if (!envelope.ok) return envelope;
  return ok({ envelope: envelope.value, chargeId: chargeIdOf(envelope.value), signatureChecked });
}

function parseEnvelope(bytes: Buffer): Result<WebhookEnvelope, WebhookError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return err({ kind: "invalid_body", message: "body is not valid JSON" });
  }
  if (!isRecord(parsed)) {
    return err({ kind: "invalid_body", message: "body is not a JSON object" });
  }
  const id = parsed["id"];
  const event = parsed["event"];
  const apiVersion = parsed["apiVersion"];
  const data = parsed["data"];
  if (typeof id !== "string" || typeof event !== "string") {
    return err({ kind: "invalid_body", message: "body has no id or event" });
  }
  if (typeof apiVersion !== "number") {
    return err({ kind: "invalid_body", message: "body has no apiVersion" });
  }
  return ok({
    id,
    event,
    apiVersion,
    devMode: parsed["devMode"] === true,
    data: isRecord(data) ? data : {},
  });
}

function chargeIdOf(envelope: WebhookEnvelope): string | null {
  const transparent = envelope.data["transparent"];
  if (!isRecord(transparent)) return null;
  const id = transparent["id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function lookup(source: WebhookMetadata, header: string, queryParam?: string): string | undefined {
  if (Array.isArray(source)) {
    for (const entry of source) {
      const found = lookup(entry, header, queryParam);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (source instanceof Headers) {
    return source.get(header) ?? undefined;
  }
  if (source instanceof URLSearchParams) {
    return queryParam === undefined ? undefined : (source.get(queryParam) ?? undefined);
  }
  if (source instanceof URL) {
    return queryParam === undefined ? undefined : (source.searchParams.get(queryParam) ?? undefined);
  }
  if (typeof source === "string") {
    if (queryParam === undefined) return undefined;
    const query = source.includes("?") ? source.slice(source.indexOf("?") + 1) : source;
    return new URLSearchParams(query).get(queryParam) ?? undefined;
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase() !== header) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value[0];
  }
  return undefined;
}

/**
 * Compares digests of both values so the comparison is constant time and does
 * not leak the expected length either.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
