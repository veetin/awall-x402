# Scheme: `pix`

> Status: draft, proposed by the AWall project. Written against x402 v2
> (`specs/x402-specification-v2.md`) and the HTTP transport
> (`specs/transports-v2/http.md`) of the `coinbase/x402` repository, following the
> structure of the official scheme templates. This document is in English so it can
> be proposed upstream; the rest of this repository is in Portuguese.

## Summary

`pix` settles an x402 payment through **Pix**, the instant payment system operated
by the Central Bank of Brazil (Banco Central do Brasil). It is a fiat scheme: no
blockchain, no client-side cryptographic authorization.

The scheme exists for a case the crypto-native schemes do not cover: an
**assisted agent**, where a human is in the loop and expects to pay the way they
pay for everything else in Brazil. A resource server can advertise `exact`
and `pix` side by side in the same `accepts` array, letting an autonomous agent
settle on its own while a human-supervised agent hands a QR code to its operator.
Both paths grant the same access. The reference deployment pairs this scheme with
`exact` on `stellar:testnet`.

Because a Pix transfer cannot be authorized by a signature the client holds, this
scheme inverts where the proof lives: the resource server (or its facilitator)
creates a charge out of band, and the client's payload carries a **reference** to
that charge rather than an authorization over the payer's funds. Verification is a
lookup against the payment service provider, not a signature check.

## Use Cases

- A human-supervised research or procurement agent that exceeds an API's free
  quota and needs its operator to approve a small payment to continue.
- A Brazilian consumer application whose users have no wallet and no stablecoin
  balance, but settle a R$ 5 charge in seconds from a banking app.
- Any resource server that wants one 402 response to serve both machine payers and
  human payers.

## Identifiers

| Field | Value |
| --- | --- |
| `scheme` | `pix` |
| `network` | `pix:bcb` |
| `asset` | `BRL` (ISO 4217 currency code) |
| `amount` | integer string, in centavos (1/100 BRL) |
| `payTo` | `merchant` (role constant) or a Pix key owned by the payee |

The core specification permits an ISO 4217 currency code in `asset` and a role
constant in `payTo`, so no protocol extension is needed to express a fiat rail.
`network` uses the CAIP-2-style namespace `pix` with the reference `bcb`, naming
the payment arrangement and its operator rather than a chain.

## Payment flow

`paymentFlow`: **`upfront`** — `settle` → resource → respond.

A confirmed Pix transfer is terminal and irreversible by the payer, and it must
precede access, so there is nothing for a pre-resource `/verify` to decide that
`settle` does not already establish. A facilitator MAY still expose `/verify` as a
read-only status probe for clients that poll, but the ordering above does not
include it.

`assetTransferMethod`: `pixCharge` (default, and the only one defined here). A
charge is created by the payee side; the payer transfers to it; confirmation is
observed by the payee side.

## Payment Requirements

A `PaymentRequirements` entry for this scheme:

```json
{
  "scheme": "pix",
  "network": "pix:bcb",
  "amount": "394",
  "asset": "BRL",
  "payTo": "merchant",
  "maxTimeoutSeconds": 900,
  "extra": {
    "assetTransferMethod": "pixCharge",
    "paymentFlow": "upfront",
    "chargeId": "ofr_01JDX7QMV3",
    "checkoutUrl": "https://awall.demo/pay/ofr_01JDX7QMV3",
    "statusUrl": "https://api.awall.demo/awall/offers/ofr_01JDX7QMV3",
    "brCode": "00020126580014br.gov.bcb.pix...",
    "expiresAt": "2026-11-28T18:42:00Z"
  }
}
```

`extra` fields:

| Field | Required | Description |
| --- | --- | --- |
| `chargeId` | yes | Server-side identifier of the charge. Single-use. |
| `checkoutUrl` | yes | HTTPS page a human can open to pay (QR code and copy-and-paste code). |
| `statusUrl` | yes | HTTPS endpoint a client polls for charge status. |
| `brCode` | no | The Pix copy-and-paste payload (EMV QR). Present when the server can emit it inline. |
| `expiresAt` | no | RFC 3339 instant after which the charge is void. Redundant with `maxTimeoutSeconds`, but absolute. |

`maxTimeoutSeconds` SHOULD be at least 300. A human needs time to open a banking
app; a 60-second window is not usable for this scheme.

## Payment payload

