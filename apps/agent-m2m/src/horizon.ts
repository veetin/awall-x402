import {
  Asset,
  BASE_FEE,
  Horizon,
  Networks,
  NotFoundError,
  Operation,
  TransactionBuilder,
  Keypair,
} from "@stellar/stellar-sdk";
import type { StellarTestnet, TestnetBalance } from "./testnet.js";

/** Cap on the fee we are willing to bid for the trustline, in stroops. */
const MAX_FEE_STROOPS = 100_000;

/** Options for {@link createHorizonTestnet}. */
export type HorizonTestnetOptions = {
  horizonUrl: string;
  friendbotUrl: string;
  /** Classic issuer of the USDC asset. */
  usdcIssuer: string;
  /** Network passphrase to sign with. */
  networkPassphrase?: string;
};

/**
 * The real testnet, over Horizon and friendbot.
 *
 * @param options - Endpoints and the USDC issuer.
 * @returns An implementation of the network interface the setup uses.
 */
export function createHorizonTestnet(options: HorizonTestnetOptions): StellarTestnet {
  const server = new Horizon.Server(options.horizonUrl);
  const usdc = new Asset("USDC", options.usdcIssuer);
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;

  return {
    loadBalances: async address => {
      try {
        const account = await server.loadAccount(address);
        return account.balances.map(toTestnetBalance);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },

    fund: async address => {
      const response = await fetch(
        `${options.friendbotUrl}?addr=${encodeURIComponent(address)}`,
      );
      if (!response.ok) {
        throw new Error(
          `friendbot refused to fund the account: ${response.status} ${await response.text()}`,
        );
      }
    },

    addTrustline: async secret => {
      const keypair = Keypair.fromSecret(secret);
      const account = await server.loadAccount(keypair.publicKey());
      const transaction = new TransactionBuilder(account, {
        fee: await bidFee(server),
        networkPassphrase,
      })
        .addOperation(Operation.changeTrust({ asset: usdc }))
        .setTimeout(60)
        .build();
      transaction.sign(keypair);
      await server.submitTransaction(transaction);
    },
  };
}

/**
 * Bid what recent transactions paid, capped at what we are willing to spend.
 *
 * @param server - Horizon client.
 * @returns The fee to use, in stroops.
 */
async function bidFee(server: Horizon.Server): Promise<string> {
  try {
    const stats = await server.feeStats();
    return String(Math.min(Number(stats.fee_charged.p90), MAX_FEE_STROOPS));
  } catch {
    return BASE_FEE;
  }
}

/**
 * @param balance - A Horizon balance line.
 * @returns The same line in the shape the setup logic reads.
 */
function toTestnetBalance(balance: Horizon.HorizonApi.BalanceLine): TestnetBalance {
  if ("asset_code" in balance && "asset_issuer" in balance) {
    return {
      assetType: balance.asset_type,
      assetCode: balance.asset_code,
      assetIssuer: balance.asset_issuer,
      balance: balance.balance,
    };
  }
  return { assetType: balance.asset_type, balance: balance.balance };
}

/**
 * @param error - Error thrown by Horizon.
 * @returns Whether it means "no such account".
 */
function isNotFound(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 404
  );
}
