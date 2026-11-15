# 08 — Console: dashboard e gestão

Escopo acordado, **ainda não implementado**. Este documento existe para que o
console não seja desenhado na pressa no fim do projeto, e para fixar o contrato de
API que o gateway precisa expor.

## O que é

Uma aplicação **Vite + React + TypeScript** em `apps/console`, com duas áreas:

| Área | Rota | Autenticação | Para quem |
| --- | --- | --- | --- |
| Checkout | `/pay/:offerId` | nenhuma | a pessoa que vai pagar por Pix ou cripto, vinda do `extra.checkoutUrl` do 402 |
| Console | `/` e abas | token de administrador | quem opera a API protegida |

Uma aplicação só, porque as duas áreas consomem os mesmos dados e o mesmo
deploy. O checkout é público e precisa carregar rápido num celular; o console é
interno.

## Para que serve

Duas coisas, nesta ordem de prioridade:

1. **Observabilidade**: o que está acontecendo no gateway agora e no período.
2. **Gestão**: mudar a política sem editar YAML no servidor e sem reiniciar.

## Telas

### Ao vivo

Fluxo de requisições em tempo real, via SSE. Uma linha por requisição:
horário, identidade, rota, decisão (`allow_free`, `allow_credit`,
`payment_required`, `refunded`), custo em créditos, status da origin, latência.
Filtro por identidade e por decisão. É a tela que fica aberta durante a
demonstração.

### Requisições

A mesma informação em janela histórica, agregada por hora: volume, taxa de 402,
taxa de erro, latência p50 e p95, rotas mais caras. Serve para responder "quem
está consumindo o quê".

### Receita

- Requisições recuperadas: quantas teriam sido `429` e foram atendidas após
  pagamento. É a métrica central do projeto.
- Receita por trilho: total em USDC (Stellar) e em BRL (Pix), com a contagem de
  liquidações.
- Custo de infraestrutura coberto: estimativa de custo por crédito consumido
  contra a receita do período.
- Ticket médio e multiplicador de abuso médio.

### Identidades

Lista com tipo (chave de API, carteira, fingerprint), saldo de créditos, escore de
abuso, multiplicador de preço vigente, primeira e última requisição. Detalhe da
identidade: extrato do ledger e recibos, com link para a transação no
stellar.expert ou para o recibo do Pix.

### Pagamentos

Offers e pagamentos: status, trilho, valor, chave de idempotência, hash da
transação, motivo de falha quando houver. É a tela de auditoria: todo crédito
concedido tem que ter um pagamento rastreável aqui.

### Política

Fase 1: visualização da política efetiva — rotas, custo em créditos, rotas
isentas, cotas próprias, preço do pacote.

Fase 2: edição. Alterar custo de rota, cota, preço do pacote e `defaults`, com
validação pelo mesmo schema Zod do `@awall/policy` **antes** de aplicar, histórico
de versões e quem aplicou. O YAML continua sendo o estado inicial; a edição grava
uma versão no banco que passa a valer por cima dele.

### Saúde

Checagens que explicam falha de pagamento antes de o cliente reclamar: o
`/supported` do facilitator ainda anuncia o par `(exact, stellar:testnet)`, a
conta de recebimento tem trustline de USDC, o provedor de Pix responde, e a
latência da decisão do gateway.

## Contrato de API que o gateway precisa expor

Nada disso existe hoje, fora o `GET /awall/offers/:id`. Endpoints de leitura do
console, todos sob o prefixo de controle:

| Método e rota | Resposta |
| --- | --- |
| `GET /awall/stats/stream` | SSE com um evento por requisição e por pagamento |
| `GET /awall/stats/summary?window=1h` | contadores, receita por trilho, requisições recuperadas |
| `GET /awall/usage?from&to&identityId&decision` | eventos paginados |
| `GET /awall/identities` | lista com saldo, escore e multiplicador |
| `GET /awall/identities/:id` | detalhe, extrato do ledger e recibos |
| `GET /awall/payments?status` | offers e pagamentos |
| `GET /awall/policy` | política efetiva, com a origem de cada valor (YAML ou override) |
| `GET /awall/health/checks` | resultado das checagens da tela Saúde |
| `PUT /awall/policy` | **fase 2**: aplica uma nova versão da política |

Formato do evento SSE (estável, porque o console depende dele):

```json
{
  "type": "request",
  "at": "2026-11-15T03:21:44.102Z",
  "identityId": "idt_k_2a97516c354b6884",
  "route": "GET /v1/search",
  "decision": "payment_required",
  "credits": 1,
  "originStatus": null,
  "latencyMs": 2,
  "quotaScope": "shared"
}
```

```json
{
  "type": "payment",
  "at": "2026-11-15T03:22:01.880Z",
  "identityId": "idt_k_2a97516c354b6884",
  "rail": "exact",
  "amount": "5000000",
  "asset": "USDC",
  "creditedCredits": 10000,
  "transaction": "a1b2c3…"
}
```

## Autenticação e exposição

- Token de administrador em `AWALL_ADMIN_TOKEN`, enviado como
  `Authorization: Bearer`. Sem token, os endpoints do console respondem `401` —
  inclusive os de leitura, porque eles expõem consumo por cliente.
- `GET /awall/offers/:id` continua público: é o endpoint que o agente e a página
  de checkout consultam. Ele devolve só status e créditos creditados, nunca dados
  da identidade.
- CORS com allowlist de origens em `AWALL_CONSOLE_ORIGIN`, nunca `*`.
- O prefixo `/awall` é **reservado**: o proxy nunca o encaminha para a origin. Se
  a API protegida já usa esse caminho, mude o prefixo em `AWALL_CONTROL_PREFIX`.
- Recomendado em produção: servir o plano de controle numa porta separada
  (`AWALL_ADMIN_PORT`), sem exposição pública, e deixar só o proxy na porta de
  entrada. Assim a superfície administrativa não depende de acertar regra de
  roteamento na borda.

## O que a fase 2 adiciona ao modelo de dados

Duas tabelas, a especificar em `docs/04-modelo-dados.md` quando a fase 2
começar:

- `policy_versions`: id, YAML ou JSON aplicado, hash, quem aplicou, quando, e se
  está ativa. A política vigente é a última ativa.
- `admin_audit`: append-only, uma linha por ação administrativa (ação, ator,
  payload, resultado). Mudar preço é ação com consequência financeira; precisa de
  rastro.

## Fases e corte

| Fase | Conteúdo | Quando |
| --- | --- | --- |
| 1 | Ao vivo, Receita, Requisições, Identidades, Pagamentos, Política em leitura | depois que o fluxo pago funciona ponta a ponta |
| 2 | Edição de política com versionamento e auditoria, Saúde | se houver tempo antes da submissão |
| 3 | Exportação CSV, regras de alerta, comparação de períodos | pós-hackathon |

Corte, se o prazo apertar: a fase 1 vira uma tela só — tabela ao vivo por SSE mais
os três números de receita. É o que a demonstração precisa. A edição de política
(fase 2) é a primeira coisa a sair, porque YAML no servidor já resolve.

## O que o console não é

- Não é APM: latência e erro aqui existem para explicar cobrança, não para
  substituir tracing.
- Não é BI: janela curta, agregação por hora, retenção de 7 dias nos eventos
  brutos.
- Não é painel de cliente final. Quem consome a API vê o próprio consumo pelos
  headers `X-AWall-*` e pelo recibo; o console é do operador.
