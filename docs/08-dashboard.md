# 08 — Console: dashboard e gestão

O console está em `apps/console` (Vite, React, TypeScript, porta 4179). Este
documento fixa o contrato de API que o gateway expõe para ele.

## O que é

Uma aplicação **Vite + React + TypeScript** em `apps/console`, com três áreas:

| Área | Rota | Autenticação | Para quem |
| --- | --- | --- | --- |
| Console | `/` e abas | sessão (usuário e senha) | quem opera a API protegida |
| Checkout | `/pay/:offerId` | nenhuma | a pessoa que vai pagar por Pix ou cripto, vinda do `extra.checkoutUrl` do 402 |
| Landing | `/landing` | nenhuma | quem chega ao projeto e ainda não sabe o que ele faz |

No checkout, o botão "Pagar com a carteira" abre um campo para colar o `PAYMENT-SIGNATURE`
que a carteira produziu a partir dos termos copiados ali do lado, e manda para
`POST /awall/offers/:id/pay`. O console não assina nada: a chave fica na
carteira, e o gateway revalida o payload contra a offer gravada antes de
creditar.

O checkout mostra o QR Code do Pix desenhado a partir do próprio BR Code — nunca
de uma imagem do provedor, que poderia divergir do código impresso logo abaixo —,
um botão de copia-e-cola para esse código e um botão que copia os termos Stellar
da offer para a carteira. O botão de copiar usa `navigator.clipboard` quando o
contexto é seguro e cai num `textarea` escondido com `execCommand` quando não é,
porque um checkout aberto por HTTP no celular não tem contexto seguro.

A landing é uma segunda entrada do mesmo build (`landing.html`), em TypeScript
sem React, para carregar leve. É uma página de venda de cinco telas, uma por
seção, com `scroll-snap`: o scroll vai de seção em seção, sem rolagem livre, e
uma barra de pontos na lateral mostra onde se está. Em janelas baixas (até 820
px de altura) ou estreitas o snap vira "por proximidade", porque a seção não
cabe numa tela. As telas são: o hero, a ideia (429 contra 402 e o trecho
`pricing` do `awall.yaml`), os trilhos, a prova e o fechamento.

Ela não chama o gateway: o hero simula um agente contra a política padrão de
`awall.yaml` (token bucket de 130 créditos com recarga de 100 por minuto, pacote
de 10.000 créditos a 0,50 USDC, 5,00 XLM ou R$ 2,90), com dinheiro em `bigint`.
Esses valores estão copiados em `src/landing/sim.ts` e precisam acompanhar o
YAML à mão, assim como o trecho `pricing` mostrado na tela da ideia. Os números
da prova (liquidação `1193d51b…`, réplicas 133 contra 278, contagem de testes)
vêm do README e mudam junto com ele. Os rios do hero são WebGL2 desenhado como
ASCII; sem WebGL2 o canvas some e o resto da página continua funcionando.

**Identidade visual.** Console, checkout e landing compartilham
`src/theme.css` (cores, fontes e movimento) e a mesma linguagem: painéis de
vidro, botões em pílula, barra de topo flutuante com as abas no console e linhas
de varredura no fundo. Cada cor tem um significado só: verde é cota gratuita,
âmbar é Stellar e azul é Pix. Na landing são os três potes; no console são as
colunas de receita, os selos de trilho e os painéis do checkout. Verde, laranja
e vermelho nos selos de status (`allow_free`, `waiting`, `refunded`) indicam só
estado. Mudou um token, mudou nas três áreas: confira as três antes de fechar.

**Publicação da landing.** Ela pode ir sozinha para a Vercel, sem gateway.
O projeto usa `apps/console` como diretório raiz, e `apps/console/vercel.json`
serve `landing.html` na raiz (`/`), mantém `/landing` e deixa o resto dar 404,
sem fallback para o console: console e checkout dependem do gateway e não
existem nesse deploy. Por isso os botões da landing apontam para o repositório
e para a liquidação na Stellar, e não para `/login`. A variável de projeto
`ENABLE_EXPERIMENTAL_COREPACK=1` faz a Vercel usar o `pnpm` fixado em
`packageManager`, e o Node do projeto precisa ser 24. Esse deploy não foi
executado ainda: só o roteamento foi conferido, com um servidor estático local.

