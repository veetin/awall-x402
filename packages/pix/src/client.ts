import {
  ABACATEPAY_BASE_URL,
  MIN_AMOUNT_CENTS,
  MIN_MAX_TIMEOUT_SECONDS,
} from "./constants.js";
import { err, ok, type Result } from "./result.js";
import { CHARGE_STATUSES, type ChargeStatus, type PixCharge, type PixChargeStatus } from "./types.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AbacatePayClientOptions {
  /** Secret API key. Never logged, never echoed back in an error. */
  readonly apiKey: string;
  /** Defaults to the documented v2 base URL. Injectable for tests. */
  readonly baseUrl?: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Per-request timeout. Defaults to 10 s. */
  readonly timeoutMs?: number;
}

export type AbacatePayErrorKind =
  | "config_error"
  | "invalid_request"
  | "timeout"
  | "network_error"
  | "http_error"
  | "provider_error"
  | "invalid_response";

export interface AbacatePayError {
  readonly kind: AbacatePayErrorKind;
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  readonly message: string;
}

export interface CreatePixChargeInput {
  /** Amount in centavos. Minimum 100 (R$ 1,00) at the provider. */
  readonly amountCents: bigint;
  /** QR code lifetime in seconds. Minimum 300 at the provider. */
  readonly expiresInSeconds: number;
  /** Up to 500 characters at the provider. */
  readonly description?: string;
  /** Our own identifier, used by the provider for idempotency. */
  readonly externalId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Thin adapter over the AbacatePay v2 API. It only creates charges and reads
 * their status: everything else about the `pix` scheme lives in this package's
 * pure functions.
 */
export class AbacatePayClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: AbacatePayClientOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? ABACATEPAY_BASE_URL).replace(/\/+$/, "");
    const injected = options.fetch ?? globalThis.fetch;
    if (typeof injected !== "function") {
      throw new TypeError("no fetch implementation available");
    }
    this.#fetch = injected.bind(globalThis) as FetchLike;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `POST /transparents/create` with `method: "PIX"`. */
  async createPixCharge(input: CreatePixChargeInput): Promise<Result<PixCharge, AbacatePayError>> {
    if (this.#apiKey.length === 0) {
      return err({ kind: "config_error", message: "missing AbacatePay API key" });
    }
    if (input.amountCents < MIN_AMOUNT_CENTS) {
      return err({
        kind: "invalid_request",
        message: `amount must be at least ${MIN_AMOUNT_CENTS} centavos`,
      });
    }
    if (input.amountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
      return err({ kind: "invalid_request", message: "amount is out of range" });
    }
    if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < MIN_MAX_TIMEOUT_SECONDS) {
      return err({
        kind: "invalid_request",
        message: `expiresInSeconds must be an integer of at least ${MIN_MAX_TIMEOUT_SECONDS}`,
      });
    }

    const body: Record<string, unknown> = {
      method: "PIX",
      data: {
        amount: Number(input.amountCents),
        expiresIn: input.expiresInSeconds,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    };

    const response = await this.#request("POST", "/transparents/create", body);
    if (!response.ok) return response;
    return parseCharge(response.value);
  }

  /** `GET /transparents/check?id=<chargeId>`. */
  async getChargeStatus(chargeId: string): Promise<Result<PixChargeStatus, AbacatePayError>> {
    if (this.#apiKey.length === 0) {
      return err({ kind: "config_error", message: "missing AbacatePay API key" });
    }
    if (chargeId.length === 0) {
      return err({ kind: "invalid_request", message: "chargeId is empty" });
    }

    const path = `/transparents/check?id=${encodeURIComponent(chargeId)}`;
    const response = await this.#request("GET", path);
    if (!response.ok) return response;
    return parseChargeStatus(response.value);
  }

  async #request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Result<unknown, AbacatePayError>> {
    const url = `${this.#baseUrl}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      return err(this.#transportError(cause));
    }

    let payload: unknown;
    const text = await response.text().catch(() => "");
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      return err({
        kind: "http_error",
        status: response.status,
        message: this.#redact(providerMessage(payload) ?? `provider returned HTTP ${response.status}`),
      });
    }

    if (!isRecord(payload)) {
      return err({
        kind: "invalid_response",
        status: response.status,
        message: "provider response is not a JSON object",
      });
    }
    if (payload["success"] === false || payload["error"] != null) {
      return err({
        kind: "provider_error",
        status: response.status,
        message: this.#redact(providerMessage(payload) ?? "provider reported a failure"),
      });
    }
    return ok(payload["data"]);
  }

  #transportError(cause: unknown): AbacatePayError {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { kind: "timeout", message: `request timed out after ${this.#timeoutMs} ms` };
    }
    const message = cause instanceof Error ? cause.message : "transport failure";
    return { kind: "network_error", message: this.#redact(message) };
  }

  /**
   * Defence in depth: the API key must never reach a log line or an error
   * surfaced to a caller, even if a provider echoes it back.
   */
  #redact(message: string): string {
    if (this.#apiKey.length === 0) return message;
    return message.split(this.#apiKey).join("[redacted]");
  }
}

function providerMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload["error"];
  if (typeof error === "string" && error.length > 0) return error;
  const message = payload["message"];
  if (typeof message === "string" && message.length > 0) return message;
  return undefined;
}

function parseCharge(data: unknown): Result<PixCharge, AbacatePayError> {
  if (!isRecord(data)) {
    return err({ kind: "invalid_response", message: "charge payload is not an object" });
  }
  const chargeId = data["id"];
  const amount = data["amount"];
  const status = data["status"];
  const brCode = data["brCode"];
  const expiresAt = data["expiresAt"];

  if (typeof chargeId !== "string" || chargeId.length === 0) {
    return err({ kind: "invalid_response", message: "charge payload has no id" });
  }
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    return err({ kind: "invalid_response", message: "charge amount is not an integer" });
  }
  if (!isChargeStatus(status)) {
    return err({ kind: "invalid_response", message: "charge status is not a known status" });
  }
  if (typeof brCode !== "string" || brCode.length === 0) {
    return err({ kind: "invalid_response", message: "charge payload has no brCode" });
  }
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) {
    return err({ kind: "invalid_response", message: "charge expiresAt is not an instant" });
  }

  const brCodeBase64 = data["brCodeBase64"];
  const devMode = data["devMode"];
  return ok({
    chargeId,
    amountCents: BigInt(amount),
    status,
    brCode,
    brCodeBase64: typeof brCodeBase64 === "string" ? brCodeBase64 : null,
    expiresAt,
    devMode: devMode === true,
  });
}

function parseChargeStatus(data: unknown): Result<PixChargeStatus, AbacatePayError> {
  if (!isRecord(data)) {
    return err({ kind: "invalid_response", message: "status payload is not an object" });
  }
  const chargeId = data["id"];
  const status = data["status"];
  if (typeof chargeId !== "string" || chargeId.length === 0) {
    return err({ kind: "invalid_response", message: "status payload has no id" });
  }
  if (!isChargeStatus(status)) {
    return err({ kind: "invalid_response", message: "charge status is not a known status" });
  }
  const expiresAt = data["expiresAt"];
  return ok({
    chargeId,
    status,
    expiresAt: typeof expiresAt === "string" ? expiresAt : null,
  });
}

function isChargeStatus(value: unknown): value is ChargeStatus {
  return typeof value === "string" && (CHARGE_STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
