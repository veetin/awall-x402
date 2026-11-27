# 02 — Arquitetura

## Formato

AWall é um **reverse proxy standalone**. Ele fica entre o cliente e a API
protegida (a "origin"), e a origin não precisa de nenhuma alteração de código. A
decisão de cobrar, o ledger de crédito e a liquidação do pagamento vivem todos no
gateway.

```
                       ┌──────────────────────────────────────────────┐
  agente autônomo ───► │                AWall gateway                 │
  (carteira, M2M)      │                                              │
                       │  1. identity resolver                        │
  agente assistido ──► │  2. policy engine (rotas, custo em créditos)       │ ──► origin API
  (humano no loop)     │  3. quota / credit check                     │     (sem alteração)
                       │  4. abuse score ─► multiplicador de preço    │
                       │  5. payment orchestrator                     │
                       │  6. credit ledger + recibos                  │
                       └───────┬─────────────────────┬────────────────┘
                               │                     │
                        facilitator x402        AbacatePay (Pix)
                        /verify  /settle        cobrança + webhook
                               │                     │
                               └──────► credit ledger ◄───────
```

## Componentes

### 1. Identity resolver

Decide de quem é a requisição, nesta ordem de precedência:

1. Chave de API no header `Authorization` ou `X-API-Key` (hash armazenado, nunca a
   chave em claro).
2. Carteira conhecida: endereço que já pagou antes, reconhecido pelo campo `payer`
   de um settle anterior.
3. Identidade de agente assinada, quando presente (extensão
   `http-message-signatures` do x402).
4. Fallback: fingerprint de IP + ASN + User-Agent.

A identidade é a chave de tudo: cota, crédito, escore de abuso e recibos são todos
por identidade. Pagar melhora a identidade — um pagador tem identidade forte e
atribuível, o que por si só desincentiva o anonimato abusivo.

### 2. Policy engine

Configuração declarativa em YAML, carregada no boot e recarregável a quente.
Define:

- **Custo por rota** em créditos. Uma busca barata custa 1 crédito; uma rota de
  inferência custa 50. É o que permite preço justo por endpoint.
- **Rota isenta** (`free: true`): nunca cobrada e nunca respondida com 402. É onde
  entram health check, login, webhook e qualquer coisa que precisa continuar
  funcionando sem pagamento.
- **Cota própria por rota** (`free_tier` dentro da rota): a rota passa a ter um
  bucket separado, em vez de dividir o compartilhado. Serve para impedir que uma
  rota cara consuma a cota gratuita inteira.
- **Rota não listada** (`defaults.unmatched`): `deny` responde 404 sem chegar na
  origin (padrão, e o mais seguro ao colocar o gateway na frente de uma API que
  você não mapeou toda), `free` repassa sem cobrar, `charge` cobra
  `defaults.credits`.
- **Cota compartilhada** (`free_tier` na raiz): usada por toda rota sem cota
  própria.
- **Preço base**: quantos créditos vêm em cada pacote e quanto custa o pacote. O
  preço é global; a diferenciação entre rotas é feita pelo custo em créditos, não
  por preço por rota.

Exemplo:

```yaml
origin: http://localhost:8787

defaults:
  unmatched: deny        # deny | free | charge
  credits: 1

free_tier:
  window_seconds: 60
  credits: 100
  burst: 30

pricing:
  pack_credits: 10000
  price_usdc: "0.50"     # 5000000 em unidades atômicas (Stellar: 7 decimais)
  price_brl_cents: 290
  max_multiplier: 3.0

routes:
  - match: "GET /v1/health"
    free: true

  - match: "GET /v1/search"
    credits: 1

  - match: "GET /v1/items/*"
    credits: 2

  - match: "POST /v1/completions"
    credits: 50
    metered: true        # custo recalculado depois da resposta (tokens, bytes)

  - match: "GET /v1/reports/*"
    credits: 20
    free_tier:           # cota própria: 100 créditos por hora
      window_seconds: 3600
      credits: 100
```

O casamento é por método mais caminho, com `*` no fim como prefixo, e a primeira
regra que casa ganha. A decisão fica em `decide()`, em `packages/policy`, para o
gateway não ter regra de negócio espalhada.

### 3. Quota e crédito

Um token bucket por identidade cobre a cota gratuita, com reposição contínua.
Esgotada a cota, o gateway consulta o saldo de crédito da identidade no ledger.

Para o MVP, o bucket vive em memória no processo e o saldo de crédito vive em
Postgres. Isso significa que o gateway é **single-instance** nesta versão. O
caminho de escala horizontal (bucket em Redis com script Lua atômico) está
desenhado mas fora de escopo; o documento de roadmap trata isso como corte
explícito, não como omissão.

### 4. Abuse score

Escore de 0 a 1 por identidade, atualizado a cada requisição por média móvel
exponencial, a partir de quatro sinais:

| Sinal | O que mede |
| --- | --- |
| Burstiness | desvio do intervalo entre requisições em relação à média |
| Duplicate ratio | proporção de requisições idênticas (hash de método + path + query + corpo) |
| Error ratio | proporção de respostas 4xx geradas pelo cliente |
| Cache-miss ratio | proporção de requisições que ignoram validadores de cache (`If-None-Match`, `If-Modified-Since`) |

