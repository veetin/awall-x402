import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Stellar testnet defaults. See docs/03-protocolo.md for why these exact values. */
export const STELLAR_TESTNET_USDC =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
/** Native XLM Stellar Asset Contract on testnet. */
export const STELLAR_TESTNET_XLM =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
/** Native XLM Stellar Asset Contract on pubnet. */
export const STELLAR_PUBNET_XLM =
  "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
/** CAIP-2 identifier of the production Stellar network. */
export const STELLAR_PUBNET = "stellar:pubnet";
/** CAIP-2 identifier of the default (demo) Stellar network. */
export const STELLAR_TESTNET = "stellar:testnet";

/** One environment variable that has no safe default on pubnet. */
type MissingVariable = {
  readonly name: string;
  readonly hint: string;
};

/**
 * Configuration that cannot be defaulted on the configured network.
 *
 * Thrown by `readConfig` when `STELLAR_NETWORK` is pubnet and a value whose only
 * default is a testnet value is absent. Falling back there would make the
 * gateway quote testnet addresses on mainnet, so real clients would be asked to
 * pay in an asset that does not exist on the network they are on.
 */
export class GatewayConfigError extends Error {
  /** Network that was configured when the values were found missing. */
  readonly network: string;
  /** Names of the variables the operator has to set, in reading order. */
  readonly missing: readonly string[];

  constructor(network: string, missing: readonly MissingVariable[]) {
    const names = missing.map((variable) => variable.name);
    super(
      [
        `STELLAR_NETWORK=${network} has no safe default for ${names.join(", ")}.`,
        "The remaining defaults are testnet values and must never be quoted on",
        "pubnet. Set these variables in the environment:",
        ...missing.map((variable) => `  ${variable.name}: ${variable.hint}`),
      ].join("\n"),
    );
    this.name = "GatewayConfigError";
    this.network = network;
    this.missing = names;
  }
}

/**
 * Read a base URL that other URLs are appended to.
 *
 * The caller concatenates a path onto the result, so a trailing slash would
 * produce a double separator. An empty or absent value falls back, because
 * Compose turns an unexported variable into an empty string rather than
 * leaving it unset.
 *
 * @param value - Raw environment value.
 * @param fallback - Value to use when nothing usable is configured.
 * @returns The base URL with no trailing slash.
 */
function baseUrl(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  const base = trimmed !== undefined && trimmed.length > 0 ? trimmed : fallback;
  return base.replace(/\/+$/, "");
}

/**
 * Reader for variables whose fallback value only makes sense on testnet.
 *
 * On testnet it keeps the plain `??` fallback, so the demo still runs with no
 * configuration. On pubnet a blank or absent value is collected instead of
 * defaulted, and `assert` turns the whole set into one startup failure that
 * names every variable at once.
 *
 * @param env - Environment being read.
 * @param network - Value of `STELLAR_NETWORK`.
 * @returns Reader with `read` and `assert`.
 */
function networkDefaults(
  env: NodeJS.ProcessEnv,
  network: string,
): {
  read: (name: string, testnetDefault: string, hint: string) => string;
  assert: () => void;
} {
  const isPubnet = network === STELLAR_PUBNET;
  const missing: MissingVariable[] = [];
  return {
    read(name: string, testnetDefault: string, hint: string): string {
      const value = env[name];
      if (!isPubnet) return value ?? testnetDefault;
      if (value !== undefined && value.trim().length > 0) return value;
      missing.push({ name, hint });
      return "";
    },
    assert(): void {
      if (missing.length > 0) throw new GatewayConfigError(network, missing);
    },
  };
}

export type GatewayConfig = {
  port: number;
  policyPath: string;
  network: string;
  /** USDC SEP-41 contract. Required explicitly on pubnet. */
  asset: string;
  /** Native XLM Stellar Asset Contract for the configured network. */
  xlmAsset: string;
  /** Stellar account that receives payment. Required explicitly on pubnet. */
  payTo: string;
  /** x402 facilitator. Required explicitly on pubnet. */
  facilitatorUrl: string;
  facilitatorTimeoutMs: number;
  checkoutBaseUrl: string;
  publicBaseUrl: string;
  /**
   * Trust `X-Forwarded-For` for the fingerprint identity.
   *
   * Only turn this on when an edge proxy overwrites the header, otherwise any
   * client can forge its own identity. See docs/07-producao.md.
   */
  trustProxy: boolean;
  databaseUrl: string;
  /** Bearer token for the console. Empty means every admin route answers 401. */
  adminToken: string;
  /** Origins allowed to call the control plane. Never `*`. */
  consoleOrigins: string[];
  /** Prefix reserved for the gateway. The proxy never forwards it. */
  controlPrefix: string;
  /** When set, the control plane is also served on this port. */
  adminPort: number | null;
  abacatePayApiKey: string;
  abacatePayWebhookSecret: string;
  /** Optional Redis URL for the shared free-quota bucket. */
  redisUrl: string;
  originTimeoutMs: number;
  /**
   * Protected API to proxy to, overriding `origin` in the policy file.
   *
   * A deployment addresses the application by its own name - a compose
   * service, a private hostname - while the policy file in the repository
   * names a localhost port for development. Empty means the policy decides.
   */
  originUrl: string;
  maxBodyBytes: number;
  /** Rough infrastructure cost, used by the revenue screen. USD per credit. */
  infraUsdPerCredit: number;
  /** How long raw `usage_events` are kept. Rollups are not deleted. */
  usageRetentionMs: number;
};

