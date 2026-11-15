# @awall/settlement

Lado servidor da liquidação x402, como biblioteca pura. Este pacote é a casa
canônica dos tipos do protocolo, do codec dos headers, do cliente do facilitator
e da revalidação dos termos que voltam do cliente.

Não faz I/O além do `fetch` que você injeta. Não conhece Hono, Postgres nem o
ledger de créditos: quem orquestra é `apps/gateway`.

Base normativa: `specs/x402-specification-v2.md`, `specs/transports-v2/http.md` e
`specs/schemes/exact/scheme_exact_stellar.md` do repositório `coinbase/x402`,
mais [docs/03-protocolo.md](../../docs/03-protocolo.md).

## Por que `@x402/core` e não `x402`

O pacote `x402` sem escopo é **v1**. O binding Stellar declara explicitamente que
v1 não será suportado, então usá-lo seria escrever código morto. Os pacotes v2
são escopados (`@x402/*`, série 2.x).

Este pacote depende de `@x402/core@^2.31.0` e importa de `@x402/core/types` **só
tipos** (`import type`), portanto nada dele entra no bundle de runtime — nem a
dependência de `zod` que ele carrega. Os tipos estruturais (`PaymentRequired`,
`PaymentRequirements`, `PaymentPayload`, `VerifyResponse`, `SettleResponse`,
`SupportedResponse`, `SupportedKind`, `ResourceInfo`, `Network`) conferem campo a
campo com a especificação v2, e reexportá-los mantém uma definição só no
workspace: se a especificação mudar, a atualização do pacote vira erro de
compilação em vez de divergência silenciosa.

O que `@x402/core` **não** resolve e este pacote acrescenta:

| Lacuna | O que fazemos |
| --- | --- |
| `errorReason` e `invalidReason` são `string` cru | catálogo `KNOWN_ERROR_REASONS` com os códigos da especificação e os 30 do binding Stellar |
| `HTTPFacilitatorClient` **lança** `VerifyError`, `SettleError`, `FacilitatorTimeoutError` | `FacilitatorClient` devolve resultado tipado; falha de pagamento é 402 com `errorReason`, não 500 |
| não distingue falha terminal de `settlement_pending` | `SettleOutcome` tem três estados: `settled`, `pending`, `failed` |
| decode de header não é tolerante a lixo | `decodeHeader` nunca lança; entrada inválida devolve `DecodeError` |
| nada revalida o `accepted` do cliente | `revalidateAccepted` compara os seis campos que decidem dinheiro |

Os códigos `invalid_exact_stellar_payload_*` não estão enumerados em prosa na
especificação do binding — ela nomeia apenas
`invalid_exact_stellar_payload_fee_exceeds_maximum`. Os outros 29 foram extraídos
da implementação de referência `@x402/stellar@2.28.0`, a mesma versão fixada em
[AGENTS.md](../../AGENTS.md). O tipo `ErrorReason` é `KnownErrorReason | (string
& {})`: código conhecido autocompleta, código novo de um facilitator ainda
compila.

## Como o gateway usa: verify → settle → credita

O trilho `exact` na Stellar usa o payment flow `authorization` (o default):
verifica antes de executar a origin, liquida depois. Os fundos só se movem quando
a resposta já está pronta.

