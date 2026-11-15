import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Stellar testnet defaults. See docs/03-protocolo.md for why these exact values. */
export const STELLAR_TESTNET_USDC =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export type GatewayConfig = {
  port: number;
  policyPath: string;
  network: string;
  asset: string;
  payTo: string;
  facilitatorUrl: string;
  checkoutBaseUrl: string;
  publicBaseUrl: string;
};

/**
 * Read gateway configuration from the environment.
 *
 * @param env - Environment to read, defaults to `process.env`.
 * @returns Configuration with testnet defaults filled in.
 */
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

export function readConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = Number(env["AWALL_PORT"] ?? 8402);
  return {
    port,
    policyPath: env["AWALL_POLICY"] ?? findPolicy(process.cwd()),
    network: env["STELLAR_NETWORK"] ?? "stellar:testnet",
    asset: env["STELLAR_ASSET"] ?? STELLAR_TESTNET_USDC,
    // No default: a real address must be configured before the paid flow works.
    payTo: env["STELLAR_PAY_TO"] ?? "",
    facilitatorUrl: env["X402_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator",
    checkoutBaseUrl: env["AWALL_CHECKOUT_BASE_URL"] ?? "http://localhost:3000",
    publicBaseUrl: env["AWALL_PUBLIC_BASE_URL"] ?? `http://localhost:${port}`,
  };
}
