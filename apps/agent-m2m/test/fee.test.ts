import { describe, expect, it } from "vitest";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { clampSorobanFee } from "../src/fee.js";
import { USDC, PAY_TO } from "./fixtures.js";

/**
 * Build a signed `transfer` invocation locally, in the shape the scheme
 * produces. Nothing here touches the network.
 *
 * @param fee - Fee to put in the envelope, in stroops.
 * @param withSorobanData - Whether to attach Soroban resource data.
 * @returns The signed transaction.
 */
function transferTransaction(fee: string, withSorobanData = true): Transaction {
  const keypair = Keypair.random();
  const builder = new TransactionBuilder(new Account(keypair.publicKey(), "7"), {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: USDC,
        function: "transfer",
        args: [
          nativeToScVal(keypair.publicKey(), { type: "address" }),
          nativeToScVal(PAY_TO, { type: "address" }),
          nativeToScVal("5000000", { type: "i128" }),
        ],
      }),
    )
    .setTimeout(60);
  if (withSorobanData) {
    builder.setSorobanData(new SorobanDataBuilder().setResourceFee(500_000).build());
  }
  const transaction = builder.build();
  transaction.sign(keypair);
  return transaction;
}

describe("clampSorobanFee", () => {
  it("rewrites the fee of a Soroban envelope", () => {
    const original = transferTransaction("1000000");
    const clamped = new Transaction(
      clampSorobanFee(original.toXDR(), Networks.TESTNET, "1"),
      Networks.TESTNET,
    );

    // The builder folds the Soroban resource fee into the envelope fee, so
    // what the clamp sets is the inclusion fee on top of it.
    expect(original.fee).toBe("1500000");
    expect(clamped.fee).toBe("500001");
  });

  it("keeps the invocation and the Soroban data", () => {
    const original = transferTransaction("1000000");
    const clamped = new Transaction(
      clampSorobanFee(original.toXDR(), Networks.TESTNET, "1"),
      Networks.TESTNET,
    );

    expect(clamped.operations).toHaveLength(1);
    expect(clamped.operations[0]?.type).toBe("invokeHostFunction");
    expect(clamped.toEnvelope().v1().tx().ext().switch()).toBe(1);
    expect(clamped.toEnvelope().v1().tx().ext().sorobanData().resourceFee().toString()).toBe(
      "500000",
    );
    expect(clamped.source).toBe(original.source);
    expect(clamped.sequence).toBe(original.sequence);
  });

  it("leaves a transaction without Soroban data alone", () => {
    const plain = transferTransaction("1000000", false);
    expect(clampSorobanFee(plain.toXDR(), Networks.TESTNET, "1")).toBe(plain.toXDR());
  });
});
