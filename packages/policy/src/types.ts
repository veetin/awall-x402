import { z } from "zod";

/** A route rule: an HTTP method, a path pattern and the credits it costs. */
export const routeSchema = z.object({
  /** `"<METHOD> <path pattern>"`, where the pattern may end in `*`. */
  match: z.string().min(3),
  /** Compute units charged for this route. */
  credits: z.number().int().positive(),
  /**
   * When true, the cost is recomputed after the origin responds, from usage the
   * origin reports (tokens, bytes). Metering is off-chain; Stellar has no `upto`
   * scheme. See docs/03-protocolo.md.
   */
  metered: z.boolean().default(false),
});

export const policySchema = z.object({
  /** Base URL of the protected API. */
  origin: z.string().url(),
  free_tier: z.object({
    window_seconds: z.number().int().positive(),
    credits: z.number().int().positive(),
    burst: z.number().int().nonnegative(),
  }),
  pricing: z.object({
    /** Compute units a single payment buys. */
    pack_credits: z.number().int().positive(),
    /** Decimal string, in whole USDC. Converted to atomic units with 7 decimals. */
    price_usdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
    price_brl_cents: z.number().int().positive(),
    /** Upper bound of the abuse price multiplier. */
    max_multiplier: z.number().min(1),
  }),
  routes: z.array(routeSchema).min(1),
});

export type Route = z.infer<typeof routeSchema>;
export type Policy = z.infer<typeof policySchema>;
