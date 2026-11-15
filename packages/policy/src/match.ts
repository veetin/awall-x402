import type { Policy, Route } from "./types.js";

type ParsedRoute = { method: string; prefix: string; wildcard: boolean; route: Route };

/** Pre-parsed route table, so matching does no string splitting per request. */
export class RouteTable {
  private readonly parsed: ParsedRoute[];

  constructor(policy: Policy) {
    this.parsed = policy.routes.map(route => {
      const [method, pattern] = route.match.split(/\s+/, 2);
      if (!method || !pattern) {
        throw new Error(`invalid route match: ${route.match}`);
      }
      const wildcard = pattern.endsWith("*");
      return {
        method: method.toUpperCase(),
        prefix: wildcard ? pattern.slice(0, -1) : pattern,
        wildcard,
        route,
      };
    });
  }

  /**
   * Find the route rule for a request.
   *
   * @param method - HTTP method.
   * @param path - Request path, without query string.
   * @returns The matching route, or undefined when no rule applies.
   */
  find(method: string, path: string): Route | undefined {
    const upper = method.toUpperCase();
    for (const entry of this.parsed) {
      if (entry.method !== upper) continue;
      const hit = entry.wildcard ? path.startsWith(entry.prefix) : path === entry.prefix;
      if (hit) return entry.route;
    }
    return undefined;
  }
}
