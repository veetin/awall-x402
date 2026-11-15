import type { AbacatePayClient, AbacatePayError } from "./client.js";
import { err, ok, type Result } from "./result.js";
import { isPaidStatus, type ChargeStatus } from "./types.js";

export interface PaidConfirmation {
  readonly chargeId: string;
  readonly paid: boolean;
  readonly status: ChargeStatus;
  readonly expiresAt: string | null;
}

/**
 * Confirms a payment by asking the provider, which is the only source of truth
 * for a Pix charge (AGENTS.md: "webhook é gatilho, não fonte de verdade").
 * A webhook may trigger this call; the status in its body is never accepted.
 */
export async function confirmPaid(
  client: AbacatePayClient,
  chargeId: string,
): Promise<Result<PaidConfirmation, AbacatePayError>> {
  const status = await client.getChargeStatus(chargeId);
  if (!status.ok) return err(status.error);
  return ok({
    chargeId: status.value.chargeId,
    paid: isPaidStatus(status.value.status),
    status: status.value.status,
    expiresAt: status.value.expiresAt,
  });
}
