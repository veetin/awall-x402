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

export type GatewayConfig = {
  port: number;
  policyPath: string;
  network: string;
  /** USDC SEP-41 contract. */
  asset: string;
  /** Native XLM Stellar Asset Contract for the configured network. */
  xlmAsset: string;
  payTo: string;
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
 * @param env - Environment to read, defaults to `process.env`.
 * @returns Configuration with testnet defaults filled in.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = Number(env["AWALL_PORT"] ?? 8402);
  const adminPort = env["AWALL_ADMIN_PORT"];
  const network = env["STELLAR_NETWORK"] ?? "stellar:testnet";
  return {
    port,
    policyPath: env["AWALL_POLICY"] ?? findPolicy(process.cwd()),
    network,
    asset: env["STELLAR_ASSET"] ?? STELLAR_TESTNET_USDC,
    xlmAsset:
      env["STELLAR_XLM_ASSET"] ??
      (network === "stellar:pubnet" ? STELLAR_PUBNET_XLM : STELLAR_TESTNET_XLM),
    payTo: env["STELLAR_PAY_TO"] ?? "",
    facilitatorUrl: env["X402_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator",
    facilitatorTimeoutMs: Number(env["X402_FACILITATOR_TIMEOUT_MS"] ?? 10_000),
    checkoutBaseUrl: env["AWALL_CHECKOUT_BASE_URL"] ?? "http://localhost:4179",
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
    maxBodyBytes: Number(env["AWALL_MAX_BODY_BYTES"] ?? 1_000_000),
    infraUsdPerCredit: Number(env["AWALL_INFRA_USD_PER_CREDIT"] ?? 0.00002),
    usageRetentionMs: Number(env["AWALL_USAGE_RETENTION_MS"] ?? 7 * 24 * 60 * 60 * 1000),
  };
}
