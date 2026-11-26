import {
  x402Client,
  x402HTTPClient,
  type Network,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SchemeNetworkClient,
} from "@x402/fetch";
import {
  DEFAULT_ESTIMATED_LEDGER_SECONDS,
  createEd25519Signer,
  getNetworkPassphrase,
} from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { clampSorobanFee } from "./fee.js";

/**
 * x402 v2 `SettlementResponse`, as documented in docs/03-protocolo.md.
 *
 * Declared locally so the agent depends only on the two `@x402/*` client
 * packages; the shape is structurally compatible with what `@x402/core` returns.
 */
export type SettlementResponse = {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
};

/** Reader for one HTTP response header, case-insensitive. */
export type HeaderReader = (name: string) => string | null | undefined;

/**
 * The x402 client surface the agent loop needs.
 *
 * An interface instead of the concrete `x402HTTPClient` so tests can drive the
 * loop without a Soroban RPC or a funded account.
 */
export type PaymentClient = {
  /** Decode the `PAYMENT-REQUIRED` header of a 402 response. */
  decodePaymentRequired(getHeader: HeaderReader, body?: unknown): PaymentRequired;
  /** Select an accepted rail and produce the signed payload for it. */
  createPaymentPayload(paymentRequired: PaymentRequired): Promise<PaymentPayload>;
  /** Encode the payload into request headers. */
  encodePaymentSignatureHeader(payload: PaymentPayload): Record<string, string>;
  /** Decode `PAYMENT-RESPONSE`, or `undefined` when the response carries none. */
  decodeSettlement(getHeader: HeaderReader): SettlementResponse | undefined;
};

/**
 * Narrow a string to a CAIP-2 network identifier.
 *
 * @param value - Candidate network, e.g. `"stellar:testnet"`.
 * @returns The same value, typed as a network.
 * @throws When the value is not `namespace:reference`.
 */
export function parseNetwork(value: string): Network {
  if (!isNetwork(value)) throw new Error(`Not a CAIP-2 network: ${value}`);
  return value;
}

/**
 * @param value - Candidate network.
 * @returns Whether the value has the CAIP-2 shape.
 */
function isNetwork(value: string): value is Network {
  return /^[^:\s]+:[^:\s]+$/.test(value);
}

/** Preferred Stellar asset when the 402 offers both USDC and XLM. */
export type PreferredStellarAsset = "usdc" | "xlm";

/**
 * Pick the rail the autonomous agent can settle on its own.
 *
 * AWall advertises `exact` on Stellar for USDC and for XLM, plus the `pix`
 * scheme, which needs a human. Only `exact` is machine-payable. When both
 * Stellar assets are offered, `STELLAR_PAY_ASSET` (default `xlm`) decides
 * which one the agent signs: friendbot funds XLM without a USDC faucet.
 *
 * @param _x402Version - Protocol version, unused but part of the selector shape.
 * @param accepts - The `accepts` array from the 402.
 * @param preferred - Which Stellar asset to prefer when both are present.
 * @returns The `exact` Stellar requirement.
 * @throws When no `exact` Stellar rail is offered.
 */
export function selectExactStellar(
  _x402Version: number,
  accepts: PaymentRequirements[],
  preferred: PreferredStellarAsset = preferredStellarAsset(),
): PaymentRequirements {
  const exact = accepts.filter(
    item => item.scheme === "exact" && item.network.startsWith("stellar:"),
  );
  if (exact.length === 0) {
    const offered = accepts.map(item => `${item.scheme}@${item.network}`).join(", ");
    throw new Error(`No exact Stellar rail offered. Got: ${offered || "nothing"}`);
  }
  const byCode = (code: string) =>
    exact.find(item => item.extra?.["assetCode"] === code);
  const chosen =
    preferred === "xlm"
      ? byCode("XLM") ?? byCode("USDC") ?? exact[0]
      : byCode("USDC") ?? byCode("XLM") ?? exact[0];
  if (!chosen) {
    throw new Error("No exact Stellar rail offered.");
  }
  return chosen;
}

/**
 * Read which Stellar asset the agent should sign for.
 *
 * @param env - Environment to read.
 * @returns `xlm` or `usdc`.
 */
export function preferredStellarAsset(
  env: NodeJS.ProcessEnv = process.env,
): PreferredStellarAsset {
  const value = (env["STELLAR_PAY_ASSET"] ?? "xlm").trim().toLowerCase();
  return value === "usdc" ? "usdc" : "xlm";
}

/**
 * Ledger at which the signed auth entries stop being valid.
 *
 * The Stellar binding expresses the payment window in ledgers, while the 402
 * states it in seconds, so the conversion uses the network's own estimated
 * ledger close time and rounds up. An unusable estimate falls back to the 5
 * seconds the binding assumes.
 *
 * @param currentLedger - Latest ledger sequence known to the RPC.
 * @param maxTimeoutSeconds - `maxTimeoutSeconds` from the payment requirements.
 * @param estimatedLedgerSeconds - Measured seconds per ledger.
 * @returns The expiration ledger sequence.
 */
export function authEntryExpirationLedger(
  currentLedger: number,
  maxTimeoutSeconds: number,
  estimatedLedgerSeconds: number = DEFAULT_ESTIMATED_LEDGER_SECONDS,
): number {
  if (!Number.isInteger(currentLedger) || currentLedger <= 0) {
    throw new Error(`Invalid current ledger: ${currentLedger}`);
  }
  return (
    currentLedger + expirationLedgerWindow(maxTimeoutSeconds, estimatedLedgerSeconds)
  );
}

