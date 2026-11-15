/**
 * One test against the real public facilitator.
 *
 * Skipped unless `X402_LIVE_TEST=1`, so the suite never depends on the network.
 * Run it when the facilitator's catalogue is in question:
 *
 *     X402_LIVE_TEST=1 pnpm --filter @awall/settlement test
 */

import { describe, expect, it } from "vitest";
import { FacilitatorClient } from "../src/facilitator.js";
import { checkStellarExactSupport } from "../src/stellar.js";

const PUBLIC_FACILITATOR = "https://www.x402.org/facilitator";
const live = process.env["X402_LIVE_TEST"] === "1";

describe.skipIf(!live)("public facilitator (live)", () => {
  it("advertises exact on stellar:testnet with sponsored fees", async () => {
    const client = new FacilitatorClient({ baseUrl: PUBLIC_FACILITATOR, timeoutMs: 15_000 });

    const result = await client.supported();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const check = checkStellarExactSupport(result.value, "stellar:testnet");
    expect(check).toMatchObject({ supported: true });
    expect(check.supported && check.kind.extra).toMatchObject({ areFeesSponsored: true });
  }, 20_000);
});
