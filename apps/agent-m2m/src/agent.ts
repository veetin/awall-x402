import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/fetch";
import {
  expirationLedgerWindow,
  readTransactionXdr,
  type PaymentClient,
} from "./payment.js";
import {
  STELLAR_USDC_DECIMALS,
  explorerTxUrl,
  formatAtomic,
  formatBrlCents,
  shorten,
} from "./format.js";

/** The subset of `fetch` the agent uses. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Everything the loop talks to, injected so the suite needs no network. */
export type AgentDeps = {
  fetch: FetchLike;
  payments: PaymentClient;
  log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

/** How the agent drives the gateway. */
export type AgentOptions = {
  /** Full URL of the protected resource. */
  url: string;
  /** How many requests to attempt. */
  requests: number;
  /** Pause between requests, in milliseconds. */
  intervalMs: number;
  /** Sign and report the payment, but do not resend the paid request. */
  dryRun: boolean;
};

/** One payment the agent produced during a run. */
export type PaymentAttempt = {
  /** 1-based index of the request that got the 402. */
  request: number;
  /** The rail the agent chose. */
  accepted: PaymentRequirements;
  /** Base64 XDR of the signed transaction. */
  transactionXdr: string;
  /** Transaction hash, once the gateway settled it. */
  txHash?: string;
  /** Status of the retried request, absent on a dry run. */
  paidStatus?: number;
};

/** Outcome of a run. */
export type AgentSummary = {
  requests: number;
  responses: Record<number, number>;
  payments: PaymentAttempt[];
  /** Why the loop ended early, when it did. */
  stoppedBecause?: string;
};

const CREDIT_HEADERS = [
  "X-AWall-Credits-Remaining",
  "X-AWall-Free-Remaining-Credits",
] as const;

/**
 * Run the autonomous payment loop against the gateway.
 *
 * The loop requests the resource until its free quota runs out. On the 402 it
 * reads the terms, signs the `exact` Stellar rail and repeats the request with
 * `PAYMENT-SIGNATURE`; on a dry run it stops after printing the signed envelope.
 *
 * @param options - Target, request count and mode.
 * @param deps - Injected fetch, payment client and logger.
 * @returns What happened, for the caller's exit code and for tests.
 */
export async function runAgent(
  options: AgentOptions,
  deps: AgentDeps,
): Promise<AgentSummary> {
  const summary: AgentSummary = { requests: 0, responses: {}, payments: [] };
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= options.requests; attempt += 1) {
    const started = Date.now();
    const response = await deps.fetch(options.url);
    const body = await readBody(response);
    summary.requests += 1;
    summary.responses[response.status] = (summary.responses[response.status] ?? 0) + 1;

    if (response.status !== 402) {
      deps.log(requestLine(attempt, response, Date.now() - started));
      if (attempt < options.requests) await sleep(options.intervalMs);
      continue;
    }

    deps.log(requestLine(attempt, response, Date.now() - started));

    let paymentRequired: PaymentRequired;
    try {
      paymentRequired = deps.payments.decodePaymentRequired(
        name => response.headers.get(name),
        body,
      );
    } catch (error) {
      deps.log(`     cannot read the 402 terms: ${message(error)}`);
      summary.stoppedBecause = "undecodable 402";
      return summary;
    }

    if (paymentRequired.error) deps.log(`     reason: ${paymentRequired.error}`);
    for (const rail of paymentRequired.accepts) deps.log(railLine(rail));

    let payload: PaymentPayload;
    try {
      payload = await deps.payments.createPaymentPayload(paymentRequired);
    } catch (error) {
      deps.log(`     payment not signed: ${message(error)}`);
      summary.stoppedBecause = "signing failed";
      return summary;
    }

    const transactionXdr = readTransactionXdr(payload.payload);
    const accepted = payload.accepted;
    const attemptRecord: PaymentAttempt = { request: attempt, accepted, transactionXdr };
    summary.payments.push(attemptRecord);

    deps.log(
      `     signed ${accepted.scheme} on ${accepted.network}: ` +
        `${formatAtomic(accepted.amount, STELLAR_USDC_DECIMALS)} USDC, ` +
        `auth entries valid for ~${expirationLedgerWindow(accepted.maxTimeoutSeconds)} ledgers`,
    );

    if (options.dryRun) {
      deps.log(`     XDR (${transactionXdr.length} base64 chars):`);
      deps.log(transactionXdr);
      deps.log("     dry run: the paid request was not sent");
      summary.stoppedBecause = "dry run";
      return summary;
    }

    const paidStarted = Date.now();
    const paid = await deps.fetch(options.url, {
      headers: deps.payments.encodePaymentSignatureHeader(payload),
    });
    await readBody(paid);
    attemptRecord.paidStatus = paid.status;
    summary.requests += 1;
    summary.responses[paid.status] = (summary.responses[paid.status] ?? 0) + 1;

    const settlement = deps.payments.decodeSettlement(name => paid.headers.get(name));
    if (settlement?.success) {
      attemptRecord.txHash = settlement.transaction;
      deps.log(`     settled tx ${shorten(settlement.transaction, 8)}`);
      deps.log(`     ${explorerTxUrl(settlement.network, settlement.transaction)}`);
    } else if (settlement) {
      deps.log(
        `     settlement failed: ${settlement.errorReason ?? "unknown"} ` +
          `${settlement.errorMessage ?? ""}`.trimEnd(),
      );
    }

    deps.log(requestLine(attempt, paid, Date.now() - paidStarted, "paid"));

    if (paid.status >= 400) {
      summary.stoppedBecause = `paid request answered ${paid.status}`;
      return summary;
    }

    if (attempt < options.requests) await sleep(options.intervalMs);
  }

  return summary;
}

