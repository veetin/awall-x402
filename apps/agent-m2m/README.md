# @awall/agent-m2m

O agente autônomo da demonstração do AWall. Ele chama uma rota protegida pelo
gateway em laço, toma `402 Payment Required` quando a cota gratuita acaba, lê os
termos de pagamento, assina sozinho uma transferência de USDC na Stellar e
repete a requisição com o header `PAYMENT-SIGNATURE`. Nenhum humano no circuito.

Também traz o script que prepara as contas de testnet, que é o passo de setup
que mais causa falha silenciosa no trilho Stellar.

> Testnet apenas. A chave secreta vem de variável de ambiente, nunca do
> repositório, e nunca aparece em log.

## Pré-requisitos

- Node 22+ e `pnpm` (`corepack enable pnpm`).
- `pnpm install` na raiz do monorepo.
- Gateway e origin de exemplo rodando: `pnpm dev` na raiz (`:8402` e `:8787`).

## Passo a passo do setup da testnet

### 1. Criar e preparar a conta do agente

```bash
pnpm --filter @awall/agent-m2m setup:testnet
```

O script:

1. usa `STELLAR_SECRET` se existir; se não existir, gera um par de chaves novo e
   grava **apenas** `STELLAR_SECRET=S...` em `apps/agent-m2m/.env`, que está no
   `.gitignore`. A chave secreta não é impressa em nenhum momento;
2. financia a conta pelo friendbot (`https://friendbot.stellar.org`);
3. cria a **trustline de USDC** para o emissor de testnet
   `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`;
4. imprime endereço, saldo de XLM, saldo de USDC e se a trustline existe.

Saída de uma execução real, com a conta ainda sem USDC:

```
network    stellar:testnet
USDC SAC   CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
USDC issuer GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

payer (the agent)
  address    GBN27ZA5VZ4ROXWXT5X77JSLIRMAHPR45OWV666RLXLHH7XMLTSR4DQH
  XLM        9999.9999900  (funded by friendbot now)
  USDC       0.0000000
  trustline  yes  (added now)
```

O script sai com código 1 se alguma conta ficar sem trustline.

### 2. Saldo para pagar

O agente paga em **XLM** por padrão (`STELLAR_PAY_ASSET=xlm`), e o friendbot
financia XLM no mesmo passo do setup. Não é preciso faucet nenhum para a
primeira liquidação: o 402 do AWall oferece o mesmo pacote nos dois ativos, e o
XLM é o caminho que roda sem intervenção humana.

Pagar em **USDC** (`STELLAR_PAY_ASSET=usdc`) continua possível e exige saldo,
que hoje só sai do faucet público da Circle:

1. abra <https://faucet.circle.com>;
2. escolha o token **USDC** e a rede **Stellar Testnet**;
3. cole o endereço do agente (o `address` impresso acima);
4. o faucet envia **20 USDC por endereço a cada 2 horas**, sem conta e sem chave
   de API. A página é protegida por reCAPTCHA, então esse passo é manual.

A trustline precisa existir **antes** do pedido, senão o pagamento do faucet não
tem onde cair. Rode `setup:testnet` de novo para confirmar o saldo.

### Primeira liquidação real, pelo trilho XLM

Executada neste repositório, sem humano no circuito depois do setup:

```
[147]  402  cost 1 credits  credits left 0  identity idt_f_65cf33c71fc9837c
     rail exact stellar:testnet 7.8880000 XLM (78880000)  to GB3ZLW…3U26LB
     signed exact on stellar:testnet: 7.8880000 XLM, auth entries valid for ~12 ledgers
     settled tx 1193d51b…375a048d
[147]  200  (paid)  cost 1 credits  credits left 10000  7219ms
done     171 requests  1 payment(s)  statuses {"200":170,"402":1}
```

- transação: `1193d51bc83e0831e775b3f7fd13049f21f1868364008e905540be56375a048d`
- <https://stellar.expert/explorer/testnet/tx/1193d51bc83e0831e775b3f7fd13049f21f1868364008e905540be56375a048d>
- Horizon confirma `successful: true` no ledger `5928781`, e a conta de
  recebimento saiu de 9999.9999900 para 10007.8879900 XLM;
- a taxa foi paga pelo patrocinador do facilitator (`areFeesSponsored: true`),
  não pelo agente: o `source_account` da transação não é a carteira do agente;
- o gateway creditou o pacote de 10000 créditos e o agente seguiu trabalhando
  na mesma execução, debitando crédito a partir da requisição seguinte.

> Pagar em XLM só funciona porque o cliente x402 recebe `allowedAssets` ligado.
> O spend control derruba qualquer ativo que não seja um ativo padrão **antes**
> do seletor rodar, e XLM não é ativo padrão: sem isso o agente assinava USDC,
> justamente o ativo que o friendbot não financia.

### 3. Preparar a conta que recebe

O recebedor também precisa de trustline de USDC: é um SAC de ativo classic, e
sem trustline a liquidação falha no lado do gateway. Com o segredo da conta de
recebimento no ambiente, o mesmo script cuida dela:

```bash
STELLAR_PAY_TO_SECRET=S... pnpm --filter @awall/agent-m2m setup:testnet
```

O gateway precisa do endereço público correspondente em `STELLAR_PAY_TO`.

## Variáveis de ambiente

O `.env` em `apps/agent-m2m/` é lido pelos scripts do pacote
(`--env-file-if-exists`).