O multiplicador de preço é `1 + (max_multiplier - 1) * score`, limitado por
`max_multiplier`. É uma heurística, e os documentos e o dashboard devem dizer isso
abertamente: o valor do mecanismo está em existir um preço que reage ao
comportamento, não na precisão estatística do escore.

### 5. Payment orchestrator

Emite os termos de pagamento e processa a liquidação dos dois trilhos.

- **Trilho M2M (`exact` em Stellar)**: monta o objeto `PaymentRequired`, valida o
  `PAYMENT-SIGNATURE` recebido contra a própria política (nunca contra o que o
  cliente alega), chama `/verify` e `/settle` do facilitator e credita o pacote de
  créditos no ledger. O facilitator patrocina a taxa da transação, então o agente só
  precisa ter USDC — não precisa de XLM para gas.
- **Trilho Pix**: cria uma *offer* no banco, gera a cobrança na AbacatePay,
  devolve `extra.checkoutUrl` dentro do 402, e credita o pacote quando o webhook
  confirma o pagamento.
- **Rotas medidas**: para `metered: true`, o custo em créditos é calculado depois da
  resposta da origin e debitado do pacote. A medição é off-chain; não existe
  scheme `upto` em Stellar.

### 6. Credit ledger

Livro-caixa append-only de créditos por identidade, com saldo materializado. Todo
crédito aponta para um pagamento, e todo pagamento tem chave de idempotência
(hash da transação on-chain ou id da cobrança Pix). Detalhes no documento
[04-modelo-dados.md](04-modelo-dados.md).

### 7. Console (checkout + dashboard)

Aplicação Vite + React que serve duas áreas, detalhadas em
[08-dashboard.md](08-dashboard.md):

- **Checkout** (`/pay/:offerId`, público): página exibida quando o 402 é consumido
  por um navegador, ou aberta pelo humano a partir de `extra.checkoutUrl`. Mostra
  as duas opções, QR Code do Pix e botão de carteira, e faz polling do status da
  offer.
- **Dashboard** (interno, token de administrador): tráfego ao vivo por SSE,
  receita por trilho, requisições recuperadas, identidades com escore de abuso e
  saldo, offers e pagamentos para auditoria, e a política — em leitura na fase 1,
  editável com versionamento e auditoria na fase 2.

O gateway precisa expor um plano de controle para isso (`/awall/stats/*`,
`/awall/identities`, `/awall/payments`, `/awall/policy`), com token próprio e,
em produção, idealmente numa porta separada do proxy.

## Ciclo de vida da requisição

### Caminho feliz, dentro da cota

1. Requisição chega no gateway.
2. Identidade resolvida; política da rota encontrada; custo em créditos calculado.
3. Token bucket tem saldo: debita créditos, grava `usage_event`, repassa para a origin.
4. Resposta da origin volta com headers informativos
   (`X-AWall-Cost-Credits`, `X-AWall-Credits-Remaining`, mais os headers padrão de
   rate limit, para transparência).
5. Se a origin devolver 5xx, o créditos é devolvido ao bucket. O cliente não paga por
   falha nossa.

### Cota esgotada, agente autônomo

1. Bucket vazio e saldo de crédito zero.
2. Gateway calcula o preço (`pack_credits` ao preço base × multiplicador de abuso),
   cria uma offer e responde:

   ```
   HTTP/1.1 402 Payment Required
   PAYMENT-REQUIRED: <base64 do objeto PaymentRequired>
   Retry-After: 2
   ```

   O corpo repete o objeto em JSON legível, para depuração e para clientes que
   ainda não leem o header.
3. O agente escolhe o item `exact` do `accepts`, assina e repete a requisição com
   `PAYMENT-SIGNATURE`.
4. Gateway revalida os termos contra a política, chama `/verify`, chama `/settle`,
   credita `pack_credits` no ledger e **só então** executa a requisição.
5. Resposta 200 com `PAYMENT-RESPONSE` (recibo da liquidação) e saldo restante.

Importante: o pagamento compra um **pacote de crédito**, não uma única
requisição. Isso reduz liquidações on-chain de uma por requisição para uma a cada
milhares, mantém a latência previsível e é o mesmo modelo que torna o trilho Pix
viável.

### Cota esgotada, agente assistido

1. Mesma resposta 402, mas o `accepts` inclui o item `pix` com
   `extra.checkoutUrl` apontando para a página do console.
2. Se o consumidor for um navegador, o gateway serve direto a página de paywall em
   vez do 402 cru.
3. A pessoa paga por Pix. A AbacatePay chama o webhook do gateway.
4. Webhook valida assinatura, confirma o status `PAID` consultando a API, credita
   o pacote e marca a offer como paga (idempotente por id de cobrança).
5. O agente, que está fazendo polling em `GET /awall/offers/{id}` (202 enquanto
   pendente, 200 quando paga), repete a requisição original e recebe 200.

## Layout do repositório

