import { describe, expect, it } from "vitest";
import { runAgent, type FetchLike } from "../src/agent.js";
import { createPaymentClient, type PaymentClient } from "../src/payment.js";
import {
  FAKE_XDR,
  PAY_TO,
  awallPaymentRequired,
  decodeHeader,
  encodeHeader,
  fakeExactStellarScheme,
} from "./fixtures.js";

const TARGET = "http://localhost:8402/v1/search?q=camera";
const TX_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f801";

/** One request the fake gateway received. */
type RecordedRequest = { headers: Headers };

/**
 * A fake AWall gateway: free quota, then 402, then settlement, then credit.
 *
 * Driving the agent through a stubbed `fetch` keeps the suite off the network
 * while still exercising the real header encoding on both sides.
 *
 * @param options - Behaviour of the fake.
 * @param options.freeRequests - How many requests the free quota covers.
 * @param options.paidStatus - Status to answer the paid request with.
 * @returns The fetch stub and what it received.
 */
function fakeGateway(options: { freeRequests: number; paidStatus?: number }): {
  fetch: FetchLike;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let served = 0;
  let allowance = options.freeRequests;

  const fetchStub: FetchLike = async (url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ headers });

    if (headers.has("PAYMENT-SIGNATURE")) {
      const status = options.paidStatus ?? 200;
      if (status < 400) allowance += 10_000;
      if (status >= 400) {
        return new Response(JSON.stringify({ error: "payment_verification_not_implemented" }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ items: [] }), {
        status,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-RESPONSE": encodeHeader({
            success: true,
            transaction: TX_HASH,
            network: "stellar:testnet",
            payer: PAY_TO,
          }),
          "X-AWall-Cost-Credits": "1",
          "X-AWall-Credits-Remaining": "9999",
        },
      });
    }

    served += 1;
    if (served > allowance) {
      const paymentRequired = awallPaymentRequired(url);
      return new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": encodeHeader(paymentRequired),
          "Retry-After": "2",
          "X-AWall-Identity": "idt_test",
          "X-AWall-Cost-Credits": "1",
          "X-AWall-Credits-Remaining": "0",
        },
      });
    }

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-AWall-Cost-Credits": "1",
        "X-AWall-Free-Remaining-Credits": String(allowance - served),
      },
    });
  };

  return { fetch: fetchStub, requests };
}

/**
 * Build the payment client over the fake scheme.
 *
 * @returns The client and the requirements the scheme was asked to sign.
 */
function paymentClient(): {
  payments: PaymentClient;
  signed: ReturnType<typeof fakeExactStellarScheme>["signed"];
} {
  const { scheme, signed } = fakeExactStellarScheme();
  const payments = createPaymentClient({
    network: "stellar:testnet",
    scheme,
    // The fake XDR is not a transaction, so leave the envelope alone.
    clampFeeStroops: false,
  });
  return { payments, signed };
}

describe("runAgent", () => {
  it("takes the 402, signs the exact rail and repeats the request", async () => {
    const gateway = fakeGateway({ freeRequests: 1 });
    const { payments, signed } = paymentClient();
    const lines: string[] = [];

    const summary = await runAgent(
      { url: TARGET, requests: 3, intervalMs: 0, dryRun: false },
      { fetch: gateway.fetch, payments, log: line => lines.push(line), sleep: async () => {} },
    );

    expect(signed).toHaveLength(1);
    expect(signed[0]?.scheme).toBe("exact");
    expect(signed[0]?.network).toBe("stellar:testnet");
    expect(signed[0]?.amount).toBe("6800000");

    expect(summary.payments).toHaveLength(1);
    expect(summary.payments[0]?.accepted.scheme).toBe("exact");
    expect(summary.payments[0]?.transactionXdr).toBe(FAKE_XDR);
    expect(summary.payments[0]?.txHash).toBe(TX_HASH);
    expect(summary.stoppedBecause).toBeUndefined();
    expect(summary.responses).toEqual({ 200: 3, 402: 1 });
  });

  it("sends the payload in the shape the Stellar binding specifies", async () => {
    const gateway = fakeGateway({ freeRequests: 0 });
    const { payments } = paymentClient();

    await runAgent(
      { url: TARGET, requests: 1, intervalMs: 0, dryRun: false },
      { fetch: gateway.fetch, payments, log: () => {}, sleep: async () => {} },
    );

    const paid = gateway.requests.find(request => request.headers.has("PAYMENT-SIGNATURE"));
    expect(paid).toBeDefined();
    const payload = decodeHeader(paid?.headers.get("PAYMENT-SIGNATURE") ?? "");
    expect(payload).toMatchObject({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "stellar:testnet",
        amount: "6800000",
        asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
        maxTimeoutSeconds: 60,
      },
      payload: { transaction: FAKE_XDR },
    });
    // The spec allows exactly one field in the Stellar payload.
    expect(Object.keys(Object(Object(payload)["payload"]))).toEqual(["transaction"]);
  });

  it("reports both rails and the amounts of the 402", async () => {
    const gateway = fakeGateway({ freeRequests: 0 });
    const { payments } = paymentClient();
    const lines: string[] = [];

    await runAgent(
      { url: TARGET, requests: 1, intervalMs: 0, dryRun: true },
      { fetch: gateway.fetch, payments, log: line => lines.push(line), sleep: async () => {} },
    );

    const output = lines.join("\n");
    expect(output).toContain("rail exact");
    expect(output).toContain("0.6800000 USDC (6800000)");
    expect(output).toContain("rail pix");
    expect(output).toContain("R$ 3,94 (394)");
    expect(output).toContain("pack 10000 credits");
    expect(output).toContain("Free quota exhausted");
  });

  it("stops after printing the signed XDR on a dry run", async () => {
    const gateway = fakeGateway({ freeRequests: 0 });
    const { payments } = paymentClient();
    const lines: string[] = [];

    const summary = await runAgent(
      { url: TARGET, requests: 5, intervalMs: 0, dryRun: true },
      { fetch: gateway.fetch, payments, log: line => lines.push(line), sleep: async () => {} },
    );

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests.every(request => !request.headers.has("PAYMENT-SIGNATURE"))).toBe(
      true,
    );
    expect(lines).toContain(FAKE_XDR);
    expect(summary.stoppedBecause).toBe("dry run");
    expect(summary.payments[0]?.paidStatus).toBeUndefined();
  });

  it("stops and says so when the paid request is refused", async () => {
    const gateway = fakeGateway({ freeRequests: 0, paidStatus: 501 });
    const { payments } = paymentClient();
    const lines: string[] = [];

    const summary = await runAgent(
      { url: TARGET, requests: 5, intervalMs: 0, dryRun: false },
      { fetch: gateway.fetch, payments, log: line => lines.push(line), sleep: async () => {} },
    );

    expect(summary.stoppedBecause).toBe("paid request answered 501");
    expect(summary.payments[0]?.paidStatus).toBe(501);
  });

  it("stops when the 402 carries no readable terms", async () => {
    const brokenFetch: FetchLike = async () =>
      new Response("{}", { status: 402, headers: { "Content-Type": "application/json" } });
    const { payments } = paymentClient();
    const lines: string[] = [];

    const summary = await runAgent(
      { url: TARGET, requests: 2, intervalMs: 0, dryRun: false },
      { fetch: brokenFetch, payments, log: line => lines.push(line), sleep: async () => {} },
    );

    expect(summary.stoppedBecause).toBe("undecodable 402");
    expect(lines.join("\n")).toContain("cannot read the 402 terms");
  });
});
