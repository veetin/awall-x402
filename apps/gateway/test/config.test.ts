import { describe, expect, it } from "vitest";
import {
  GatewayConfigError,
  STELLAR_PUBNET,
  STELLAR_PUBNET_XLM,
  STELLAR_TESTNET_USDC,
  STELLAR_TESTNET_XLM,
  readConfig,
} from "../src/config.js";

/**
 * Stand-in values. They are deliberately not real pubnet addresses: no
 * production address belongs in the repository, and these tests only care that
 * the configured value is what comes back.
 */
const PUBNET_USDC = "CEXAMPLEPUBNETUSDCCONTRACTFORTESTSONLYAAAAAAAAAAAAAAAA";
const PUBNET_PAY_TO = "GEXAMPLEPUBNETRECEIVINGACCOUNTFORTESTSONLYAAAAAAAAAAAA";
const PUBNET_FACILITATOR = "https://facilitator.example.com";

/** Full pubnet environment, so single variables can be removed from it. */
function pubnetEnv(): NodeJS.ProcessEnv {
  return {
    STELLAR_NETWORK: STELLAR_PUBNET,
    STELLAR_ASSET: PUBNET_USDC,
    STELLAR_PAY_TO: PUBNET_PAY_TO,
    X402_FACILITATOR_URL: PUBNET_FACILITATOR,
  };
}

describe("readConfig on testnet", () => {
  it("keeps the testnet defaults with no configuration at all", () => {
    const config = readConfig({});
    expect(config.network).toBe("stellar:testnet");
    expect(config.asset).toBe(STELLAR_TESTNET_USDC);
    expect(config.xlmAsset).toBe(STELLAR_TESTNET_XLM);
    expect(config.payTo).toBe("");
    expect(config.facilitatorUrl).toBe("https://www.x402.org/facilitator");
  });

  it("keeps the testnet defaults when the network is named explicitly", () => {
    const config = readConfig({ STELLAR_NETWORK: "stellar:testnet" });
    expect(config.asset).toBe(STELLAR_TESTNET_USDC);
    expect(config.xlmAsset).toBe(STELLAR_TESTNET_XLM);
  });

  it("falls back when Compose passes the variable through as empty", () => {
    // `${STELLAR_ASSET:-}` defines the variable in the container as "" when it
    // is not exported on the host, so the fallback has to cover blank, not
    // only unset. Before this, the exact rail advertised an empty asset.
    const config = readConfig({
      STELLAR_NETWORK: "stellar:testnet",
      STELLAR_ASSET: "",
      X402_FACILITATOR_URL: "",
    });
    expect(config.asset).toBe(STELLAR_TESTNET_USDC);
    expect(config.facilitatorUrl).toBe("https://www.x402.org/facilitator");
  });

  it("falls back on a value that is only whitespace", () => {
    expect(readConfig({ STELLAR_ASSET: "   " }).asset).toBe(STELLAR_TESTNET_USDC);
  });

  it("still lets the environment override each value", () => {
    const config = readConfig({
      STELLAR_NETWORK: "stellar:testnet",
      STELLAR_ASSET: "CTESTASSET",
      STELLAR_PAY_TO: PUBNET_PAY_TO,
      X402_FACILITATOR_URL: PUBNET_FACILITATOR,
    });
    expect(config.asset).toBe("CTESTASSET");
    expect(config.payTo).toBe(PUBNET_PAY_TO);
    expect(config.facilitatorUrl).toBe(PUBNET_FACILITATOR);
  });
});

describe("readConfig on pubnet", () => {
  it("never falls back to the testnet USDC contract", () => {
    let asset: string | null = null;
    try {
      asset = readConfig({ STELLAR_NETWORK: STELLAR_PUBNET }).asset;
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GatewayConfigError);
      if (error instanceof GatewayConfigError) {
        expect(error.message).toContain("STELLAR_ASSET");
        expect(error.message).not.toContain(STELLAR_TESTNET_USDC);
        expect(error.missing).toContain("STELLAR_ASSET");
      }
    }
    expect(asset).not.toBe(STELLAR_TESTNET_USDC);
  });

  it("names every missing variable in one error", () => {
    try {
      readConfig({ STELLAR_NETWORK: STELLAR_PUBNET });
      throw new Error("readConfig should have refused the configuration");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GatewayConfigError);
      if (!(error instanceof GatewayConfigError)) return;
      expect(error.missing).toEqual([
        "STELLAR_ASSET",
        "STELLAR_PAY_TO",
        "X402_FACILITATOR_URL",
      ]);
      expect(error.network).toBe(STELLAR_PUBNET);
      expect(error.message).toContain("STELLAR_NETWORK=stellar:pubnet");
    }
  });

  it("refuses a missing asset even when the other variables are set", () => {
    const env = pubnetEnv();
    delete env["STELLAR_ASSET"];
    expect(() => readConfig(env)).toThrow(/STELLAR_ASSET/);
  });

  it("refuses the testnet facilitator default", () => {
    const env = pubnetEnv();
    delete env["X402_FACILITATOR_URL"];
    expect(() => readConfig(env)).toThrow(/X402_FACILITATOR_URL/);
  });

  it("refuses an empty receiving account instead of advertising one", () => {
    expect(() => readConfig({ ...pubnetEnv(), STELLAR_PAY_TO: "" })).toThrow(
      /STELLAR_PAY_TO/,
    );
  });

  it("treats a blank value as absent", () => {
    expect(() => readConfig({ ...pubnetEnv(), STELLAR_ASSET: "   " })).toThrow(
      GatewayConfigError,
    );
  });

  it("accepts a complete pubnet configuration", () => {
    const config = readConfig(pubnetEnv());
    expect(config.network).toBe(STELLAR_PUBNET);
    expect(config.asset).toBe(PUBNET_USDC);
    expect(config.payTo).toBe(PUBNET_PAY_TO);
    expect(config.facilitatorUrl).toBe(PUBNET_FACILITATOR);
    expect(config.xlmAsset).toBe(STELLAR_PUBNET_XLM);
  });
});

describe("readConfig and the checkout base URL", () => {
  it("defaults to the console's own port", () => {
    expect(readConfig({}).checkoutBaseUrl).toBe("http://localhost:4179");
  });

  it("treats an empty value as absent, the way Compose passes it", () => {
    expect(readConfig({ AWALL_CHECKOUT_BASE_URL: "" }).checkoutBaseUrl).toBe(
      "http://localhost:4179",
    );
  });

  it("drops a trailing slash, so appending a path cannot double the separator", () => {
    expect(
      readConfig({ AWALL_CHECKOUT_BASE_URL: "https://awall.example.com/" }).checkoutBaseUrl,
    ).toBe("https://awall.example.com");
  });
});