/**
 * How many ledgers the payment window spans.
 *
 * Split out of {@link authEntryExpirationLedger} because the window can be
 * reported from the 402 terms alone, before any RPC call.
 *
 * @param maxTimeoutSeconds - `maxTimeoutSeconds` from the payment requirements.
 * @param estimatedLedgerSeconds - Measured seconds per ledger.
 * @returns The number of ledgers, rounded up.
 */
export function expirationLedgerWindow(
  maxTimeoutSeconds: number,
  estimatedLedgerSeconds: number = DEFAULT_ESTIMATED_LEDGER_SECONDS,
): number {
  if (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new Error(`Invalid maxTimeoutSeconds: ${maxTimeoutSeconds}`);
  }
  const seconds =
    Number.isFinite(estimatedLedgerSeconds) && estimatedLedgerSeconds > 0
      ? estimatedLedgerSeconds
      : DEFAULT_ESTIMATED_LEDGER_SECONDS;
  return Math.ceil(maxTimeoutSeconds / seconds);
}

/**
 * Read the base64 XDR out of an `exact` Stellar payload.
 *
 * @param payload - The `payload` object of a `PaymentPayload`.
 * @returns The transaction XDR.
 * @throws When the field is missing or is not a string.
 */
export function readTransactionXdr(payload: Record<string, unknown>): string {
  const transaction = payload["transaction"];
  if (typeof transaction !== "string" || transaction.length === 0) {
    throw new Error("Stellar payload has no `transaction` XDR");
  }
  return transaction;
}

/**
 * Build the Stellar `exact` scheme client that signs the auth entries.
 *
 * @param options - Secret key, network and Soroban RPC URL.
 * @param options.secret - Stellar secret key (`S...`) of the paying account.
 * @param options.network - CAIP-2 network.
 * @param options.rpcUrl - Soroban RPC URL.
 * @returns The scheme client and the address it signs for.
 */
export function createStellarScheme(options: {
  secret: string;
  network: Network;
  rpcUrl: string;
}): { scheme: SchemeNetworkClient; address: string } {
  const signer = createEd25519Signer(options.secret, options.network);
  return {
    scheme: new ExactStellarScheme(signer, { url: options.rpcUrl }),
    address: signer.address,
  };
}

/** Options for {@link createPaymentClient}. */
export type PaymentClientOptions = {
  /** CAIP-2 network the scheme is registered for. */
  network: Network;
  /** Scheme client that signs the payload. */
  scheme: SchemeNetworkClient;
  /**
   * Per-payment cap handed to the client's spend controls. The default cap is
   * `"$1"`, which is below the AWall pack price under an abuse multiplier, so
   * the agent states its own.
   */
  maxPaymentUsd?: string;
  /**
   * Fee to rewrite into the signed envelope, in stroops, or `false` to leave
   * the envelope alone. See {@link clampSorobanFee}.
   */
  clampFeeStroops?: string | false;
  /**
   * Which Stellar asset the agent intends to pay in.
   *
   * It decides the spend controls, not only the preference: the client drops
   * every non-default asset before the selector runs, and XLM is not a default
   * asset, so paying in XLM needs it opted in explicitly. Defaults to
   * {@link preferredStellarAsset}.
   */
  preferred?: PreferredStellarAsset;
};

/**
 * Wire the `@x402/*` client stack into the interface the agent loop uses.
 *
 * @param options - Scheme, network and spending limits.
 * @returns A payment client.
 */
export function createPaymentClient(options: PaymentClientOptions): PaymentClient {
  const preferred = options.preferred ?? preferredStellarAsset();
  const client = new x402Client(selectExactStellar)
    .register(options.network, options.scheme)
    .setSpendControls({
      maxAmountPerPayment: options.maxPaymentUsd ?? "$2",
      // The USD cap covers the default assets, USDC among them. XLM is not a
      // default asset, so the client would drop that rail before the selector
      // ever saw it and sign USDC instead - which is the asset friendbot
      // cannot fund. Opting XLM in is what makes `STELLAR_PAY_ASSET=xlm` work.
      ...(preferred === "xlm" ? { allowedAssets: true as const } : {}),
    });
  const httpClient = new x402HTTPClient(client);
  const clampFeeStroops = options.clampFeeStroops ?? "1";

  return {
    decodePaymentRequired: (getHeader, body) =>
      httpClient.getPaymentRequiredResponse(getHeader, body),

    createPaymentPayload: async paymentRequired => {
      const payload = await httpClient.createPaymentPayload(paymentRequired);
      if (clampFeeStroops === false) return payload;
      const xdr = clampSorobanFee(
        readTransactionXdr(payload.payload),
        getNetworkPassphrase(options.network),
        clampFeeStroops,
      );
      return { ...payload, payload: { ...payload.payload, transaction: xdr } };
    },

    encodePaymentSignatureHeader: payload =>
      httpClient.encodePaymentSignatureHeader(payload),

    decodeSettlement: getHeader => {
      try {
        return httpClient.getPaymentSettleResponse(getHeader);
      } catch {
        return undefined;
      }
    },
  };
}
