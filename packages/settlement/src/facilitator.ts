/**
 * HTTP client for the x402 v2 facilitator interface (`/verify`, `/settle`,
 * `/supported`).
 *
 * Every call returns a result object. Network failure, timeout, an unexpected
 * status and an unreadable body are all values, never thrown exceptions: the
 * gateway has to turn a payment failure into a 402 with an `errorReason`, and it
 * cannot do that from a stack trace.
 *
 * `@x402/core` ships its own `HTTPFacilitatorClient`, which throws
 * `VerifyError`, `SettleError` and `FacilitatorTimeoutError`. We use its types
 * and not its client for exactly that reason.
 */

import { isNonTerminalErrorReason } from "./types.js";
import type {
  ErrorReason,
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettlementResponse,
  SupportedKind,
  SupportedResponse,
  VerifyResponse,
} from "./types.js";
import { X402_VERSION } from "./types.js";

/** Default request timeout. A facilitator settle waits on network confirmation. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Construction options. `fetch` and `timeoutMs` are injectable for tests. */
export type FacilitatorClientOptions = {
  /** Facilitator base URL, for example `https://www.x402.org/facilitator`. */
  baseUrl: string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Extra request headers, for example an API key for a private facilitator. */
  headers?: Record<string, string>;
};

/** A call that did not produce a protocol answer at all. */
export type FacilitatorFailure =
  /** The request never completed: DNS, connection reset, TLS, aborted socket. */
  | { kind: "network"; message: string }
  /** The request exceeded `timeoutMs`. For `/settle`, the payment state is unknown. */
  | { kind: "timeout"; timeoutMs: number }
  /** The facilitator answered with a status we cannot interpret. */
  | { kind: "http_status"; status: number; body: string }
  /** The body was not JSON, or not the documented schema. */
  | { kind: "malformed_body"; message: string };

/** A facilitator call: a protocol answer, or a reason there is none. */
export type FacilitatorResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: FacilitatorFailure };

/** Outcome of `/verify`. */
export type VerifyOutcome =
  | { status: "valid"; payer?: string; response: VerifyResponse }
  | { status: "invalid"; invalidReason: ErrorReason; payer?: string; response: VerifyResponse };

/**
 * Outcome of `/settle`.
 *
 * `settled` is the only state that may credit the ledger. `failed` is terminal:
 * no funds moved, or the transaction was rejected. `pending` is neither — the
 * transaction was broadcast and may still confirm, so the caller reconciles by
 * `transaction` hash rather than crediting or refusing.
 */
export type SettleOutcome =
  | {
      status: "settled";
      transaction: string;
      network: Network;
      payer?: string;
      /** Amount actually settled, when the scheme reports one. */
      amount?: string;
      response: SettlementResponse;
    }
  | {
      status: "pending";
      errorReason: ErrorReason;
      transaction: string;
      network: Network;
      /**
       * Whether the hash is usable for reconciliation. The specification
       * requires a non-empty `transaction` alongside `settlement_pending`; a
       * facilitator that omits it leaves the payment unreconcilable, and the
       * caller must not credit.
       */
      reconcilable: boolean;
      payer?: string;
      response: SettlementResponse;
    }
  | {
      status: "failed";
      errorReason: ErrorReason;
      transaction: string;
      network: Network;
      payer?: string;
      response: SettlementResponse;
    };

/**
 * Client for one facilitator.
 *
 * Stateless and cheap to construct; hold one per configured facilitator.
 */
