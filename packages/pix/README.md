# @awall/pix

Trilho Pix do AWall: o scheme `pix` do x402, implementado como biblioteca pura.
Nenhuma dependência de runtime, nenhum acesso a banco, nenhum servidor HTTP. O
gateway monta o 402 e grava a cobrança; este pacote só sabe falar com o provedor
de Pix e aplicar as regras de `specs/scheme_pix.md`.

Provedor: **AbacatePay** (patrocinador do Hack Brasil 2026).

## O que o pacote exporta

| Export | Para quê |
| --- | --- |
| `AbacatePayClient` | `createPixCharge` e `getChargeStatus`, com `baseUrl`, `apiKey`, `fetch` e `timeoutMs` injetáveis |
| `confirmPaid(client, chargeId)` | confirma pagamento **consultando a API**; nunca lê o status do corpo do webhook |
| `verifyWebhook(rawBody, headersOrQuery, secret, options?)` | autentica uma entrega de webhook com o que a AbacatePay realmente oferece |
| `buildPixRequirements(input)` | monta o `PaymentRequirements` do scheme `pix` |
| `verifyPixPayment(input)` | aplica a seção *Verification* da spec sobre um registro de cobrança recebido como argumento (função pura) |
| `verifyPixPaymentWithProvider(client, input)` | o mesmo, com o passo 5 consultando o provedor |
| `PixErrorCode` | união dos códigos de erro do scheme |

Falha de domínio é valor de retorno (`Result<T, E>`), não exceção: o gateway
precisa transformar falha de pagamento em 402 com `errorReason`, não em 500.
`buildPixRequirements` é a exceção e lança — oferta malformada é bug nosso e não
pode chegar ao cliente.

Dinheiro é sempre `bigint` em centavos na API deste pacote, e `string` de inteiro
no campo `amount` do `PaymentRequirements`. Nunca `number` com fração.

## O que a documentação da AbacatePay diz de verdade

Tudo abaixo foi lido em <https://docs.abacatepay.com> em 15/11/2026. Quando a
documentação não garante algo, está escrito aqui que não garante.

### Base URL e versão

Todos os endpoints ficam sob `https://api.abacatepay.com/v2`. O ambiente (Modo
Teste ou produção) é definido **pela chave de API**, não pela URL. Usar chave v1
em rota v2 (ou o contrário) devolve o erro `API key version mismatch`.

Referência: <https://docs.abacatepay.com/pages/reference/introduction>

> A rota `POST /v1/pixQrCode/create`, que aparecia no desenho inicial do projeto,
> **não existe na documentação atual**. A cobrança Pix saiu do Checkout
> Transparente. O apêndice de `specs/scheme_pix.md` foi corrigido no mesmo commit
> que introduziu este pacote.

### Criar cobrança Pix

`POST /v2/transparents/create`, autenticação `Authorization: Bearer <chave>`,
permissão `TRANSPARENT:CREATE`.

Corpo: `method: "PIX"` e, dentro de `data`, `amount` (centavos, **mínimo 100**),
`expiresIn` (segundos, **mínimo 300**), `description` (até 500 caracteres),
`externalId` (idempotência do lado do provedor), `metadata`, e opcionalmente
`customer`, `ensureSameTaxId`, `utm`, `splits`.

Resposta (envelope `{ data, success, error }`), campos usados aqui:

| Campo | Uso no pacote |
| --- | --- |
| `data.id` | `chargeId` (prefixo `pix_char_`) |
| `data.amount` | valor em centavos, convertido para `bigint` |
| `data.status` | status da cobrança |
| `data.brCode` | copia e cola do Pix, vai para `extra.brCode` do 402 |
| `data.brCodeBase64` | imagem do QR Code em data URI (o console usa) |
| `data.expiresAt` | ISO 8601, vai para `extra.expiresAt` do 402 |
| `data.devMode` | `true` em Modo Teste |

`expiresIn` só existe na requisição; a expiração absoluta volta em `expiresAt`.

Referência: <https://docs.abacatepay.com/pages/transparents/create>

### Consultar status

