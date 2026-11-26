import { describe, expect, it } from "vitest";
import {
  authEntryExpirationLedger,
  createPaymentClient,
  expirationLedgerWindow,
  parseNetwork,
  readTransactionXdr,
  selectExactStellar,
} from "../src/payment.js";
import { formatAtomic, formatBrlCents, explorerTxUrl } from "../src/format.js";
import {
  USDC,
  XLM,
  awallAccepts,
  awallPaymentRequired,
  fakeExactStellarScheme,
} from "./fixtures.js";

describe("selectExactStellar", () => {
  it("prefers XLM when both Stellar assets are offered", () => {
    const chosen = selectExactStellar(2, awallAccepts(), "xlm");
    expect(chosen.scheme).toBe("exact");
    expect(chosen.network).toBe("stellar:testnet");
    expect(chosen.extra?.["assetCode"]).toBe("XLM");
    expect(chosen.amount).toBe("68000000");
  });

  it("can prefer USDC instead", () => {
    const chosen = selectExactStellar(2, awallAccepts(), "usdc");
    expect(chosen.extra?.["assetCode"]).toBe("USDC");
    expect(chosen.amount).toBe("6800000");
  });

  it("does not rely on the order of accepts", () => {
    const reversed = [...awallAccepts()].reverse();
    expect(selectExactStellar(2, reversed, "xlm").extra?.["assetCode"]).toBe("XLM");
  });

  it("refuses an offer with no machine-payable rail", () => {
    const pixOnly = awallAccepts().filter(rail => rail.scheme === "pix");
    expect(() => selectExactStellar(2, pixOnly)).toThrow(/No exact Stellar rail/);
  });

  it("refuses exact on a network it cannot sign for", () => {
    const evm = awallAccepts().map(rail => ({ ...rail, network: "eip155:8453" as const }));
    expect(() => selectExactStellar(2, evm)).toThrow(/No exact Stellar rail/);
  });
});

describe("auth entry expiration", () => {
  it("converts maxTimeoutSeconds into ledgers, rounding up", () => {
    expect(expirationLedgerWindow(60, 5)).toBe(12);
    expect(expirationLedgerWindow(60, 6)).toBe(10);
    expect(expirationLedgerWindow(61, 5)).toBe(13);
    expect(expirationLedgerWindow(1, 5)).toBe(1);
  });

  it("falls back to 5 seconds per ledger when the estimate is unusable", () => {
    expect(expirationLedgerWindow(60)).toBe(12);
    expect(expirationLedgerWindow(60, 0)).toBe(12);
    expect(expirationLedgerWindow(60, Number.NaN)).toBe(12);
    expect(expirationLedgerWindow(60, -3)).toBe(12);
  });

  it("offsets the expiration from the current ledger", () => {
    expect(authEntryExpirationLedger(1_000_000, 60, 5)).toBe(1_000_012);
    expect(authEntryExpirationLedger(1_000_000, 900, 5)).toBe(1_000_180);
  });

  it("rejects nonsense inputs instead of signing a dead window", () => {
    expect(() => authEntryExpirationLedger(0, 60, 5)).toThrow(/current ledger/);
    expect(() => authEntryExpirationLedger(1.5, 60, 5)).toThrow(/current ledger/);
    expect(() => expirationLedgerWindow(0)).toThrow(/maxTimeoutSeconds/);
    expect(() => expirationLedgerWindow(-60)).toThrow(/maxTimeoutSeconds/);
  });
});

describe("payload reading", () => {
  it("reads the transaction XDR", () => {
    expect(readTransactionXdr({ transaction: "AAAA" })).toBe("AAAA");
  });

  it("refuses a payload without one", () => {
    expect(() => readTransactionXdr({})).toThrow(/transaction/);
    expect(() => readTransactionXdr({ transaction: 42 })).toThrow(/transaction/);
    expect(() => readTransactionXdr({ transaction: "" })).toThrow(/transaction/);
  });
});

describe("parseNetwork", () => {
  it("accepts CAIP-2 identifiers", () => {
    expect(parseNetwork("stellar:testnet")).toBe("stellar:testnet");
  });

  it("rejects anything else", () => {
    expect(() => parseNetwork("testnet")).toThrow(/CAIP-2/);
  });
});

describe("amount formatting", () => {
  it("formats USDC with the 7 decimals Stellar uses, not the 6 of EVM", () => {
    expect(formatAtomic("5000000", 7)).toBe("0.5000000");
    expect(formatAtomic("6800000", 7)).toBe("0.6800000");
    expect(formatAtomic("10000000", 7)).toBe("1.0000000");
    expect(formatAtomic("1", 7)).toBe("0.0000001");
  });

  it("formats Pix amounts from cents", () => {
    expect(formatBrlCents("394")).toBe("R$ 3,94");
    expect(formatBrlCents("290")).toBe("R$ 2,90");
  });

  it("refuses a non-integer amount instead of guessing", () => {
    expect(() => formatAtomic("0.5", 7)).toThrow(/integer/);
  });

  it("links the transaction on the right stellar.expert network", () => {
    expect(explorerTxUrl("stellar:testnet", "abc")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc",
    );
    expect(explorerTxUrl("stellar:pubnet", "abc")).toBe(
      "https://stellar.expert/explorer/public/tx/abc",
    );
  });
});

describe("spend controls", () => {
  /**
   * Sign one 402 and report which asset the scheme was asked for.
   *
   * @param preferred - Asset the agent intends to pay in.
   * @returns The contract id of the asset that reached the scheme.
   */
  async function signedAsset(preferred: "usdc" | "xlm"): Promise<string | undefined> {
    const { scheme, signed } = fakeExactStellarScheme();
    const payments = createPaymentClient({
      network: "stellar:testnet",
      scheme,
      // The fake XDR is not a transaction, so leave the envelope alone.
      clampFeeStroops: false,
      preferred,
    });
    await payments.createPaymentPayload(
      awallPaymentRequired("http://localhost:8402/v1/search?q=camera"),
    );
    return signed[0]?.asset;
  }

  it("keeps the XLM rail, which is not a default asset", async () => {
    // Without XLM opted in, the client drops that rail before the selector
    // runs and signs USDC instead: the asset friendbot cannot fund.
    expect(await signedAsset("xlm")).toBe(XLM);
  });

  it("still signs USDC when that is what the agent prefers", async () => {
    expect(await signedAsset("usdc")).toBe(USDC);
  });
});