The client does not sign anything. It references the charge it was given:

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/v1/search?q=camera" },
  "accepted": {
    "scheme": "pix",
    "network": "pix:bcb",
    "amount": "394",
    "asset": "BRL",
    "payTo": "merchant",
    "maxTimeoutSeconds": 900,
    "extra": { "chargeId": "ofr_01JDX7QMV3" }
  },
  "payload": {
    "chargeId": "ofr_01JDX7QMV3",
    "endToEndId": "E000000002026112818420012345678"
  },
  "extensions": {}
}
```

| Field | Required | Description |
| --- | --- | --- |
| `chargeId` | yes | MUST equal the `chargeId` advertised in the requirements. |
| `endToEndId` | no | Pix end-to-end identifier of the transfer, when the payer side can supply it. Used for reconciliation, never as the sole proof. |

A client MAY omit the payment payload entirely and simply retry the original
request once `statusUrl` reports the charge as paid, if the resource server binds
charges to caller identity at issue time. That is a server policy, not part of
this scheme.

## Verification

Verification is a status lookup, not a cryptographic check. The verifier MUST:

1. Load the charge by `payload.chargeId` from its own records. Reject with
   `invalid_pix_charge_unknown` if absent.
2. Reject with `invalid_pix_charge_expired` if the charge is past its expiry.
3. Reject with `invalid_pix_charge_already_consumed` if the charge has already
   granted access.
4. Compare the charge's recorded amount against `requirements.amount`. Reject with
   `invalid_pix_charge_amount_mismatch` on any difference. The amount MUST come
   from the verifier's own record of the charge, never from the client payload.
5. Query the payment service provider for the charge status. Treat only an
   explicit paid state as paid. A provider webhook MAY trigger this query but MUST
   NOT be accepted as the source of truth on its own.
6. Reject with `invalid_pix_charge_not_paid` if the charge is not settled yet. This
   is a non-terminal condition: the client is expected to poll and retry.

## Settlement

For `pixCharge`, funds have already moved when the charge reports paid. Settlement
is therefore the act of **consuming** the charge:

1. Confirm the paid status with the provider (step 5 above).
2. Atomically mark the charge consumed and grant access. The transition from
   unconsumed to consumed MUST be atomic and idempotent, keyed by `chargeId`, so
   that a duplicate webhook or a retried settle grants access exactly once.
3. Return a `SettlementResponse`:

```json
{
  "success": true,
  "transaction": "E000000002026112818420012345678",
  "network": "pix:bcb",
  "payer": ""
}
```

`transaction` carries the Pix end-to-end identifier when known, which is the
closest fiat analogue to a transaction hash. `payer` is an empty string: exposing
the payer's name, CPF or institution to the resource server would leak personal
data that the access decision does not need.

Refunds are out of scope. Pix supports a refund mechanism, but a refund does not
retroactively revoke consumed access, and modelling that belongs to a scheme with
an explicit dispute phase.

## Error codes

In addition to the core x402 error codes:

| Code | Meaning |
| --- | --- |
| `invalid_pix_charge_unknown` | `chargeId` is not known to the verifier |
| `invalid_pix_charge_expired` | charge expired before payment |
| `invalid_pix_charge_not_paid` | charge exists and is still awaiting payment (non-terminal) |
| `invalid_pix_charge_amount_mismatch` | recorded charge amount differs from the required amount |
| `invalid_pix_charge_already_consumed` | charge already granted access |
| `unsupported_asset` | asset other than `BRL` requested for this scheme |

## Security considerations

- **The charge identifier is a capability.** Anyone holding `chargeId` can claim
  the access it buys. It MUST be unguessable (at least 128 bits of entropy) and
  SHOULD be bound to the caller identity that received the 402, so a leaked
  identifier cannot be redeemed by a third party.
- **No trust in the client payload.** Amount, expiry and payee are read from the
  verifier's record of the charge. The `accepted` object echoed by the client is
  checked for agreement and otherwise ignored.
- **Webhooks are triggers, not proof.** Provider callbacks are forgeable and
  replayable. Signature validation is necessary and not sufficient: confirm by
  querying the provider.
- **Single use.** Consumption is keyed by `chargeId` under a uniqueness
  constraint, which is what makes duplicate webhooks and retried settles safe.
- **No payer identity disclosure.** The scheme deliberately returns an empty
  `payer`. Brazilian payment data is personal data; the resource server has no
  need for it.
- **Trust assumption differs from crypto schemes.** The x402 design goal that a
  facilitator cannot move funds against client intent holds here only because the
  payer initiates the transfer in their own banking application. In exchange,
  settlement finality depends on the payment service provider, which is a trusted
  third party in a way an on-chain facilitator is not. Implementers should state
  this plainly rather than present the two rails as equivalent in trust.

## Appendix

### Reference implementation

AWall implements this scheme in `packages/pix`, with AbacatePay as the payment
service provider (`POST /v1/pixQrCode/create`, status polling, and a signed
webhook). The provider is an adapter: any Pix PSP that can create a charge and
report its status satisfies the scheme.

### Why not an extension instead of a scheme

An extension describes optional data carried alongside a payment. A fiat rail
changes how value moves, how verification works, and the order of settlement
relative to resource execution — which is precisely what the scheme layer is for.