`GET /v2/transparents/check?id=<chargeId>`, permissão `TRANSPARENT:READ`, só para
Pix. Devolve `data.id`, `data.status` e `data.expiresAt`. Se o `id` não existe, ou
é de boleto ou cartão, o erro é `Pix QR Code not found`.

Status possíveis: `PENDING`, `EXPIRED`, `CANCELLED`, `PAID`, `UNDER_DISPUTE`,
`REFUNDED`, `REDEEMED`, `APPROVED`, `FAILED`.

**Só `PAID` conta como pago.** `APPROVED` é estado intermediário de cartão e não
é pagamento confirmado de Pix; `REDEEMED` e `REFUNDED` são posteriores e não
autorizam acesso novo. `isPaidStatus` implementa exatamente isso.

Limite de 100 requisições por segundo por loja, com headers `RateLimit-Limit`,
`RateLimit-Remaining` e `RateLimit-Reset`. Este pacote não implementa retry: quem
chama decide.

Referência: <https://docs.abacatepay.com/pages/transparents/check>

### Simular pagamento (Modo Teste)

`POST /v2/transparents/simulate-payment?id=<chargeId>`, sem corpo, só com chave de
Modo Teste. Move a cobrança para `PAID` e dispara o webhook
`transparent.completed`. **Não está implementado neste pacote**: é passo de demo,
e `scripts/demo.sh` pode chamá-lo com `curl`.

Referência: <https://docs.abacatepay.com/pages/transparents/simulate-payment>

### Webhook: o que autentica e o que não autentica

Cada entrega é um `POST` com corpo JSON e dois valores de verificação:

1. **O secret que nós cadastramos**, que chega em dois lugares: no header
   `X-Webhook-Secret` e na query string como `?webhookSecret=`. A documentação
   recomenda ler o header, porque valor em URL vaza para log de servidor, e
   comparar em tempo constante. Se não bate: responder `401` e não processar
   (um `401` não é reentregue).
2. **`X-Webhook-Signature`**, assinatura do corpo: HMAC-SHA256 sobre os **bytes
   crus** do corpo, antes de qualquer parse de JSON, em base64 sem prefixo.

O ponto que a documentação declara com todas as letras, e que precisa ficar
explícito aqui: **a assinatura não usa o nosso secret. Ela usa uma chave da
AbacatePay que é pública e igual para todas as contas.**

A consequência é desconfortável e é real: a assinatura prova **integridade** do
corpo, não **autenticidade** do remetente. Qualquer pessoa que leia a
documentação tem a chave e consegue produzir uma assinatura válida para um corpo
que ela mesma inventou. Portanto:

- O único segredo que autentica a chamada é o **secret compartilhado**, que é um
  valor de bearer na URL e no header, não uma assinatura. É o que a AbacatePay
  oferece; é frágil, e este README não finge o contrário. Mitigações do nosso
  lado: endpoint de webhook só em HTTPS, secret de 32+ caracteres
  (`openssl rand -hex 32`), rotação quando houver suspeita, e preferência pelo
  header sobre a query string para o valor não cair em log de proxy.
- Por isso a regra 5 do `AGENTS.md` ("webhook é gatilho, não fonte de verdade")
  não é zelo excessivo neste provedor: é a única coisa que torna o fluxo seguro.
  `verifyWebhook` **nunca** devolve "pago". Ela devolve o envelope e o `chargeId`
  para consulta. Quem credita é `confirmPaid` + `verifyPixPayment`.

`verifyWebhook` exige o secret e checa a assinatura só se `signatureKey` for
passado (a chave pública da AbacatePay, que fica em configuração, não no código:
não é segredo, mas também não é constante nossa). `requireSignature: true` rejeita
entrega sem assinatura.

Envelope de todo evento: `id` (identificador da entrega, repetido nas
retentativas automáticas — serve para descartar duplicado), `event`,
`apiVersion` (sempre `2`), `devMode`, `data`.