Uma aplicação só, porque as três áreas consomem os mesmos dados e o mesmo
deploy. O checkout é público e precisa carregar rápido num celular; o console é
interno.

## Para que serve

Duas coisas, nesta ordem de prioridade:

1. **Observabilidade**: o que está acontecendo no gateway agora e no período.
2. **Gestão**: mudar a política sem editar YAML no servidor e sem reiniciar.

## Telas

### Login

`/login`: usuário e senha. Enquanto não há sessão, as telas do dashboard
mandam para cá. É a única tela do console que não exige autenticação.

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
- Receita por ativo: total em USDC, em XLM (ambos no trilho `exact`) e em BRL
  (Pix), com a contagem de liquidações. Cada ativo tem seu próprio total; somar
  unidades atômicas de USDC com as de XLM daria um número sem significado, mesmo
  tendo os dois 7 decimais. `GET /awall/stats/summary` devolve `rail`, `asset` e
  o `code` legível (`USDC`, `XLM`, `BRL`) por linha.
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

Endpoints de leitura do console, todos sob o prefixo de controle:

| Método e rota | Resposta |
| --- | --- |
| `POST /awall/auth/login` | sem autenticação: recebe `username` e `password`, devolve cookie de sessão |
| `POST /awall/auth/logout` | revoga a sessão atual e limpa o cookie |
| `GET /awall/auth/me` | o usuário da sessão, ou `{"auth":"bearer","user":null}` |
| `POST /awall/stats/stream-ticket` | ticket de uso único para abrir o SSE |
| `GET /awall/stats/stream?ticket=` | SSE com um evento por requisição e por pagamento |
| `GET /awall/stats/summary?window=1h` | contadores, receita por trilho, requisições recuperadas |
| `GET /awall/usage?from&to&identityId&decision` | eventos paginados |
| `GET /awall/identities` | lista com saldo, escore e multiplicador |
| `GET /awall/identities/:id` | detalhe, extrato do ledger e recibos |
| `GET /awall/payments?status` | offers e pagamentos |
| `GET /awall/policy` | política efetiva, com a origem de cada valor (YAML ou override) |
| `GET /awall/health/checks` | resultado das checagens da tela Saúde |
| `PUT /awall/policy` | **fase 2**: aplica uma nova versão da política |

### Login de console: sessão em cookie

`POST /awall/auth/login` recebe `username` e `password` em JSON e devolve um
cookie `awall_session`, `HttpOnly`, `SameSite=Strict`, e `Secure` quando a
requisição chega por HTTPS — direto, ou com `X-Forwarded-Proto: https` posto
pela borda. O token da sessão existe no cookie e em nenhum outro lugar: o banco
guarda só o SHA-256 (ver `docs/04-modelo-dados.md`). A sessão dura 12 horas
(`SESSION_TTL_MS`).

Credencial errada devolve `401` com `{"error":"invalid_credentials"}`, e é a
**mesma** resposta para usuário inexistente, senha errada e usuário
desabilitado: mesmo corpo, mesmo status e mesmo custo, porque o argon2id roda
também quando o usuário não existe. Sem isso, o tempo de resposta diria quais
usuários existem. Corpo que não é um par de strings devolve `400`
(`invalid_body`): é erro de cliente, não credencial recusada.

Senha não entra em log, em mensagem de erro nem em URL. O log de uma tentativa
recusada não traz nem o `username`, porque um log de recusas enumeraria os
usuários do mesmo jeito.

`POST /awall/auth/logout` preenche `revoked_at` e limpa o cookie; chamado com
bearer, devolve `401` (`no_session`), porque não há sessão para encerrar.

### Sessão ou bearer, nessa ordem

