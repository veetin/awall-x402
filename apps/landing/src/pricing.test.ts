import { describe, expect, it } from "vitest";
import { computePackQuote, formatBrlDisplay, formatStellarDisplay } from "./pricing.js";

describe("landing pricing simulator", () => {
  it("keeps base prices in 7-decimal Stellar units and integer centavos when signals are zero", () => {
    const quote = computePackQuote({ burst: 0, identical: 0, errors: 0, cache: 0 });
    expect(quote.score).toBe(0);
    expect(quote.multiplier).toBe(1);
    expect(quote.usdcAtomic).toBe("5000000");
    expect(quote.xlmAtomic).toBe("50000000");
    expect(quote.brlCents).toBe(290);
    expect(formatStellarDisplay(quote.usdcAtomic)).toBe("0.50");
    expect(formatStellarDisplay(quote.xlmAtomic)).toBe("5.00");
    expect(formatBrlDisplay(quote.brlCents)).toBe("R$ 2,90");
  });

  it("matches the protocol example at abuse score 0.18 (multiplier 1.36)", () => {
    const quote = computePackQuote({ burst: 0.18, identical: 0.18, errors: 0.18, cache: 0.18 });
    expect(quote.multiplier).toBeCloseTo(1.36, 5);
    expect(quote.usdcAtomic).toBe("6800000");
    expect(quote.xlmAtomic).toBe("68000000");
    expect(quote.brlCents).toBe(394);
  });

  it("caps at max_multiplier 3.0 when all abuse signals hit 1.0", () => {
    const quote = computePackQuote({ burst: 1, identical: 1, errors: 1, cache: 1 });
    expect(quote.score).toBe(1);
    expect(quote.multiplier).toBe(3);
    expect(quote.usdcAtomic).toBe("15000000");
    expect(quote.xlmAtomic).toBe("150000000");
    expect(quote.brlCents).toBe(870);
  });
});
