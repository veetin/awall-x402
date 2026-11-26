# 03 — Protocolo

Base normativa: x402 **v2** (`specs/x402-specification-v2.md`), transporte HTTP
(`specs/transports-v2/http.md`) e o binding `exact` para Stellar
(`specs/schemes/exact/scheme_exact_stellar.md`), todos do repositório
`coinbase/x402`.

## Headers

| Header | Direção | Conteúdo |
| --- | --- | --- |
| `PAYMENT-REQUIRED` | servidor → cliente | base64 do objeto `PaymentRequired` |
| `PAYMENT-SIGNATURE` | cliente → servidor | base64 do objeto `PaymentPayload` |
| `PAYMENT-RESPONSE` | servidor → cliente | base64 do objeto `SettlementResponse` |

O corpo da resposta é decisão de implementação: todo o protocolo trafega nos
headers. AWall repete os termos em JSON no corpo do 402 por conveniência de
depuração e de demonstração.

## Rede e ativo

| Item | Valor |
| --- | --- |
| Rede (default) | `stellar:testnet` (CAIP-2) |
| Rede (produção, atrás de flag) | `stellar:pubnet` |
| Ativo | USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` e XLM nativo SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` em testnet. O mesmo 402 anuncia os dois; um pagamento em qualquer um credita o pacote |
| Decimais | **7** (padrão Stellar, inclusive XLM) |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Facilitator | `https://www.x402.org/facilitator` — o `/supported` público já anuncia `{"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}` |

Dois detalhes que mudam código:

- **Decimais 7, não 6.** 0,50 USDC são `"5000000"`. Herdar exemplo de EVM aqui é
  erro de duas ordens de grandeza.
- **Só tokens SEP-41 em Soroban.** O binding não suporta ativos classic. O
  endereço acima é o *Stellar Asset Contract* que embrulha o USDC classic emitido
  por `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` em testnet. Como
  é um SAC de ativo classic, **pagador e recebedor precisam de trustline de USDC**
  antes de qualquer transferência. É o item de setup que mais causa falha
  silenciosa.

## O 402 do AWall

Resposta quando a cota gratuita acabou e não há crédito:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miwi...
Retry-After: 2
X-AWall-Identity: idt_7Zq...
X-AWall-Cost-Credits: 2
X-AWall-Credits-Remaining: 0
X-AWall-Abuse-Score: 0.18
X-AWall-Price-Multiplier: 1.36
```

Objeto `PaymentRequired` (o mesmo que vai em base64 no header):

```json
{
  "x402Version": 2,
  "error": "Cota gratuita esgotada. Pague para continuar.",
  "resource": {
    "url": "https://api.exemplo.com/v1/search?q=camera",
    "description": "Pacote de 10000 créditos na API protegida",
    "mimeType": "application/json",
    "serviceName": "AWall Demo API",
    "tags": ["search", "catalog"],
    "iconUrl": "https://awall.demo/icon.png"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "6800000",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payTo": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
      "maxTimeoutSeconds": 60,
      "extra": {
        "areFeesSponsored": true,
        "packCredits": 10000,
        "offerId": "ofr_01JDX7...",
        "assetCode": "USDC"
      }
    },
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "68000000",
      "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "payTo": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
      "maxTimeoutSeconds": 60,
      "extra": {
        "areFeesSponsored": true,
        "packCredits": 10000,
        "offerId": "ofr_01JDX7...",
        "assetCode": "XLM"
      }
    },
    {
      "scheme": "pix",
      "network": "pix:bcb",
      "amount": "394",
      "asset": "BRL",
      "payTo": "merchant",
      "maxTimeoutSeconds": 900,
      "extra": {
        "checkoutUrl": "https://awall.demo/pay/ofr_01JDX7...",
        "statusUrl": "https://api.awall.demo/awall/offers/ofr_01JDX7...",
        "packCredits": 10000,
        "offerId": "ofr_01JDX7..."
      }
    }
  ],
  "extensions": {}
}
```

Pontos de desenho:

- **`amount` em unidades atômicas.** `6800000` são 0,68 USDC com 7 decimais — o
  preço base de 0,50 USDC multiplicado pelo escore de abuso 1,36. No item Pix,
  `amount` está em centavos de real e `asset` usa o código ISO 4217, que a
  especificação autoriza explicitamente para fiat.
- **`extra.areFeesSponsored: true`** é obrigatório no binding Stellar. Indica ao
  cliente que o facilitator paga a taxa da transação.
- **`payTo: "merchant"`** no item Pix. A especificação aceita constante de papel no
  lugar de endereço, o que cobre um trilho fiat em que a conta de recebimento não
  é pública.
- **`extra.offerId`** amarra os dois itens à mesma offer no banco. O cliente paga
  por qualquer um dos trilhos; o crédito cai no mesmo lugar.

## Retomada pelo agente autônomo

O fluxo Stellar é diferente do EVM em um ponto central: **o cliente não assina a
transação inteira, assina as entradas de autorização (auth entries) da invocação
Soroban**. O facilitator reconstrói a transação com a própria conta como source,
paga a taxa e submete.

Passos do lado do agente:

1. Lê o item `exact` do `accepts`.
2. Monta uma invocação `transfer(from, to, amount)` no contrato do token
   (interface SEP-41).
3. Simula contra o Soroban RPC para descobrir as auth entries necessárias.
4. Assina as auth entries com expiração em
   `currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds)` — com
   `maxTimeoutSeconds: 60` e ledger de ~5s, cerca de 12 ledgers.
5. Serializa a transação em XDR base64 e repete a requisição.

```
GET /v1/search?q=camera HTTP/1.1
PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwicmVzb3VyY2Ui...
```

`PaymentPayload` decodificado:

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.exemplo.com/v1/search?q=camera" },
  "accepted": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "amount": "6800000",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "payTo": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
    "maxTimeoutSeconds": 60,
    "extra": { "areFeesSponsored": true, "offerId": "ofr_01JDX7..." }
  },
  "payload": {
    "transaction": "AAAAAgAAAABriIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1AAAAAA..."
  },
  "extensions": {}
}
```