export class FacilitatorClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  /**
   * @param options - Base URL plus the injectable `fetch`, timeout and headers.
   */
  constructor(options: FacilitatorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.headers = options.headers ?? {};
  }

  /**
   * `GET /supported`: the schemes, networks and extensions this facilitator
   * handles.
   *
   * Entries that are not readable as v2 kinds with a CAIP-2 network — the v1
   * rows the public facilitator still lists — are left out of `kinds`.
   *
   * @returns The `SupportedResponse`, or the reason the call produced none.
   */
  async supported(): Promise<FacilitatorResult<SupportedResponse>> {
    const result = await this.request("/supported", "GET", undefined);
    if (!result.ok) {
      return result;
    }
    const body = result.value;
    const rawKinds: unknown = body["kinds"];
    if (!Array.isArray(rawKinds)) {
      return malformed("/supported body has no kinds array");
    }
    const kinds: SupportedKind[] = [];
    for (const entry of rawKinds) {
      const kind = readSupportedKind(entry);
      if (kind === undefined) {
        // Dropped on purpose. The public facilitator lists v1 kinds alongside
        // v2 ones, and a v1 `network` is a legacy name such as `base-sepolia`
        // rather than a CAIP-2 identifier. v1 has no Stellar binding, so an
        // entry we cannot read as a v2 kind is of no use to us.
        continue;
      }
      kinds.push(kind);
    }
    return {
      ok: true,
      value: {
        kinds,
        extensions: stringArray(body["extensions"]),
        signers: signerMap(body["signers"]),
      },
    };
  }

  /**
   * `POST /verify`: read-only validation of a payment authorization.
   *
   * Verify does not move funds. A `valid` outcome is permission to run the
   * resource and then settle, nothing more.
   *
   * @param payload - The `PaymentPayload` decoded from `PAYMENT-SIGNATURE`.
   * @param requirements - The requirements the server issued, never the client's copy.
   * @returns Whether the authorization is valid, or the reason there is no answer.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<FacilitatorResult<VerifyOutcome>> {
    const result = await this.request("/verify", "POST", {
      x402Version: X402_VERSION,
      paymentPayload: payload,
      paymentRequirements: requirements,
    });
    if (!result.ok) {
      return result;
    }

    const body = result.value;
    const isValid = body["isValid"];
    if (typeof isValid !== "boolean") {
      return malformed("/verify body has no boolean isValid");
    }
    const payer = optionalString(body["payer"]);
    const invalidReason = optionalString(body["invalidReason"]);
    const invalidMessage = optionalString(body["invalidMessage"]);
    const response: VerifyResponse = {
      isValid,
      ...(invalidReason === undefined ? {} : { invalidReason }),
      ...(invalidMessage === undefined ? {} : { invalidMessage }),
      ...(payer === undefined ? {} : { payer }),
    };

    if (isValid) {
      return { ok: true, value: { status: "valid", ...(payer === undefined ? {} : { payer }), response } };
    }
    return {
      ok: true,
      value: {
        status: "invalid",
        invalidReason: response.invalidReason ?? "unexpected_verify_error",
        ...(payer === undefined ? {} : { payer }),
        response,
      },
    };
  }

  /**
   * `POST /settle`: durably commit the payment.
   *
   * @param payload - The `PaymentPayload` decoded from `PAYMENT-SIGNATURE`.
   * @param requirements - The requirements the server issued, never the client's copy.
   * @returns `settled`, `pending` or `failed`, or the reason there is no answer.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<FacilitatorResult<SettleOutcome>> {
    const result = await this.request("/settle", "POST", {
      x402Version: X402_VERSION,
      paymentPayload: payload,
      paymentRequirements: requirements,
    });
    if (!result.ok) {
      return result;
    }

    const body = result.value;
    const success = body["success"];
    if (typeof success !== "boolean") {
      return malformed("/settle body has no boolean success");
    }
    const network = body["network"];
    if (!isNetworkShape(network)) {
      return malformed("/settle body has no CAIP-2 network");
    }
    const transaction = typeof body["transaction"] === "string" ? body["transaction"] : "";
    const payer = optionalString(body["payer"]);
    const amount = optionalString(body["amount"]);
    const errorReason = optionalString(body["errorReason"]);
    const errorMessage = optionalString(body["errorMessage"]);

    const response: SettlementResponse = {
      success,
      transaction,
      network,
      ...(errorReason === undefined ? {} : { errorReason }),
      ...(errorMessage === undefined ? {} : { errorMessage }),
      ...(payer === undefined ? {} : { payer }),
      ...(amount === undefined ? {} : { amount }),
    };

    if (success) {
      return {
        ok: true,
        value: {
          status: "settled",
          transaction,
          network,
          ...(payer === undefined ? {} : { payer }),
          ...(amount === undefined ? {} : { amount }),
          response,
        },
      };
    }

    const reason = errorReason ?? "unexpected_settle_error";
    if (isNonTerminalErrorReason(reason)) {
      return {
        ok: true,
        value: {
          status: "pending",
          errorReason: reason,
          transaction,
          network,
          reconcilable: transaction.length > 0,
          ...(payer === undefined ? {} : { payer }),
          response,
        },
      };
    }

    return {
      ok: true,
      value: {
        status: "failed",
        errorReason: reason,
        transaction,
        network,
        ...(payer === undefined ? {} : { payer }),
        response,
      },
    };
  }

  /**
   * Perform one HTTP call and return its JSON body as a plain object.
   *
   * @param path - Path under the base URL, with leading slash.
   * @param method - HTTP method.
   * @param body - JSON request body, or undefined for GET.
   * @returns The parsed body, or the reason the call produced none.
   */
  private async request(
    path: string,
    method: "GET" | "POST",
    body: unknown,
  ): Promise<FacilitatorResult<Record<string, unknown>>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...this.headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (timedOut) {
        return { ok: false, failure: { kind: "timeout", timeoutMs: this.timeoutMs } };
      }
      return { ok: false, failure: { kind: "network", message: describeError(error) } };
    } finally {
      clearTimeout(timer);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (timedOut) {
        return { ok: false, failure: { kind: "timeout", timeoutMs: this.timeoutMs } };
      }
      return { ok: false, failure: { kind: "network", message: describeError(error) } };
    }

    // A facilitator reports an invalid payment with a 4xx plus a protocol body,
    // so a non-2xx status is only a transport failure when the body is not one.
    const parsed = parseJsonObject(text);
    if (parsed === undefined) {
      if (!response.ok) {
        return {
          ok: false,
          failure: { kind: "http_status", status: response.status, body: text.slice(0, 512) },
        };
      }
      return malformed("response body is not a JSON object");
    }

    if (response.status >= 500) {
      return {
        ok: false,
        failure: { kind: "http_status", status: response.status, body: text.slice(0, 512) },
      };
    }

    return { ok: true, value: parsed };
  }
}

