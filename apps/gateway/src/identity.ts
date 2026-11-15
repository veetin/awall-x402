import { createHash } from "node:crypto";

export type Identity = {
  id: string;
  kind: "api_key" | "wallet" | "fingerprint";
  /** Abuse score in [0, 1]. Always 0 until the scoring step lands. */
  abuseScore: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function apiKeyFrom(headers: Headers): string | undefined {
  const direct = headers.get("x-api-key");
  if (direct) return direct;
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return undefined;
}

/**
 * In-memory identity registry.
 *
 * Only an API key or a request fingerprint is resolved for now; wallet-based
 * identity arrives with settlement. See docs/02-arquitetura.md.
 */
export class IdentityStore {
  private readonly byId = new Map<string, Identity>();

  /**
   * Resolve who is calling.
   *
   * @param headers - Request headers.
   * @param remoteAddress - Socket address, used only in the fallback.
   * @returns The identity, created on first sight.
   */
  resolve(headers: Headers, remoteAddress: string): Identity {
    const apiKey = apiKeyFrom(headers);
    const identity: Identity = apiKey
      ? { id: `idt_k_${sha256(apiKey).slice(0, 16)}`, kind: "api_key", abuseScore: 0 }
      : {
          id: `idt_f_${sha256(`${remoteAddress}|${headers.get("user-agent") ?? ""}`).slice(0, 16)}`,
          kind: "fingerprint",
          abuseScore: 0,
        };
    const known = this.byId.get(identity.id);
    if (known) return known;
    this.byId.set(identity.id, identity);
    return identity;
  }

  all(): Identity[] {
    return [...this.byId.values()];
  }
}
