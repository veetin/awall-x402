import type { Network } from "@x402/fetch";
import { parseNetwork } from "./payment.js";

/** Stellar testnet defaults, the same values the gateway uses. */
export const STELLAR_TESTNET_USDC =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const STELLAR_TESTNET_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const DEFAULT_FRIENDBOT_URL = "https://friendbot.stellar.org";
/** Where to get testnet USDC once the trustline exists. */
export const USDC_FAUCET_URL = "https://faucet.circle.com";

export type AgentConfig = {
  /** Base URL of the AWall gateway. */
  gatewayUrl: string;
  /** Path and query of the protected resource. */
  targetPath: string;
  requests: number;
  intervalMs: number;
  network: Network;
  rpcUrl: string;
  /** Per-payment cap for the client's spend controls. */
  maxPaymentUsd: string;
};

/**
 * Read the agent's configuration from the environment.
 *
 * @param env - Environment to read.
 * @returns Configuration with testnet defaults filled in.
 */
export function readAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    gatewayUrl: trimSlash(env["AWALL_GATEWAY_URL"] ?? "http://localhost:8402"),
    targetPath: env["AGENT_TARGET_PATH"] ?? "/v1/search?q=camera",
    requests: positiveInteger(env["AGENT_REQUESTS"], 40, "AGENT_REQUESTS"),
    intervalMs: positiveInteger(env["AGENT_INTERVAL_MS"], 120, "AGENT_INTERVAL_MS"),
    network: parseNetwork(env["STELLAR_NETWORK"] ?? "stellar:testnet"),
    rpcUrl: env["SOROBAN_RPC_URL"] ?? DEFAULT_RPC_URL,
    maxPaymentUsd: env["AGENT_MAX_PAYMENT_USD"] ?? "$2",
  };
}

/**
 * Read the secret key of the paying account.
 *
 * Kept apart from the rest of the configuration so the value never lands in an
 * object that gets logged. Signing needs it even on a dry run.
 *
 * @param env - Environment to read.
 * @param variable - Name of the variable to read.
 * @returns The secret key.
 * @throws When the variable is missing or is not a Stellar secret key.
 */
export function readSecret(
  env: NodeJS.ProcessEnv = process.env,
  variable = "STELLAR_SECRET",
): string {
  const secret = env[variable];
  if (!secret) {
    throw new Error(
      `${variable} is not set. Run "pnpm --filter @awall/agent-m2m setup:testnet" first.`,
    );
  }
  if (!/^S[A-Z2-7]{55}$/.test(secret)) {
    throw new Error(`${variable} is not a Stellar secret key (expected 56 chars, S...).`);
  }
  return secret;
}

/**
 * @param value - Raw environment value.
 * @param fallback - Value to use when unset.
 * @param name - Variable name, for the error message.
 * @returns The parsed integer.
 */
function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return parsed;
}

/**
 * @param url - URL that may end in a slash.
 * @returns The URL without its trailing slash.
 */
function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
