import { createHash } from "node:crypto";
import type { EnsureIdentityInput } from "@awall/ledger";

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
 * Derive a stable identity from the request.
 *
 * The id is a hash, not a random nanoid, so the same key resolves to the same
 * row after a restart. The API key itself is never stored: only its SHA-256.
 *
 * @param headers - Request headers.
 * @param remoteAddress - Socket address, used only in the fingerprint fallback.
 * @returns The identity to upsert.
 */
export function describeIdentity(headers: Headers, remoteAddress: string): EnsureIdentityInput {
  const apiKey = apiKeyFrom(headers);
  if (apiKey) {
    const hash = sha256(apiKey);
    return {
      id: `idt_k_${hash.slice(0, 16)}`,
      kind: "api_key",
      apiKeyHash: hash,
    };
  }
  const fingerprint = sha256(`${remoteAddress}|${headers.get("user-agent") ?? ""}`);
  return {
    id: `idt_f_${fingerprint.slice(0, 16)}`,
    kind: "fingerprint",
    fingerprint,
  };
}
