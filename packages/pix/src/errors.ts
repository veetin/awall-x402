/** Error codes of the `pix` scheme, from the "Error codes" table of the spec. */
export type PixErrorCode =
  | "invalid_pix_charge_unknown"
  | "invalid_pix_charge_expired"
  | "invalid_pix_charge_not_paid"
  | "invalid_pix_charge_amount_mismatch"
  | "invalid_pix_charge_already_consumed"
  | "unsupported_asset";

/**
 * `invalid_pix_charge_not_paid` is non-terminal: the payer may still pay inside
 * the charge window, so the client is expected to poll and retry. Every other
 * code is terminal for that charge.
 */
export function isTerminalPixError(code: PixErrorCode): boolean {
  return code !== "invalid_pix_charge_not_paid";
}