```
awall-x402/
├── apps/
│   ├── gateway/          Hono — proxy, política, ledger, orquestração de pagamento
│   ├── console/          Vite + React — dashboard do operador e página de checkout
│   ├── landing/          Vite + React — landing page pública bilíngue do projeto
│   ├── origin-demo/      API protegida de exemplo (catálogo + rota medida)
│   └── agent-m2m/        agente autônomo com carteira, usa @x402/fetch
├── packages/
│   ├── policy/           parser do YAML, cálculo de créditos, preço e multiplicador
│   ├── ledger/           Postgres + Drizzle, ledger e idempotência
│   └── pix/              scheme `pix`: construção dos termos, adapter AbacatePay
├── docs/
├── specs/
│   └── scheme_pix.md     especificação do scheme `pix` para x402
└── scripts/
    └── demo.sh           roteiro executável da demo ponta a ponta
```

Monorepo com pnpm workspaces. TypeScript em tudo.

## Stack

| Peça | Escolha | Motivo |
| --- | --- | --- |
| Proxy | Hono (Node 24) | existe `@x402/hono` oficial; runtime enxuto |
| Banco | Postgres (Neon) + Drizzle | ledger precisa de transação e lock de linha |
| Console | Vite + React | dashboard do operador e checkout no mesmo deploy; escopo em `docs/08-dashboard.md` |
| Cliente M2M | `@x402/fetch` + `@x402/stellar` | wrapper de fetch que resolve o 402 sozinho |
| Pix | AbacatePay | `POST /v2/transparents/create` com `method: "PIX"`, webhook, ambiente de teste |
| Rede | Stellar testnet (`stellar:testnet`) | taxa patrocinada, ~5s de finalidade, USDC nativo; pubnet por flag |
| Ativo | USDC SAC `CBIELTK6…MXQDAMA`, 7 decimais | ativo padrão do `@x402/stellar` em testnet |
| Facilitator | `https://www.x402.org/facilitator` | o `/supported` público já anuncia `exact` em `stellar:testnet` |

Os pacotes x402 v2 são escopados: `@x402/core`, `@x402/hono`, `@x402/fetch`,
`@x402/paywall`, `@x402/stellar`, `@x402/mcp` (série 2.x). O pacote antigo `x402`
(1.x) é a v1 e não deve ser usado — e o binding Stellar declara que v1 não será
suportado.

`@x402/stellar` traz os três lados do mecanismo (`client`, `server`,
`facilitator`) e depende de `@stellar/stellar-sdk` ^16.3.0. O lado facilitator fica
disponível caso o facilitator público oscile: dá para subir um local com uma conta
Stellar própria sem escrever a verificação à mão.

## Decisões registradas

- **Proxy, não SDK.** O produto é "ponha na frente da sua API". SDK por linguagem
  dilui o escopo e não demonstra nada a mais.
- **Pacote de crédito, não cobrança por requisição.** Cobrar por requisição é mais
  bonito no protocolo e insustentável na prática: liquidação por requisição não
  cabe na latência e inviabiliza Pix.
- **Stellar testnet por default.** A demo roda na frente do júri sem custódia de
  fundos reais; pubnet fica atrás de variável de ambiente.
- **Stellar em vez de EVM.** Três motivos técnicos, não de preferência: a taxa é
  patrocinada pelo facilitator (o agente só precisa de USDC, não de token de gas),
  a finalidade é de poucos segundos a custo quase nulo, e o cliente assina apenas
  as *auth entries* da invocação Soroban — não gasta sequence number, o que
  permite várias liquidações do mesmo agente por ledger.
- **Só o scheme `exact`.** Em Stellar não existe binding para `upto` nem
  `auth-capture`. A medição por consumo fica no ledger de créditos, off-chain, que é onde
  ela já estava no desenho.
- **402 com corpo JSON além do header.** A especificação deixa o corpo a critério
  do servidor; repetir os termos em JSON ajuda depuração e apresentação.
- **Single-instance no MVP.** Bucket em memória. Escala horizontal documentada,
  não implementada.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Facilitator público instável durante a demo | `@x402/stellar` expõe o lado facilitator: subir um local com conta própria como plano B |
| Falta de trustline de USDC no pagador ou no recebedor | o USDC de testnet é um SAC de ativo classic; criar trustline nas duas contas é item de setup do dia 1 |
| Erro de decimais (7 em Stellar, não 6) | preço sempre em string de unidades atômicas, com teste de unidade na conversão |
| Auth entry expirada entre assinatura e settle | `maxTimeoutSeconds` >= 60 e retry do agente refazendo a simulação |
| Webhook da AbacatePay não chega ao ambiente de demo | fazer o polling do status da cobrança além do webhook; ambiente de teste tem simulação de pagamento |
| Cliente adultera os termos no `PAYMENT-SIGNATURE` | revalidar `accepted` contra a política do servidor antes do `/verify` |
| Webhook duplicado credita duas vezes | chave de idempotência única por pagamento e crédito dentro da mesma transação |
| Rota medida consumir tempo demais | é a última feature da lista; cortável sem afetar a narrativa |