O middleware de autorização aceita **sessão ou** `AWALL_ADMIN_TOKEN`, nessa
ordem. A sessão vem primeiro porque nomeia uma pessoa. O bearer continua
valendo: `scripts/demo.sh` e os exemplos de `deploy/README.md` dependem dele, e
quebrá-los custaria mais do que a mudança vale. Depreciar o token é assunto de
issue própria.

O log de auditoria passa a gravar o usuário da sessão. `X-AWall-Actor` só é
lido quando não há sessão, isto é, no caminho do bearer — o header é escolhido
pelo cliente e nunca foi verificado por ninguém.

### Primeiro usuário

Sem usuário cadastrado ninguém entra pela tela de login. O primeiro vem de
`pnpm --filter @awall/gateway create-user`, que lê a senha da entrada padrão e
nunca de argumento de linha de comando: argumento vai para o histórico do shell
e aparece na lista de processos.

Revogar acesso é preencher `disabled_at` no usuário, o que também mata as
sessões vivas dele. Não existe tela para isso ainda.

### Cookie e origem

`SameSite=Strict` quer dizer que o cookie só viaja em requisição do mesmo site.
No `docker compose`, o Caddy serve console e gateway no mesmo host, então isso
já vale. Em desenvolvimento, o console chama o gateway pelo proxy do Vite, no
mesmo origin de `pnpm --filter @awall/console dev`; `VITE_AWALL_URL` continua
existindo para apontar o console para outro host. O CORS do plano de controle
responde `Access-Control-Allow-Credentials: true` e devolve a origem exata da
allowlist, nunca `*`.

### Token de admin: só no header

O `AWALL_ADMIN_TOKEN` viaja em `Authorization: Bearer`, nunca na query string:
uma URL vai para o log de acesso do gateway, para o log de todo proxy na frente
dele e para o histórico do navegador. O `EventSource` do navegador não manda
header, então o console primeiro chama `POST /awall/stats/stream-ticket` com o
header e recebe um ticket de uso único, válido por 30 segundos
(`STREAM_TICKET_TTL_MS`), que é o que aparece na URL do SSE. Ticket gasto ou
vencido devolve `401`; como ele vale uma vez, reconectar exige emitir outro.

### Paginação

`GET /awall/usage`, `GET /awall/identities`, `GET /awall/payments` e o extrato
de `GET /awall/identities/:id` aceitam `limit` e `offset`. O padrão é 50 linhas
e o teto é 200 (`DEFAULT_PAGE_LIMIT` e `MAX_PAGE_LIMIT`). Valor inválido cai no
padrão em vez de devolver `400`. Cada resposta traz um descritor:

```json
{ "limit": 50, "offset": 0, "hasMore": true, "nextOffset": 50 }
```

`hasMore` vem de ler uma linha além da página, não de contar a tabela. Números
que descrevem o locatário inteiro — a média do escore de abuso, por exemplo —
são agregados em SQL sobre toda a tabela, nunca a média da página.

### Saúde

`GET /awall/health/checks` não imprime número que não mediu. `database` é o
resultado de um `select 1` de verdade, com a latência e, na falha, o código do
erro do driver (nunca a mensagem, que pode conter a string de conexão).
`decisionMs` cronometra uma chamada real a `decide`, sobre a primeira rota da
política vigente, e a resposta diz qual requisição foi medida.

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

- Quem opera entra com usuário e senha na tela `/login`. O gateway devolve um
  cookie de sessão; o detalhe está em *Login de console: sessão em cookie*.
  Sem sessão e sem token, os endpoints do console respondem `401` — inclusive
  os de leitura, porque eles expõem consumo por cliente.
- Token de administrador em `AWALL_ADMIN_TOKEN`, enviado como
  `Authorization: Bearer`, continua valendo para chamada de linha de comando.
  O middleware tenta a sessão primeiro e o token depois.
- O campo de token saiu da interface. O console não guarda mais segredo em
  `sessionStorage`: o cookie é `HttpOnly` e o JavaScript da página não o lê.
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