/**
 * One line per request: status, cost in credits and the balance left.
 *
 * @param attempt - 1-based request index.
 * @param response - The response to report.
 * @param elapsedMs - Round trip time.
 * @param tag - Extra marker, e.g. `"paid"`.
 * @returns The formatted line.
 */
function requestLine(
  attempt: number,
  response: Response,
  elapsedMs: number,
  tag?: string,
): string {
  const parts = [
    `[${String(attempt).padStart(2, "0")}]`,
    String(response.status),
    tag ? `(${tag})` : undefined,
    `cost ${response.headers.get("X-AWall-Cost-Credits") ?? "?"} credits`,
    `credits left ${creditsLeft(response) ?? "?"}`,
    `${elapsedMs}ms`,
  ];
  const identity = response.headers.get("X-AWall-Identity");
  if (identity) parts.push(`identity ${identity}`);
  return parts.filter(part => part !== undefined).join("  ");
}

/**
 * Read whichever remaining-credits header the gateway sent.
 *
 * @param response - The response to read.
 * @returns The value, or `undefined` when neither header is present.
 */
function creditsLeft(response: Response): string | undefined {
  for (const name of CREDIT_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) return value;
  }
  return undefined;
}

/**
 * One line per advertised rail, with the amount in its own unit.
 *
 * @param rail - A `PaymentRequirements` entry from `accepts`.
 * @returns The formatted line.
 */
function railLine(rail: PaymentRequirements): string {
  const pack = rail.extra["packCredits"];
  const packNote = typeof pack === "number" ? `  pack ${pack} credits` : "";
  const amount =
    rail.scheme === "pix"
      ? formatBrlCents(rail.amount)
      : `${formatAtomic(rail.amount, STELLAR_USDC_DECIMALS)} ${assetLabel(rail)}`;
  const destination =
    rail.scheme === "pix"
      ? readString(rail.extra, "checkoutUrl") ?? rail.payTo
      : shorten(rail.payTo);
  return (
    `     rail ${rail.scheme.padEnd(5)} ${rail.network.padEnd(14)} ` +
    `${amount} (${rail.amount})  to ${destination}  ` +
    `timeout ${rail.maxTimeoutSeconds}s${packNote}`
  );
}

/**
 * Label for the asset of a rail.
 *
 * @param rail - A `PaymentRequirements` entry.
 * @returns `"USDC"` for a contract address, otherwise the asset itself.
 */
function assetLabel(rail: PaymentRequirements): string {
  return rail.asset.startsWith("C") && rail.asset.length === 56 ? "USDC" : rail.asset;
}

/**
 * @param extra - The `extra` object of a rail.
 * @param key - Field to read.
 * @returns The string value, or `undefined`.
 */
function readString(extra: Record<string, unknown>, key: string): string | undefined {
  const value = extra[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Drain the response body, parsing JSON when the server sent it.
 *
 * The body is not part of the protocol, but AWall repeats the terms in it and
 * the v1 fallback of the x402 client reads them from there.
 *
 * @param response - The response to drain.
 * @returns The parsed body, the raw text, or `undefined`.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param error - Thrown value.
 * @returns A printable message.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param ms - Milliseconds to wait.
 * @returns A promise resolving after the delay.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