O `payload` tem um único campo: `transaction`, o XDR base64 com uma operação
`invokeHostFunction` e as auth entries assinadas.

O gateway então:

1. **Revalida `accepted` contra a própria política.** O campo vem do cliente e não
   é confiável. Confere `scheme`, `network`, `asset`, `payTo` e confere `amount`
   contra a offer gravada no banco — nunca contra o que o cliente mandou.
2. `POST /verify` no facilitator com `PaymentPayload` + `PaymentRequirements`.
3. `POST /settle` no facilitator.
4. Grava o pagamento com chave de idempotência igual ao hash da transação e
   credita `packCredits` no ledger, na mesma transação de banco.
5. Executa a requisição na origin e responde 200 com:

```
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6ImExYjJjM2Q0...
X-AWall-Credits-Remaining: 9998
```

`SettlementResponse` decodificado:

```json
{
  "success": true,
  "transaction": "a1b2c3d4e5f6...",
  "network": "stellar:testnet",
  "payer": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO"
}
```

`transaction` é o hash em hex de 64 caracteres, linkável no stellar.expert.
`payer` é o endereço do cliente, não o do facilitator.

Se a liquidação falhar, a resposta é outro 402 com `PAYMENT-RESPONSE` carregando
`success: false` e o `errorReason`. O código `settlement_pending` é não-terminal:
a transação pode confirmar depois, e o gateway reconcilia pelo hash em vez de
assumir falha.

A offer precisa pertencer à identidade que manda o `PAYMENT-SIGNATURE`. Pagar a
offer de outra identidade creditaria o pacote para ela e deixaria esta
requisição sem crédito, então o gateway recusa com `error:
offer_identity_mismatch` (`errorReason: invalid_payment_requirements`) **antes**
de chamar `/verify`, enquanto o dinheiro ainda está com o cliente.

Pela mesma razão, a decisão da política vem primeiro. Uma rota que a política
nega responde `404` sem liquidação nenhuma: liquidar antes cobraria o cliente por
uma requisição que o gateway recusa em seguida.

### O que o facilitator valida (e por que importa para nós)

O binding Stellar impõe ao facilitator uma lista de verificações que o gateway
não precisa repetir, mas precisa entender para diagnosticar erro:

- exatamente 1 operação `invokeHostFunction`, função `transfer` com 3 argumentos;
- argumento `to` igual a `payTo`, argumento `amount` igual a `amount` (i128);
- auth entries do tipo `sorobanCredentialsAddress` ou
  `sorobanCredentialsAddressV2`; `sourceAccount` e `addressWithDelegates` são
  rejeitados;
