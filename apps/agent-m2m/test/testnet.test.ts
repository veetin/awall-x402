import { describe, expect, it } from "vitest";
import {
  isZero,
  prepareAccount,
  summarizeBalances,
  type StellarTestnet,
  type TestnetBalance,
} from "../src/testnet.js";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDRESS = "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";
const SECRET = "SBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";

const NATIVE: TestnetBalance = { assetType: "native", balance: "10000.0000000" };
const USDC: TestnetBalance = {
  assetType: "credit_alphanum4",
  assetCode: "USDC",
  assetIssuer: ISSUER,
  balance: "100.0000000",
};

/**
 * A fake testnet whose state changes as the setup acts on it.
 *
 * @param state - Initial state of the account.
 * @param state.exists - Whether the account already exists.
 * @param state.trustline - Whether it already holds the USDC trustline.
 * @returns The fake network and a log of the calls it received.
 */
function fakeTestnet(state: { exists: boolean; trustline: boolean }): {
  network: StellarTestnet;
  calls: string[];
} {
  const calls: string[] = [];
  let { exists, trustline } = state;

  return {
    calls,
    network: {
      loadBalances: async address => {
        calls.push(`load ${address}`);
        if (!exists) return undefined;
        return trustline ? [NATIVE, USDC] : [NATIVE];
      },
      fund: async address => {
        calls.push(`fund ${address}`);
        exists = true;
      },
      addTrustline: async () => {
        calls.push("trustline");
        trustline = true;
      },
    },
  };
}

describe("summarizeBalances", () => {
  it("reads XLM and USDC and sees the trustline", () => {
    expect(summarizeBalances([NATIVE, USDC], ISSUER)).toEqual({
      xlm: "10000.0000000",
      usdc: "100.0000000",
      hasTrustline: true,
    });
  });

  it("reports no trustline when only XLM is there", () => {
    expect(summarizeBalances([NATIVE], ISSUER)).toEqual({
      xlm: "10000.0000000",
      usdc: "0",
      hasTrustline: false,
    });
  });

  it("ignores a USDC of another issuer", () => {
    const fake = { ...USDC, assetIssuer: ADDRESS };
    expect(summarizeBalances([NATIVE, fake], ISSUER).hasTrustline).toBe(false);
  });
});

describe("prepareAccount", () => {
  it("funds the account and adds the trustline when nothing exists", async () => {
    const { network, calls } = fakeTestnet({ exists: false, trustline: false });

    const report = await prepareAccount(network, {
      label: "payer",
      address: ADDRESS,
      secret: SECRET,
      issuer: ISSUER,
    });

    expect(calls).toEqual([`load ${ADDRESS}`, `fund ${ADDRESS}`, `load ${ADDRESS}`, "trustline", `load ${ADDRESS}`]);
    expect(report).toEqual({
      label: "payer",
      address: ADDRESS,
      xlm: "10000.0000000",
      usdc: "100.0000000",
      hasTrustline: true,
      created: true,
      trustlineAdded: true,
    });
  });

  it("touches nothing when the account is already set up", async () => {
    const { network, calls } = fakeTestnet({ exists: true, trustline: true });

    const report = await prepareAccount(network, {
      label: "payee",
      address: ADDRESS,
      secret: SECRET,
      issuer: ISSUER,
    });

    expect(calls).toEqual([`load ${ADDRESS}`]);
    expect(report.created).toBe(false);
    expect(report.trustlineAdded).toBe(false);
    expect(report.hasTrustline).toBe(true);
  });

  it("adds only the trustline to a funded account", async () => {
    const { network, calls } = fakeTestnet({ exists: true, trustline: false });

    const report = await prepareAccount(network, {
      label: "payer",
      address: ADDRESS,
      secret: SECRET,
      issuer: ISSUER,
    });

    expect(calls).toEqual([`load ${ADDRESS}`, "trustline", `load ${ADDRESS}`]);
    expect(report.created).toBe(false);
    expect(report.trustlineAdded).toBe(true);
  });

  it("fails loudly when friendbot leaves no account behind", async () => {
    const network: StellarTestnet = {
      loadBalances: async () => undefined,
      fund: async () => {},
      addTrustline: async () => {},
    };

    await expect(
      prepareAccount(network, {
        label: "payer",
        address: ADDRESS,
        secret: SECRET,
        issuer: ISSUER,
      }),
    ).rejects.toThrow(/still missing/);
  });
});

describe("isZero", () => {
  it("recognizes the balances Horizon reports as empty", () => {
    expect(isZero("0")).toBe(true);
    expect(isZero("0.0000000")).toBe(true);
    expect(isZero("0.0000001")).toBe(false);
    expect(isZero("100.0000000")).toBe(false);
  });
});
