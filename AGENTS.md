# AGENTS.md

Instruções para agentes de código que trabalham neste repositório. Leia antes de
escrever qualquer linha.

## O projeto

AWall é um gateway reverse proxy que substitui `429 Too Many Requests` por
`402 Payment Required` usando o protocolo x402. Acima da cota gratuita, o cliente
recebe termos de pagamento legíveis por máquina, paga e continua. Dois trilhos no
mesmo 402: `exact` em USDC na Stellar (agente autônomo) e um scheme `pix` próprio
(agente assistido, humano no circuito).

Entrega para o Hack Brasil 2026, trilha *Pagamentos e finanças*. Submissão fecha
**30/11/2026 23:59 BRT**, meta interna 28/11. O prazo é a restrição dominante:
escopo novo precisa de justificativa, escopo cortado está listado e é intencional.

## Documentos de referência

Leia o que for relevante antes de mudar comportamento. Se a mudança contraria o
documento, atualize o documento no mesmo commit.

| Arquivo | Quando ler |
| --- | --- |
| `docs/02-arquitetura.md` | antes de criar componente, arquivo ou pacote novo |
| `docs/03-protocolo.md` | antes de tocar em qualquer coisa de x402, headers ou 402 |
| `docs/04-modelo-dados.md` | antes de mexer em schema, ledger ou transação de banco |
| `docs/05-roadmap.md` | antes de começar uma feature: confere ordem e cortes |
| `specs/scheme_pix.md` | antes de tocar no trilho Pix |
| `docs/08-dashboard.md` | antes de tocar no console, no plano de controle ou nos endpoints `/awall/*` |
| `docs/07-producao.md` | antes de mexer em deploy, proxy de borda ou estado compartilhado |

## Regras duras

Quebrar uma destas é bug, não escolha de estilo.

1. **Dinheiro nunca é float.** Sempre inteiro ou string de inteiro, em unidades
   atômicas (cripto) ou centavos (BRL).
2. **USDC na Stellar tem 7 decimais.** 0,50 USDC são `"5000000"`. Exemplo copiado
   de EVM (6 decimais) erra o valor em 10×. Vale para comentário e documentação
   também, não só para código.
3. **Nada que vem do cliente decide valor.** O objeto `accepted` do
   `PAYMENT-SIGNATURE` é verificado contra a política e contra a offer gravada no
   banco. O valor cobrado vem do banco, nunca do payload.
4. **Todo pagamento tem chave de idempotência** (`tx_hash` em cripto,
   `pix:<chargeId>` em Pix), com constraint `UNIQUE`. Crédito duplicado é falha
   grave.
5. **Webhook é gatilho, não fonte de verdade.** Validar assinatura e confirmar o
   status consultando a API do provedor antes de creditar.
6. **Crédito é ledger append-only.** Nenhum caminho de código escreve
   `identities.credit_balance` sem inserir o lançamento correspondente em
   `credit_ledger` na mesma transação.
7. **Cota esgotada responde 402, nunca 429.** É a tese do projeto.
8. **Falha da origin (5xx) estorna os créditos.** Cliente não paga pelo nosso erro.
9. **Segredo nunca entra no repositório.** Só `.env.example` com as chaves
   documentadas e valores vazios.
10. **Chave de API só persiste como hash** (SHA-256). Nunca em claro, nunca em log.
11. **A unidade de consumo chama `credits`** (em português, "créditos"). Nunca
    `CU`, nunca "compute units": o nome anterior foi abandonado de propósito.
12. **O prefixo `/awall` é reservado** e nunca é encaminhado para a origin. Os
    endpoints do console exigem `AWALL_ADMIN_TOKEN`; só `GET /awall/offers/:id` é
    público, e ele não devolve dado de identidade.

## Fatos de rede (não adivinhe, use estes)

