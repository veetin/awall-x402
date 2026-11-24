import { z } from "zod";

/** A quota window: how many credits refill over how long, plus burst headroom. */
export const freeTierSchema = z.object({
  window_seconds: z.number().int().positive(),
  credits: z.number().int().positive(),
  burst: z.number().int().nonnegative().default(0),
});

/** A route rule: an HTTP method, a path pattern and the credits it costs. */
export const routeSchema = z
  .object({
    /** `"<METHOD> <path pattern>"`, where the pattern may end in `*`. */
    match: z.string().min(3),
    /** Credits charged for this route. Omitted when `free` is true. */
    credits: z.number().int().positive().optional(),
    /**
     * Never charged and never answered with 402. For health checks, login,
     * webhooks and anything that must keep working without payment.
     */
    free: z.boolean().default(false),
    /**
     * When true, the cost is recomputed after the origin responds, from usage the
     * origin reports (tokens, bytes). Metering is off-chain; Stellar has no `upto`
     * scheme. See docs/03-protocolo.md.
     */
    metered: z.boolean().default(false),
    /**
     * Quota of its own for this route, instead of the shared one. Use it to keep
     * an expensive route from eating the whole free tier.
     */
    free_tier: freeTierSchema.optional(),
  })
  .refine(route => route.free || route.credits !== undefined, {
    message: "a route needs `credits` unless it is `free: true`",
  })
  .refine(route => !(route.free && route.free_tier), {
    message: "a `free: true` route has no quota, so it cannot have `free_tier`",
  });

export const policySchema = z.object({
  /** Base URL of the protected API. */
  origin: z.string().url(),
  /** Shared quota, used by every route that has no `free_tier` of its own. */
  free_tier: freeTierSchema,
  /** What to do with a request whose route is not listed. */
  defaults: z
    .object({
      /**
       * `deny`: answer 404 and never reach the origin, so nothing is exposed by
       * accident. `free`: proxy it without charging. `charge`: proxy it at
       * `defaults.credits`.
       */
      unmatched: z.enum(["deny", "free", "charge"]).default("deny"),
      /** Cost applied when `unmatched` is `charge`. */
      credits: z.number().int().positive().default(1),
    })
    .default({ unmatched: "deny", credits: 1 }),
  pricing: z.object({
    /** Compute units a single payment buys. */
    pack_credits: z.number().int().positive(),
    /** Decimal string, in whole USDC. Converted to atomic units with 7 decimals. */
    price_usdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
    /**
     * Decimal string, in whole XLM. Same 7 decimals as every Stellar asset.
     * Advertised as a second `exact` rail next to USDC so an agent funded by
     * friendbot can pay without a USDC faucet.
     */
    price_xlm: z.string().regex(/^\d+(\.\d{1,7})?$/),
    price_brl_cents: z.number().int().positive(),
    /** Upper bound of the abuse price multiplier. */
    max_multiplier: z.number().min(1),
  }),
  routes: z.array(routeSchema).min(1),
});

export type FreeTier = z.infer<typeof freeTierSchema>;
export type Route = z.infer<typeof routeSchema>;
export type Policy = z.infer<typeof policySchema>;