```ts
import {
  FacilitatorClient,
  decodePaymentPayload,
  encodeHeader,
  revalidateAccepted,
} from "@awall/settlement";

const facilitator = new FacilitatorClient({
  baseUrl: process.env.X402_FACILITATOR_URL ?? "https://www.x402.org/facilitator",
  timeoutMs: 10_000,
});

// 1. Ler o header. Vem do cliente, então nunca lança.
const header = request.header("PAYMENT-SIGNATURE");
const decoded = decodePaymentPayload(header ?? "");
if (!decoded.ok) {
  return respond402({ errorReason: "invalid_payload" }); // decoded.error.kind no log
}
const payload = decoded.value;

// 2. Revalidar contra a offer gravada. O `amount` vem do banco, nunca do payload.
const offer = await ledger.findOffer(payload.accepted.extra.offerId);
const expected = buildRequirements(offer); // amount = offer.usdcAtomic
const check = revalidateAccepted(payload.accepted, expected);
if (!check.ok) {
  return respond402({ errorReason: check.errorReason }); // check.field diz o que divergiu
}

// 3. /verify — leitura, não move dinheiro.
const verified = await facilitator.verify(payload, expected);
if (!verified.ok) {
  return respond402({ errorReason: "unexpected_verify_error" }); // verified.failure no log
}
if (verified.value.status === "invalid") {
  return respond402({ errorReason: verified.value.invalidReason });
}

// 4. Executar a origin. Só agora.
const originResponse = await proxyToOrigin(request);

// 5. /settle — compromete o pagamento.
const settled = await facilitator.settle(payload, expected);
if (!settled.ok) {
  // Timeout no settle deixa o estado do pagamento desconhecido: não credite,
  // não trate como falha terminal, registre para reconciliação manual.
  return respond402({ errorReason: "unexpected_settle_error" });
}

switch (settled.value.status) {
  case "settled":
    // 6. Idempotência pelo hash e crédito na MESMA transação de banco.
    await ledger.creditOnce({
      idempotencyKey: settled.value.transaction,
      identityId,
      deltaCredits: offer.packCredits,
    });
    break;
  case "pending":
    // Não terminal: a transação foi transmitida e pode confirmar depois.
    // Não credita e não devolve falha definitiva; enfileira reconciliação pelo
    // hash. `reconcilable: false` é violação da especificação pelo facilitator
    // (pending sem hash), e aí não há o que reconciliar.
    await ledger.enqueueReconciliation(settled.value.transaction, identityId);
    return respond402({ errorReason: settled.value.errorReason });
  case "failed":
    return respond402({ errorReason: settled.value.errorReason });
}

// 7. Responder com o recibo.
originResponse.headers.set("PAYMENT-RESPONSE", encodeHeader(settled.value.response));
return originResponse;
```

Na partida do processo, confirme que o facilitator atende o par configurado. A
falha que isso pega — facilitator que não fala `exact` em `stellar:testnet` —
caso contrário só aparece no primeiro pagamento real:

```ts
const supported = await facilitator.supported();
if (supported.ok) {
  const check = checkStellarExactSupport(supported.value, config.network);
  if (!check.supported) {
    logger.error({ event: "facilitator_pair_unsupported", reason: check.reason });
  }
}
```

## Superfície

### Tipos e códigos de erro

`PaymentRequired`, `PaymentRequirements`, `PaymentPayload`, `VerifyResponse`,
`SettlementResponse` (mesmo objeto que `@x402/core` chama `SettleResponse`),
`SupportedResponse`, `SupportedKind`, `ResourceInfo`, `Network`,
`VerifyRequest`, `SettleRequest`.

`KNOWN_ERROR_REASONS`, `PROTOCOL_ERROR_REASONS`,
`STELLAR_VERIFY_ERROR_REASONS`, `STELLAR_SETTLE_ERROR_REASONS`,
`NON_TERMINAL_ERROR_REASONS`, `isKnownErrorReason`, `isNonTerminalErrorReason`,
`isStellarErrorReason`.

Constantes: `HEADER_PAYMENT_REQUIRED`, `HEADER_PAYMENT_SIGNATURE`,
`HEADER_PAYMENT_RESPONSE`, `X402_VERSION`.

### Codec

`encodeHeader(value)` devolve base64 do JSON UTF-8.

`decodeHeader(header)` devolve `{ ok: true, value }` ou
`{ ok: false, error: { kind, message } }`, com `kind` em `empty`, `not_base64`,
`not_utf8_json`, `not_object`, `shape_mismatch`. Tolera espaço em branco,
alfabeto base64url, padding ausente e bytes truncados. **Nunca lança.**

`decodePaymentRequired`, `decodePaymentPayload`, `decodeSettlementResponse`
decodificam e validam a forma. `decodeHeaderAs(header, guard, nome)` faz o mesmo
com um guard seu. Os guards (`isPaymentRequirements`, `isPaymentRequired`,
`isPaymentPayload`, `isSettlementResponse`) também são exportados.

### `FacilitatorClient`

```ts
new FacilitatorClient({ baseUrl, fetch?, timeoutMs?, headers? });
```