/**
 * Locate the policy file.
 *
 * The gateway is started from its own package directory, so the default walks up
 * to the workspace root instead of assuming the current directory.
 *
 * @param from - Directory to start from.
 * @returns Absolute path to `awall.yaml`, or the plain name when not found.
 */
function findPolicy(from: string): string {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, "awall.yaml");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return "awall.yaml";
    dir = parent;
  }
}

function origins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "*");
}

/**
 * Read gateway configuration from the environment.
 *
 * On `stellar:testnet`, the default, every value keeps its testnet fallback so
 * the demo runs with no configuration. On `stellar:pubnet` the values that only
 * have a testnet default — the USDC contract, the receiving account and the
 * facilitator — have to be set explicitly, and the call throws
 * `GatewayConfigError` naming them when they are not.
 *
 * @param env - Environment to read, defaults to `process.env`.
 * @returns Configuration with testnet defaults filled in.
 * @throws GatewayConfigError - On pubnet, when a testnet-only default was the
 * sole remaining value for a variable.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = Number(env["AWALL_PORT"] ?? 8402);
  const adminPort = env["AWALL_ADMIN_PORT"];
  const network = env["STELLAR_NETWORK"] ?? STELLAR_TESTNET;
  const defaults = networkDefaults(env, network);
  const asset = defaults.read(
    "STELLAR_ASSET",
    STELLAR_TESTNET_USDC,
    "USDC SEP-41 contract on this network. The testnet contract does not exist on pubnet",
  );
  const payTo = defaults.read(
    "STELLAR_PAY_TO",
    "",
    "Stellar account that receives payment, with the USDC trustline already created",
  );
  const facilitatorUrl = defaults.read(
    "X402_FACILITATOR_URL",
    "https://www.x402.org/facilitator",
    "x402 facilitator that settles on this network. The public x402.org facilitator is a testnet service",
  );
  defaults.assert();
  return {
    port,
    policyPath: env["AWALL_POLICY"] ?? findPolicy(process.cwd()),
    network,
    asset,
    // Both branches are real contracts, so this default follows the network.
    xlmAsset:
      env["STELLAR_XLM_ASSET"] ??
      (network === STELLAR_PUBNET ? STELLAR_PUBNET_XLM : STELLAR_TESTNET_XLM),
    payTo,
    facilitatorUrl,
    facilitatorTimeoutMs: Number(env["X402_FACILITATOR_TIMEOUT_MS"] ?? 10_000),
    checkoutBaseUrl: baseUrl(env["AWALL_CHECKOUT_BASE_URL"], "http://localhost:4179"),
    publicBaseUrl: env["AWALL_PUBLIC_BASE_URL"] ?? `http://localhost:${port}`,
    trustProxy: env["AWALL_TRUST_PROXY"] === "1",
    databaseUrl: env["DATABASE_URL"] ?? "",
    adminToken: env["AWALL_ADMIN_TOKEN"] ?? "",
    consoleOrigins: origins(env["AWALL_CONSOLE_ORIGIN"] ?? "http://localhost:4179"),
    controlPrefix: env["AWALL_CONTROL_PREFIX"] ?? "/awall",
    adminPort: adminPort ? Number(adminPort) : null,
    abacatePayApiKey: env["ABACATEPAY_API_KEY"] ?? "",
    abacatePayWebhookSecret: env["ABACATEPAY_WEBHOOK_SECRET"] ?? "",
    redisUrl: env["REDIS_URL"] ?? "",
    originTimeoutMs: Number(env["AWALL_ORIGIN_TIMEOUT_MS"] ?? 15_000),
    originUrl: env["AWALL_ORIGIN"] ?? "",
    maxBodyBytes: Number(env["AWALL_MAX_BODY_BYTES"] ?? 1_000_000),
    infraUsdPerCredit: Number(env["AWALL_INFRA_USD_PER_CREDIT"] ?? 0.00002),
    usageRetentionMs: Number(env["AWALL_USAGE_RETENTION_MS"] ?? 7 * 24 * 60 * 60 * 1000),
  };
}
