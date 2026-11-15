import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

/**
 * Rebuild a signed Soroban transaction with a lower fee.
 *
 * The facilitator is the transaction source and pays the fee
 * (`extra.areFeesSponsored`), so the fee the client puts in the envelope is not
 * what gets charged. The public testnet facilitator rejects envelopes above its
 * own fee limit, and the Stellar x402 quickstart works around it by cloning the
 * transaction with a 1 stroop fee. The auth entries live in the operation, so
 * cloning keeps the signatures.
 *
 * @param xdr - Base64 XDR of the signed transaction.
 * @param networkPassphrase - Network passphrase the transaction was built for.
 * @param feeStroops - Inclusion fee to set, in stroops. The builder adds the
 *   Soroban resource fee on top, so the envelope ends up at
 *   `resourceFee + feeStroops`.
 * @returns Base64 XDR of the rebuilt transaction, or the input when it carries
 *   no Soroban data to clone.
 */
export function clampSorobanFee(
  xdr: string,
  networkPassphrase: string,
  feeStroops: string,
): string {
  const transaction = new Transaction(xdr, networkPassphrase);
  const envelope = transaction.toEnvelope();
  if (envelope.switch().name !== "envelopeTypeTx") return xdr;
  const extension = envelope.v1().tx().ext();
  if (extension.switch() !== 1) return xdr;
  return TransactionBuilder.cloneFrom(transaction, {
    fee: feeStroops,
    sorobanData: extension.sorobanData(),
    networkPassphrase,
  })
    .build()
    .toXDR();
}
