import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { BucketStore, RouteTable, priceFor, type Policy } from "@awall/policy";
import type { GatewayConfig } from "./config.js";
import { IdentityStore } from "./identity.js";
import { OfferStore } from "./offers.js";
import { forward } from "./proxy.js";
import { buildPaymentRequired, encodeHeader } from "./x402.js";

/**
 * Best-effort client address, used only by the fingerprint fallback.
 *
 * Behind an edge proxy the socket address is the proxy's, which would collapse
 * every anonymous caller into one identity, so `X-Forwarded-For` wins when the
 * operator says the edge can be trusted. `getConnInfo` needs a real Node socket,
 * which `app.request` in tests does not provide, so a failure here must not fail
 * the request.
 *
 * @param c - Request context.
 * @param trustProxy - Whether `X-Forwarded-For` may be believed.
 * @returns The client address, or `"unknown"`.
 */
function remoteAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // no socket (tests, or a non-node runtime)
  }
  return "unknown";
}

/**
 * Build the gateway application.
 *
 * @param config - Gateway configuration.
 * @param policy - Loaded policy.
 * @returns A Hono app, ready to serve or to drive from tests.
 */
export function createApp(config: GatewayConfig, policy: Policy) {
  const routes = new RouteTable(policy);
  const identities = new IdentityStore();
  const offers = new OfferStore();
  const buckets = new BucketStore(
    policy.free_tier.credits + policy.free_tier.burst,
    policy.free_tier.credits / policy.free_tier.window_seconds,
  );

  const app = new Hono();

  app.get("/healthz", c => c.json({ ok: true, network: config.network }));

  app.get("/awall/offers/:id", c => {
    const offer = offers.get(c.req.param("id"));
    if (!offer) return c.json({ error: "offer_not_found" }, 404);
    if (offer.status === "paid") {
      return c.json({ status: "paid", creditedCredits: offer.packCredits });
    }
    if (offer.status === "expired") return c.json({ status: "expired" }, 410);
    return c.json({ status: "pending" }, 202);
  });

  app.all("*", async c => {
    const identity = identities.resolve(
      c.req.raw.headers,
      remoteAddress(c, config.trustProxy),
    );
    const path = new URL(c.req.url).pathname;
    const route = routes.find(c.req.method, path);

    if (!route) {
      return c.json({ error: "route_not_configured", path }, 404);
    }

    // Settlement lands in the next step of the roadmap (docs/05-roadmap.md).
    // Until then, say so instead of pretending a payment was accepted.
    if (c.req.header("payment-signature")) {
      return c.json(
        { error: "payment_verification_not_implemented", offerId: undefined },
        501,
      );
    }

    const bucket = buckets.get(identity.id);
    if (!bucket.take(route.credits)) {
      const price = priceFor(policy, identity.abuseScore);
      const offer = offers.create(identity.id, price);
      const paymentRequired = buildPaymentRequired(c.req.url, offer, config);
      c.header("PAYMENT-REQUIRED", encodeHeader(paymentRequired));
      c.header("Retry-After", "2");
      c.header("X-AWall-Identity", identity.id);
      c.header("X-AWall-Cost-Credits", String(route.credits));
      c.header("X-AWall-Credits-Remaining", "0");
      c.header("X-AWall-Abuse-Score", identity.abuseScore.toFixed(2));
      c.header("X-AWall-Price-Multiplier", price.multiplier.toFixed(2));
      return c.json(paymentRequired, 402);
    }

    const started = Date.now();
    let response: Response;
    try {
      response = await forward(c.req.raw, policy.origin);
    } catch {
      bucket.refund(route.credits);
      return c.json({ error: "origin_unreachable" }, 502);
    }

    // The client does not pay for our failure.
    if (response.status >= 500) bucket.refund(route.credits);

    // A response's own Headers are immutable, so copy them before adding ours.
    const headers = new Headers();
    for (const [name, value] of response.headers) headers.set(name, value);
    headers.set("X-AWall-Identity", identity.id);
    headers.set("X-AWall-Cost-Credits", String(route.credits));
    headers.set("X-AWall-Free-Remaining-Credits", String(bucket.remaining()));
    headers.set("X-AWall-Latency-Ms", String(Date.now() - started));

    return new Response(response.body, { status: response.status, headers });
  });

  return app;
}