| Item | Valor |
| --- | --- |
| Rede default | `stellar:testnet` (CAIP-2) |
| Rede produção | `stellar:pubnet`, atrás de variável de ambiente |
| Ativo (testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Decimais | 7 |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Facilitator | `https://www.x402.org/facilitator` (`/verify`, `/settle`, `/supported`) |
| `extra.areFeesSponsored` | `true`, obrigatório no `PaymentRequirements` de Stellar |

Detalhes que causam falha silenciosa:

- O USDC de testnet é um **SAC de ativo classic**. Pagador e recebedor precisam de
  **trustline de USDC** antes de qualquer transferência.
- O cliente assina **auth entries** da invocação Soroban, não a transação inteira.
  Expiração em `currentLedger + ceil(maxTimeoutSeconds / ~5s)`.
- Em Stellar só existe o scheme **`exact`**. `upto` e `auth-capture` são EVM (o
  `upto` também SVM). Medição de consumo é off-chain, no ledger de créditos.

## Stack e dependências

- TypeScript estrito, Node 22, pnpm workspaces.
- Gateway: Hono + `@x402/hono`.
- Stellar: `@x402/stellar` (2.28.0) + `@stellar/stellar-sdk` (^16.3.0).
- Cliente de demonstração: `@x402/fetch`.
- Banco: Postgres + Drizzle.
- Console: Vite + React + TypeScript (escopo em `docs/08-dashboard.md`).
- Pix: AbacatePay (`POST /v2/transparents/create` com `method: "PIX"`, status,
  webhook). `data.externalId` é o campo de idempotência do provedor.

Os pacotes v2 são escopados (`@x402/*`, série 2.x). **O pacote `x402` sem escopo é
v1 e não deve ser usado**; o binding Stellar declara que v1 não será suportado.

Antes de adicionar qualquer dependência nova: confira se um pacote `@x402/*` ou o
`@stellar/stellar-sdk` já resolve. Não adicione biblioteca de HTTP client, de
validação ou de utilidades sem necessidade concreta.

## Layout

```
apps/gateway/      proxy, política, ledger, orquestração de pagamento (:8402)
apps/console/      Vite + React: dashboard do operador e checkout público
apps/origin-demo/  API protegida de exemplo
apps/agent-m2m/    agente autônomo com carteira Stellar de testnet
packages/policy/   parser do YAML, créditos, preço, multiplicador de abuso
packages/ledger/   Postgres + Drizzle, ledger e idempotência
packages/pix/      scheme pix: termos, adapter AbacatePay
docs/              desenho (pt-BR)
specs/             scheme_pix.md (en)
scripts/demo.sh    roteiro executável da demo
```

Código novo vai para o pacote cujo nome descreve a responsabilidade. Lógica de
pagamento não vai para `apps/gateway` se couber em `packages/pix` ou
`packages/policy`.

## Convenções

- **Código, identificadores, comentários e mensagens de erro em inglês.**
  Documentação em `docs/` em português; `specs/` em inglês.
- Commits e branches: ver a seção **Commits e branches** abaixo.
- Sem `any`. Sem `as` para silenciar o compilador. Erro de tipo é informação.
- Valores monetários em `bigint` ou `string`, nunca `number`.
- Erro de domínio é tipo de retorno, não exceção solta: o gateway precisa
  transformar falha de pagamento em 402 com `errorReason`, não em 500.
- Log estruturado (JSON), sem corpo de requisição, sem chave de API, sem dado
  pessoal.
- Nada de `console.log` deixado no caminho de requisição.

## Commits e branches

Conventional Commits, sem variação. O formato é:

```
<tipo>(<escopo>)!: <assunto>

<corpo opcional>

<rodapé opcional>
```

### Tipos

| Tipo | Quando usar |
| --- | --- |
| `feat` | comportamento novo visível para quem usa o sistema |
| `fix` | correção de defeito. **Não use `bugfix`**: no padrão o tipo é `fix` |
| `docs` | só documentação, inclusive `docs/`, `specs/` e este arquivo |
| `refactor` | muda estrutura sem mudar comportamento |
| `test` | só teste, sem mexer no código de produção |
| `perf` | melhora de desempenho |
| `build` | dependências, pnpm, TypeScript, configuração de build |
| `ci` | pipeline e automação |
| `chore` | manutenção que não encaixa acima (limpeza, renomeio de arquivo, lockfile) |
| `revert` | desfaz um commit anterior, citando o hash no corpo |

`!` antes dos dois pontos marca quebra de compatibilidade, e nesse caso o rodapé
traz `BREAKING CHANGE: <o que quebrou e o que fazer>`. Mudar o formato do 402, o
nome de um header `X-AWall-*`, o schema da política ou o schema do banco é
quebra de compatibilidade.

### Escopos

Um escopo por commit, igual ao nome da pasta: `gateway`, `console`, `policy`,
`ledger`, `pix`, `settlement`, `agent-m2m`, `origin-demo`, `docs`, `specs`. Para
mudança que atravessa o repositório inteiro (lockfile, tsconfig da raiz), omita o
escopo.

### Assunto

- Em inglês, no imperativo: `add`, não `added` nem `adds`.
- Minúscula no início, sem ponto final, no máximo 72 caracteres.
- Diz o efeito, não o arquivo: `fix(gateway): refund credits when the origin fails`,
  não `fix(gateway): change app.ts`.

### Corpo

Explica **por que**, não o que o diff já mostra. Linhas de até 72 caracteres.
Obrigatório quando a mudança tem motivo não óbvio, decisão de projeto ou
armadilha envolvida.

### Rodapé

- `Refs: VEE-12` quando o commit avança a issue.
- `Closes VEE-12` quando a conclui — o Linear fecha a issue ao mergear.
- Atribuição de agente, quando houver, vai por último.

### Branches

```
<tipo>/vee-<número>-<slug-curto>
```

Exemplos: `feat/vee-1-settlement-no-gateway`, `fix/vee-12-settlement-pending`,
`docs/vee-8-console-scope`.

O identificador da issue no meio do nome é o que faz o Linear ligar branch, PR e
issue automaticamente. O Linear sugere `feature/vee-1-...`; aqui usamos o mesmo
vocabulário dos commits (`feat`, `fix`, `chore`…), e o que importa para a ligação
é o `vee-<número>`.

Sem issue (coisa pequena e isolada), use `chore/<slug>`. Nunca trabalhe direto em
`master`.

### Um commit, uma mudança

Não misture refatoração com comportamento novo, nem correção com formatação. Se o
assunto precisa de "e", provavelmente são dois commits.

### Pull request

Título no mesmo formato do assunto do commit. Corpo diz o que muda, o que foi
verificado e o que ficou de fora. O rodapé cita a issue (`Closes VEE-12`).

## Comandos

```
pnpm install
pnpm dev              # gateway (:8402) + origin-demo (:8787), em paralelo
pnpm test             # vitest em todos os pacotes
pnpm typecheck
./scripts/demo.sh     # fluxo ponta a ponta: cota gratuita, 402, offer, estorno
```

`pnpm` vem do corepack (`corepack enable pnpm`). `pnpm db:push` e `pnpm lint`
ainda não existem: chegam com o ledger e com o linter.

## Testes mínimos por área

- Conversão de preço para unidades atômicas (7 decimais) — o erro mais provável do
  projeto.
- Token bucket e cálculo de créditos por rota.
- Codificação e decodificação base64 dos três headers x402.
- Invariante do ledger: `sum(delta_credits) = identities.credit_balance` para toda
  identidade.
- Webhook duplicado não credita duas vezes.
- Cliente adulterando `amount` no `accepted` é rejeitado.
- Origin 5xx gera estorno.

## O que não fazer

- Não aumentar escopo. Se achou algo fora do roadmap, registre e siga.
- Não trocar o modelo de cobrança (pacote de créditos) por cobrança por
  requisição.
- Não usar ativo classic da Stellar direto; o binding exige SEP-41 em Soroban.
- Não implementar `upto` ou `auth-capture` em Stellar: não existe binding.
- Não mudar formato do 402, dos headers ou do scheme `pix` sem atualizar
  `docs/03-protocolo.md` e `specs/scheme_pix.md` no mesmo commit.
- Não assumir múltiplas instâncias do gateway: o token bucket é em memória e isso
  é um corte consciente, documentado na arquitetura.
- Não usar dados inventados em dashboard, demo ou vídeo. Todo número na tela vem
  de execução real.

## Antes de encerrar uma tarefa

1. `pnpm typecheck` e `pnpm test` passam.
2. Documento afetado em `docs/` atualizado, se o comportamento mudou.
3. Nenhum segredo, nenhum endereço ou chave de produção no diff.
4. Diga explicitamente o que não foi feito ou não foi verificado.