- `rootInvocation` sem `subInvocations` que autorizem nada além da transferência;
- expiração das auth entries dentro da janela derivada de `maxTimeoutSeconds`;
- o endereço do facilitator não pode aparecer como source, como `from` nem em
  nenhuma auth entry;
- a simulação precisa emitir **apenas** as duas mudanças de saldo esperadas.

Erros típicos que vamos ver em desenvolvimento: `invalid_exact_stellar_payload_*`
por auth entry expirada (relógio ou ledger desatualizado), por valor divergente
(erro de decimais) e por falta de trustline no recebedor.

## Retomada pelo agente assistido

O item `pix` não é liquidável pelo cliente de forma autônoma. O fluxo é:

1. Agente lê `extra.checkoutUrl` e mostra o link ou o QR Code para a pessoa.
   Alternativamente, se o consumidor for um navegador (`Accept: text/html`), o
   gateway serve a própria página de paywall em vez do 402 cru.
2. Agente faz polling em `extra.statusUrl`:
   - `202 Accepted` com `{"status":"pending"}` enquanto não pago;
   - `200 OK` com `{"status":"paid","creditedCredits":10000}` quando confirmado;
   - `410 Gone` quando a offer morreu sem pagamento.
3. Confirmado, o agente repete a requisição original sem nenhum header de
   pagamento. O crédito já está na identidade dele.

O polling é o único caminho de recuperação quando o webhook se perde, então ele
consulta o provedor por até 24 h depois do prazo da offer: a cobrança só vive 15
minutos, mas a confirmação de um pagamento feito dentro do prazo pode chegar
depois dele. Confirmado o pagamento, a offer vira `paid` mesmo tendo expirado — o
prazo impede autorização nova, não desfaz dinheiro que entrou. Passadas as 24 h,
o endpoint responde `410` sem chamar o provedor.

A amarração entre offer e identidade é feita no momento do 402, então o pagamento
do humano credita a identidade do agente que recebeu o 402 — sem o humano precisar
copiar token nenhum.

## Scheme `pix`

Não existe scheme fiat padronizado no x402. AWall define um e o documenta em
[../specs/scheme_pix.md](../specs/scheme_pix.md), seguindo o template oficial de
schemes do repositório. Resumo:

- `scheme`: `"pix"`
- `network`: `"pix:bcb"` (arranjo de pagamento Pix, operado pelo Banco Central)
- `asset`: `"BRL"` (ISO 4217)
- `amount`: centavos
- `payTo`: `"merchant"`
- `extra.checkoutUrl`, `extra.statusUrl`, `extra.offerId` obrigatórios
- Fluxo de pagamento: `upfront` — a confirmação do Pix é terminal e precede o
  acesso. Não há `/verify`; o crédito só existe após confirmação.

## Medição de consumo: fora da cadeia

No binding Stellar existe **apenas o scheme `exact`**. Os schemes `upto` (cobrança
pelo consumo real) e `auth-capture` têm binding só para EVM, e no caso do `upto`
também para SVM. O facilitator público confirma isso no `/supported`.

Isso não tira nenhuma capacidade do AWall, porque a medição já é feita fora da
cadeia: o pagamento compra um pacote de créditos, e cada rota debita o custo
dela do pacote. Uma rota de inferência debita 50 créditos; uma busca debita 1 crédito. O
efeito para o cliente é cobrança por consumo real, com uma liquidação a cada
milhares de requisições em vez de uma por requisição.

Consequência prática no plano: a flag `metered: true` da política deixa de
significar "usa o scheme `upto`" e passa a significar "o custo em créditos é calculado
depois da resposta, a partir da medição da origin" (tokens gerados, bytes
transferidos). Desaparece um risco de implementação do roadmap.

## Endpoints próprios do gateway

| Método e rota | Função |
| --- | --- |
| `ANY /*` | proxy para a origin, com a política aplicada |
| `GET /awall/offers/:id` | status da offer (202 pendente, 200 paga, 410 morta) |
| `POST /awall/webhooks/abacatepay` | confirmação de pagamento Pix, com validação de assinatura |
| `GET /awall/receipts/:identityId` | recibos e extrato de crédito da identidade |
| `GET /awall/stats/stream` | SSE de eventos para o dashboard |
| `GET /healthz` | liveness |

## Compatibilidade

- v2 é o alvo, e para Stellar não há escolha: o binding declara explicitamente que
  v1 não é suportado.
- Clientes que não falam x402 recebem o 402 com corpo JSON e `Retry-After`. Não
  degrada para erro opaco.
