import { limitsFor, type BucketLimits } from "./bucket.js";
import type { RouteTable } from "./match.js";
import type { Policy, Route } from "./types.js";

/** What the gateway should do with a request, before any payment is considered. */
export type Decision =
  /** Not in the policy and `defaults.unmatched` is `deny`: answer 404. */
  | { kind: "deny"; reason: "route_not_configured" }
  /** Proxy without charging: a `free: true` route, or `unmatched: free`. */
  | { kind: "free"; route?: Route }
  /** Proxy after spending credits from the bucket named by `scope`. */
  | {
      kind: "charge";
      credits: number;
      metered: boolean;
      /** Bucket scope: the route pattern when it has its own quota, else `"shared"`. */
      scope: string;
      limits: BucketLimits;
      route?: Route;
    };

/** Bucket scope shared by every route without a `free_tier` of its own. */
export const SHARED_SCOPE = "shared";

/**
 * Resolve what a request costs and which quota it spends.
 *
 * @param policy - Loaded policy.
 * @param routes - Pre-parsed route table for that policy.
 * @param method - HTTP method.
 * @param path - Request path, without query string.
 * @returns The decision for this request.
 */
export function decide(
  policy: Policy,
  routes: RouteTable,
  method: string,
  path: string,
): Decision {
  const route = routes.find(method, path);

  if (!route) {
    switch (policy.defaults.unmatched) {
      case "deny":
        return { kind: "deny", reason: "route_not_configured" };
      case "free":
        return { kind: "free" };
      case "charge":
        return {
          kind: "charge",
          credits: policy.defaults.credits,
          metered: false,
          scope: SHARED_SCOPE,
          limits: limitsFor(policy.free_tier),
        };
    }
  }

  if (route.free) return { kind: "free", route };

  return {
    kind: "charge",
    // The schema guarantees `credits` whenever the route is not free.
    credits: route.credits ?? policy.defaults.credits,
    metered: route.metered,
    scope: route.free_tier ? route.match : SHARED_SCOPE,
    limits: limitsFor(route.free_tier ?? policy.free_tier),
    route,
  };
}