/**
 * Build a `malformed_body` failure.
 *
 * @param message - What was wrong with the body.
 * @returns The failure result.
 */
function malformed<T>(message: string): FacilitatorResult<T> {
  return { ok: false, failure: { kind: "malformed_body", message } };
}

/**
 * Parse text as a JSON object.
 *
 * @param text - Response body.
 * @returns The object, or undefined when the text is not a JSON object.
 */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

/** Describe a thrown value without assuming it is an `Error`. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Return a string field, or undefined when absent or not a string. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Whether a value is a CAIP-2 `namespace:reference` identifier. */
function isNetworkShape(value: unknown): value is Network {
  if (typeof value !== "string") {
    return false;
  }
  const parts = value.split(":");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "";
}

/**
 * Read one `/supported` entry.
 *
 * @param value - Candidate entry from the `kinds` array.
 * @returns The kind, or undefined when a required field is missing.
 */
function readSupportedKind(value: unknown): SupportedKind | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...value };
  const x402Version = record["x402Version"];
  const scheme = record["scheme"];
  const network = record["network"];
  if (typeof x402Version !== "number" || typeof scheme !== "string" || !isNetworkShape(network)) {
    return undefined;
  }
  const extra = record["extra"];
  return {
    x402Version,
    scheme,
    network,
    ...(typeof extra === "object" && extra !== null && !Array.isArray(extra)
      ? { extra: { ...extra } }
      : {}),
  };
}

/** Read `extensions`, tolerating a facilitator that omits it. */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Read `signers`, tolerating a facilitator that omits it. */
function signerMap(value: unknown): Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [pattern, addresses] of Object.entries(value)) {
    result[pattern] = stringArray(addresses);
  }
  return result;
}
