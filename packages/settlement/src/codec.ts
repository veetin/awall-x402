/**
 * Base64 codec for the three x402 v2 HTTP headers.
 *
 * Encoding is trivial; decoding is the interesting half. Header bytes come from
 * the client, so `decodeHeader` never throws: garbage in gives a typed error
 * out, and the request path turns that into a 402 instead of a 500.
 */

import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettlementResponse } from "./types.js";

/** Why a header could not be read. */
export type DecodeErrorKind =
  | "empty"
  | "not_base64"
  | "not_utf8_json"
  | "not_object"
  | "shape_mismatch";

/** A header that could not be read, with enough detail to log. */
export type DecodeError = {
  kind: DecodeErrorKind;
  message: string;
};

/** Result of reading a header: a value, or a reason it could not be read. */
export type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: DecodeError };

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Encode an x402 object for a header.
 *
 * @param value - Object to carry, for example a `PaymentRequired`.
 * @returns Base64 of the UTF-8 JSON encoding.
 */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/**
 * Decode a header into a plain object, without validating its shape.
 *
 * Tolerates anything: whitespace, base64url, missing padding, truncated bytes,
 * non-JSON payloads and JSON that is not an object. None of those throw.
 *
 * @param header - Raw header value.
 * @returns The decoded object, or a typed error.
 */
export function decodeHeader(header: string): DecodeResult<Record<string, unknown>> {
  const trimmed = header.trim().replace(/\s+/g, "");
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: "empty", message: "header is empty" } };
  }

  // Accept base64url too: some clients encode headers with the URL alphabet.
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  if (!BASE64_PATTERN.test(normalized)) {
    return { ok: false, error: { kind: "not_base64", message: "header is not base64" } };
  }

  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { ok: false, error: { kind: "not_utf8_json", message: "header does not decode to JSON" } };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: { kind: "not_object", message: "header JSON is not an object" } };
  }

  return { ok: true, value: parsed };
}

/**
 * Decode a header and narrow it with a guard.
 *
 * @param header - Raw header value.
 * @param guard - Type guard describing the expected object.
 * @param what - Name used in the error message when the guard rejects.
 * @returns The narrowed value, or a typed error.
 */
export function decodeHeaderAs<T>(
  header: string,
  guard: (value: Record<string, unknown>) => value is Record<string, unknown> & T,
  what: string,
): DecodeResult<T> {
  const decoded = decodeHeader(header);
  if (!decoded.ok) {
    return decoded;
  }
  if (!guard(decoded.value)) {
    return { ok: false, error: { kind: "shape_mismatch", message: `header is not a ${what}` } };
  }
  return { ok: true, value: decoded.value };
}

/** Decode a `PAYMENT-REQUIRED` header. */
export function decodePaymentRequired(header: string): DecodeResult<PaymentRequired> {
  return decodeHeaderAs(header, isPaymentRequired, "PaymentRequired");
}

/** Decode a `PAYMENT-SIGNATURE` header. */
export function decodePaymentPayload(header: string): DecodeResult<PaymentPayload> {
  return decodeHeaderAs(header, isPaymentPayload, "PaymentPayload");
}

/** Decode a `PAYMENT-RESPONSE` header. */
export function decodeSettlementResponse(header: string): DecodeResult<SettlementResponse> {
  return decodeHeaderAs(header, isSettlementResponse, "SettlementResponse");
}

/**
 * Whether an object has the required `PaymentRequirements` fields.
 *
 * @param value - Candidate object.
 * @returns True when every required field is present with the right type.
 */
export function isPaymentRequirements(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PaymentRequirements {
  return (
    typeof value["scheme"] === "string" &&
    isNetwork(value["network"]) &&
    typeof value["asset"] === "string" &&
    typeof value["amount"] === "string" &&
    typeof value["payTo"] === "string" &&
    typeof value["maxTimeoutSeconds"] === "number" &&
    isPlainObject(value["extra"])
  );
}

/** Whether an object has the required `PaymentRequired` fields. */
export function isPaymentRequired(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PaymentRequired {
  const accepts = value["accepts"];
  const resource = value["resource"];
  return (
    typeof value["x402Version"] === "number" &&
    isPlainObject(resource) &&
    typeof resource["url"] === "string" &&
    Array.isArray(accepts) &&
    accepts.every((item: unknown) => isPlainObject(item) && isPaymentRequirements(item))
  );
}

/** Whether an object has the required `PaymentPayload` fields. */
export function isPaymentPayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PaymentPayload {
  const accepted = value["accepted"];
  return (
    typeof value["x402Version"] === "number" &&
    isPlainObject(accepted) &&
    isPaymentRequirements(accepted) &&
    isPlainObject(value["payload"])
  );
}

/** Whether an object has the required `SettlementResponse` fields. */
export function isSettlementResponse(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SettlementResponse {
  return (
    typeof value["success"] === "boolean" &&
    typeof value["transaction"] === "string" &&
    isNetwork(value["network"])
  );
}

/**
 * Whether a value is a CAIP-2 network identifier, the `namespace:reference`
 * shape `@x402/core` types as a template literal.
 *
 * @param value - Candidate value.
 * @returns True for a string with exactly one colon and non-empty halves.
 */
function isNetwork(value: unknown): value is `${string}:${string}` {
  if (typeof value !== "string") {
    return false;
  }
  const parts = value.split(":");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "";
}

/** Whether a value is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