| Variável | Default | Para que serve |
| --- | --- | --- |
| `STELLAR_SECRET` | — | chave secreta da carteira do agente (obrigatória) |
| `STELLAR_PAY_TO_SECRET` | — | chave secreta da conta de recebimento, só no setup |
| `STELLAR_NETWORK` | `stellar:testnet` | rede CAIP-2 |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | RPC usado na simulação |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon, só no setup |
| `STELLAR_FRIENDBOT_URL` | `https://friendbot.stellar.org` | friendbot, só no setup |
| `AWALL_GATEWAY_URL` | `http://localhost:8402` | base do gateway |
| `AGENT_TARGET_PATH` | `/v1/search?q=camera` | rota protegida que o agente chama |
| `AGENT_REQUESTS` | `40` | quantas requisições tentar |
| `AGENT_INTERVAL_MS` | `120` | pausa entre requisições |
| `AGENT_MAX_PAYMENT_USD` | `$2` | teto por pagamento, no spend control do cliente |
| `STELLAR_PAY_ASSET` | `xlm` | ativo assinado quando o 402 oferece USDC e XLM |

## Rodando o agente

Modo seco — faz tudo menos reenviar a requisição paga:

```bash
pnpm --filter @awall/agent-m2m dry-run -- --requests 200 --interval 0
```

Modo autônomo, que paga e continua:

```bash
pnpm --filter @awall/agent-m2m start -- --requests 200 --interval 0
```

Flags: `--dry-run`, `--requests N`, `--interval MS`, `--path /v1/items/42`,
`--url http://host/rota`.

O modo seco é o que funciona hoje ponta a ponta: o gateway ainda responde `501`
a `PAYMENT-SIGNATURE`, porque a liquidação do lado servidor está sendo feita em
paralelo.

### Saída

Uma linha por requisição, com status, custo em `credits` e saldo restante. No
402, os dois trilhos com o valor de cada um; depois do pagamento, o hash da
transação e o link do stellar.expert. Trecho de uma execução real contra o
gateway local:

```
[109]  200  cost 1 credits  credits left 0  1ms  identity idt_f_65cf33c71fc9837c
[110]  402  cost 1 credits  credits left 0  2ms  identity idt_f_65cf33c71fc9837c
     reason: Free quota exhausted. Pay to continue.
     rail exact stellar:testnet 0.5000000 USDC (5000000)  to GBQLCP…JTZVHD  timeout 60s  pack 10000 credits
     rail pix   pix:bcb        R$ 2,90 (290)  to http://localhost:3000/pay/ofr_ccd13f0  timeout 900s  pack 10000 credits
     signed exact on stellar:testnet: 0.5000000 USDC, auth entries valid for ~12 ledgers
     XDR (1104 base64 chars):
     AAAAAgAAAABriIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1AAAAAA...
```

Sem USDC na conta a linha do 402 é seguida de
`payment not signed: ... has insufficient balance ...`, que vem da simulação no
Soroban RPC. É o sintoma de faltar o passo 2 do setup.

## Como funciona

O fluxo Stellar não assina a transação inteira, assina as **auth entries** da
invocação Soroban. O facilitator remonta a transação como source, paga a taxa
(`extra.areFeesSponsored: true`) e submete. Ver `docs/03-protocolo.md`.

A assinatura em si vem dos pacotes oficiais, não de código nosso:
`ExactStellarScheme` de `@x402/stellar/exact/client` monta
`transfer(from, to, amount)` no contrato SEP-41, simula no RPC, assina as auth
entries com expiração em
`currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds)` e serializa o
XDR. O `x402Client`/`x402HTTPClient` de `@x402/fetch` cuidam da seleção do
trilho, do envelope do `PaymentPayload` e do base64 dos headers.

O que foi escrito aqui porque os pacotes não cobrem:

- **Seleção do trilho.** O seletor default do `x402Client` pega o primeiro item
  de `accepts`. O 402 do AWall tem dois trilhos e só `exact` é pagável por
  máquina, então `selectExactStellar` escolhe por `scheme` e `network` em vez de
  confiar na ordem.
- **Teto de gasto.** O spend control default é `"$1"` por pagamento, abaixo do
  preço do pacote do AWall sob multiplicador de abuso (até 1,50 USDC). O agente
  declara o próprio teto, `AGENT_MAX_PAYMENT_USD`.
- **Taxa de inclusão de 1 stroop.** O facilitator público de testnet recusa
  envelope acima do limite de taxa dele. O quickstart oficial da Stellar resolve
  reconstruindo a transação assinada com taxa de 1 stroop, e `clampSorobanFee`
  faz isso: o envelope termina em `resourceFee + 1`. Como as auth entries ficam
  na operação, o clone preserva as assinaturas. Quem paga a taxa de verdade é o
  facilitator, que remonta a transação como source.
- **Janela de expiração para o relatório.** `expirationLedgerWindow` repete a
  conversão de `maxTimeoutSeconds` para ledgers só para imprimir a janela sem
  precisar de uma chamada extra ao RPC. A expiração que vale é a que o pacote
  calcula ao assinar.
- **Setup da testnet.** Não há nada nos pacotes `@x402/*` para friendbot ou
  trustline; `src/testnet.ts` e `src/horizon.ts` fazem isso sobre o
  `@stellar/stellar-sdk`.

## Testes

```bash
pnpm --filter @awall/agent-m2m test
pnpm --filter @awall/agent-m2m typecheck
```

A suíte não toca a rede. Um `fetch` falso faz o papel do gateway e devolve um
`PAYMENT-REQUIRED` válido com os dois trilhos; o `x402Client` real roda no
caminho de teste, com um scheme falso no lugar da assinatura, o que mantém em
teste a seleção do trilho, o spend control, o formato do `PaymentPayload` e o
base64 dos headers. RPC, Horizon e friendbot ficam atrás de interfaces
injetáveis.

## Limitações

- O modo autônomo depende da liquidação no gateway, que hoje responde `501`.
- `pnpm dev` na raiz não sobe o agente de propósito: ele é um cliente, roda sob
  demanda.
