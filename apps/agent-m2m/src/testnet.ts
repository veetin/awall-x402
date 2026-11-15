/**
 * Testnet account preparation, with the network behind an interface.
 *
 * The USDC of Stellar testnet is a Stellar Asset Contract wrapping a classic
 * asset, so holding it needs a classic trustline to the issuer. A missing
 * trustline is the quietest way for the paid flow to fail, which is why this
 * module exists and why it reports the trustline explicitly.
 */

/** One balance line of a classic account. */
export type TestnetBalance = {
  /** `"native"` for XLM, `credit_alphanum4`/`credit_alphanum12` otherwise. */
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  /** Balance as a decimal string, as Horizon reports it. */
  balance: string;
};

/** The network operations the setup needs. */
export type StellarTestnet = {
  /**
   * @param address - Account to read.
   * @returns Its balances, or `undefined` when the account does not exist.
   */
  loadBalances(address: string): Promise<TestnetBalance[] | undefined>;
  /**
   * Create and fund the account with testnet XLM (friendbot).
   *
   * @param address - Account to fund.
   */
  fund(address: string): Promise<void>;
  /**
   * Submit a `changeTrust` operation for USDC, signed by the account itself.
   *
   * @param secret - Secret key of the account.
   */
  addTrustline(secret: string): Promise<void>;
};

/** What the setup found and did for one account. */
export type AccountReport = {
  /** Human label, e.g. `"payer"`. */
  label: string;
  address: string;
  /** XLM balance as a decimal string. */
  xlm: string;
  /** USDC balance, or `"0"` when there is no trustline yet. */
  usdc: string;
  hasTrustline: boolean;
  /** Whether this run created the account. */
  created: boolean;
  /** Whether this run added the trustline. */
  trustlineAdded: boolean;
};

/** Balances of interest, extracted from a Horizon account. */
export type BalanceSummary = {
  xlm: string;
  usdc: string;
  hasTrustline: boolean;
};

/**
 * Pick the XLM and USDC balances out of an account's balance lines.
 *
 * @param balances - Balance lines as reported by Horizon.
 * @param issuer - Classic issuer of the USDC asset.
 * @returns The XLM balance, the USDC balance and whether the trustline exists.
 */
export function summarizeBalances(
  balances: TestnetBalance[],
  issuer: string,
): BalanceSummary {
  const native = balances.find(balance => balance.assetType === "native");
  const usdc = balances.find(
    balance => balance.assetCode === "USDC" && balance.assetIssuer === issuer,
  );
  return {
    xlm: native?.balance ?? "0",
    usdc: usdc?.balance ?? "0",
    hasTrustline: usdc !== undefined,
  };
}

/**
 * Bring one account to the state the paid flow needs: funded, with a USDC
 * trustline, and reported.
 *
 * @param network - Injected network operations.
 * @param account - Which account to prepare.
 * @param account.label - Human label for the report.
 * @param account.address - Public key of the account.
 * @param account.secret - Secret key, used only to sign the trustline.
 * @param account.issuer - Classic USDC issuer on this network.
 * @returns What was found and what this run changed.
 * @throws When the account is still missing after funding it.
 */
export async function prepareAccount(
  network: StellarTestnet,
  account: { label: string; address: string; secret: string; issuer: string },
): Promise<AccountReport> {
  let balances = await network.loadBalances(account.address);
  let created = false;

  if (balances === undefined) {
    await network.fund(account.address);
    balances = await network.loadBalances(account.address);
    created = true;
    if (balances === undefined) {
      throw new Error(`${account.address} is still missing after friendbot funded it`);
    }
  }

  let summary = summarizeBalances(balances, account.issuer);
  let trustlineAdded = false;

  if (!summary.hasTrustline) {
    await network.addTrustline(account.secret);
    const reloaded = await network.loadBalances(account.address);
    if (reloaded === undefined) {
      throw new Error(`${account.address} disappeared while adding the trustline`);
    }
    summary = summarizeBalances(reloaded, account.issuer);
    trustlineAdded = true;
  }

  return {
    label: account.label,
    address: account.address,
    xlm: summary.xlm,
    usdc: summary.usdc,
    hasTrustline: summary.hasTrustline,
    created,
    trustlineAdded,
  };
}

/**
 * @param balance - Balance as a decimal string.
 * @returns Whether the balance is zero.
 */
export function isZero(balance: string): boolean {
  return /^0(\.0*)?$/.test(balance.trim());
}