Evento de interesse: **`transparent.completed`**, com a cobrança em
`data.transparent` (`id`, `amount`, `status`, `paidAmount`, `platformFee`,
`externalId`, `receiptUrl`, `metadata`, …), o cliente em `data.customer` e o
pagador em `data.payerInformation` (para Pix: `name`, `taxId` mascarado,
`isSameAsCustomer`). Outros eventos do mesmo recurso: `transparent.refunded`,
`transparent.disputed`, `transparent.lost`.

**Não existe `endToEndId` no payload do webhook nem na resposta de `check`.** A
documentação não expõe o identificador fim a fim do Pix em nenhum dos dois. Logo,
o campo `transaction` do `SettlementResponse` da spec só é preenchido se o cliente
informar o `endToEndId` no `payload`; caso contrário fica vazio. O que a
AbacatePay dá como comprovante é `receiptUrl`.

Referências:
<https://docs.abacatepay.com/pages/notificacoes/webhooks>,
<https://docs.abacatepay.com/pages/notificacoes/seguranca>,
<https://docs.abacatepay.com/pages/webhooks/events/transparent>

## Uso

```ts
import {
  AbacatePayClient,
  buildPixRequirements,
  confirmPaid,
  verifyPixPayment,
  verifyWebhook,
} from "@awall/pix";

const client = new AbacatePayClient({ apiKey: process.env.ABACATEPAY_API_KEY ?? "" });

// 1. Cota esgotada: cria a cobrança e anuncia o trilho pix no 402.
const charge = await client.createPixCharge({
  amountCents: 394n,
  expiresInSeconds: 900,
  description: "AWall credits pack",
});
if (!charge.ok) return; // vira 402 sem o trilho pix, ou 503, decisão do gateway

const requirements = buildPixRequirements({
  amountCents: charge.value.amountCents,
  chargeId: charge.value.chargeId,
  checkoutUrl: `https://awall.demo/pay/${charge.value.chargeId}`,
  statusUrl: `https://api.awall.demo/awall/offers/${charge.value.chargeId}`,
  brCode: charge.value.brCode,
  expiresAt: charge.value.expiresAt,
  maxTimeoutSeconds: 900,
});

// 2. Webhook chega: autentica, pega o chargeId, e confirma na API.
const verified = verifyWebhook(rawBody, request.headers, secret, { signatureKey });
if (!verified.ok) return reply(401);

const confirmation = await confirmPaid(client, verified.value.chargeId ?? "");

// 3. Verificação do scheme, com o registro vindo do @awall/ledger.
const result = verifyPixPayment({
  requirements,
  payload: { chargeId: verified.value.chargeId ?? "" },
  record, // { chargeId, amountCents, expiresAt, consumedAt }
  providerStatus: confirmation.ok ? confirmation.value.status : "PENDING",
});
if (result.ok) {
  // creditar com result.value.idempotencyKey === `pix:<chargeId>`
}
```

## Fronteiras

- **Persistência não é daqui.** `verifyPixPayment` recebe o registro da cobrança
  (`PixChargeRecord`) como argumento e não conhece banco. Marcar a cobrança como
  consumida de forma atômica e idempotente, com `UNIQUE` em `pix:<chargeId>`, é
  responsabilidade de `@awall/ledger`.
- **Preço não é daqui.** O valor em centavos vem de `@awall/policy`
  (`pricing.price_brl_cents`) e do registro no banco, nunca do payload do
  cliente.
- **Chave de API.** `AbacatePayClient` manda a chave só no header
  `Authorization`. Nada de chave em log, em URL, em corpo, ou em mensagem de
  erro: mensagem de erro do provedor passa por redação antes de voltar. Os nomes
  das variáveis estão em `.env.example` (`ABACATEPAY_API_KEY`,
  `ABACATEPAY_WEBHOOK_SECRET`). Nenhum valor real no repositório.

## Testes

```
pnpm --filter @awall/pix test
pnpm --filter @awall/pix typecheck
```

`fetch` é sempre stubado; nenhum teste toca a rede. Cobre criação de cobrança,
consulta de status, cobrança expirada, valor divergente (o valor vem do registro,
não do payload), cobrança já consumida, webhook com assinatura inválida, webhook
com secret errado, e webhook que diz `PAID` enquanto a API diz `PENDING`.