`fetch` e `timeoutMs` (default `DEFAULT_TIMEOUT_MS = 10_000`) são injetáveis —
toda a suíte roda sem rede. `headers` serve para facilitator privado com chave.

Os três métodos devolvem `FacilitatorResult<T>`:
`{ ok: true, value }` ou `{ ok: false, failure }`, com `failure.kind` em:

| `kind` | Quando |
| --- | --- |
| `network` | a requisição não completou: DNS, conexão, TLS |
| `timeout` | passou de `timeoutMs`; no `/settle`, o estado do pagamento é **desconhecido** |
| `http_status` | 5xx, ou status fora de 2xx sem corpo de protocolo |
| `malformed_body` | corpo não é JSON, ou falta campo obrigatório do schema |

Um veredito negativo com status 4xx **não** é falha de transporte: o corpo é
protocolo válido, e o resultado é `{ ok: true, value: { status: "invalid", ... } }`.

- `supported()` → `SupportedResponse`. Entradas que não sejam kinds v2 com rede
  CAIP-2 são descartadas; o facilitator público ainda lista linhas v1 cuja
  `network` é nome legado (`base-sepolia`), e v1 não tem binding Stellar.
- `verify(payload, requirements)` → `VerifyOutcome`: `valid` ou `invalid` com
  `invalidReason`.
- `settle(payload, requirements)` → `SettleOutcome`: `settled`, `pending` ou
  `failed`.

### `revalidateAccepted(accepted, expected)`

Compara `scheme`, `network`, `asset`, `payTo`, `amount` e `maxTimeoutSeconds`,
nessa ordem, e devolve `{ ok: true }` ou
`{ ok: false, field, expected, received, errorReason }`.

- **O `amount` de referência é o do servidor.** `expected` é construído a partir
  da offer gravada no banco; o valor que o cliente mandou nunca é fonte.
- Comparação é igualdade exata de string, inclusive no `amount`: `"06800000"`
  divergem de `"6800000"`. Comparar como número aceitaria valor reescrito.
- `extra` não é comparado. Carrega dado específico de scheme e nossos
  `offerId`/`packCredits`; a identidade da offer é resolvida no banco.
- `errorReason`: `invalid_scheme` para `scheme`, `invalid_network` para
  `network`, `invalid_payment_requirements` para os outros quatro.

### Helpers Stellar

`isStellarExact(requirements)` — `scheme: "exact"` em rede `stellar:*`. Na
Stellar só existe `exact`; `upto` e `auth-capture` são EVM (e SVM, no caso do
`upto`).

`hasSponsoredFees(requirements)` — `extra.areFeesSponsored === true`,
obrigatório no binding: o cliente assina auth entries, o facilitator paga a taxa.

`checkFacilitatorSupport(supported, scheme, network)` e
`checkStellarExactSupport(supported, network)` — devolvem
`{ supported: true, kind }` ou `{ supported: false, reason }`, com `reason` em
`network_not_supported`, `scheme_not_supported`, `x402_version_not_supported`.

`STELLAR_USDC_DECIMALS = 7`. Não 6. 0,50 USDC são `"5000000"`; exemplo copiado de
EVM erra o valor em 10×.

## Testes

```
pnpm --filter @awall/settlement test
pnpm --filter @awall/settlement typecheck
```

A suíte não toca a rede: `fetch` é stubado em todos os testes do cliente. O único
teste que bate no facilitator público (`GET /supported`) fica pulado a menos que
você peça:

```
X402_LIVE_TEST=1 pnpm --filter @awall/settlement test
```

## O que este pacote não faz

- **Não constrói transação Stellar nem assina auth entries.** Isso é o lado
  cliente, em `apps/agent-m2m`.
- **Não credita nada.** Idempotência e ledger append-only são de
  `packages/ledger`; este pacote devolve o hash da transação para servir de
  chave.
- **Não implementa o trilho `pix`.** O scheme próprio vive em `packages/pix` e
  não tem `/verify`.
- **Não reconcilia `settlement_pending`.** Marca o caso e entrega o hash; o laço
  de reconciliação é do gateway.
- **Não monta o objeto `PaymentRequired`.** Preço, offer e multiplicador de abuso
  são de `packages/policy` e do gateway.
