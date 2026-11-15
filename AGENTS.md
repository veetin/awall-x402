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
8. **Falha da origin (5xx) estorna o créditos.** Cliente não paga pelo nosso erro.
9. **Segredo nunca entra no repositório.** Só `.env.example` com as chaves
   documentadas e valores vazios.
10. **Chave de API só persiste como hash** (SHA-256). Nunca em claro, nunca em log.
11. **A unidade de consumo chama `credits`** (em português, "créditos"). Nunca
    `CU`, nunca "compute units": o nome anterior foi abandonado de propósito.

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
- Console: Next 15.
- Pix: AbacatePay (`POST /v1/pixQrCode/create`, status, webhook assinado).

Os pacotes v2 são escopados (`@x402/*`, série 2.x). **O pacote `x402` sem escopo é
v1 e não deve ser usado**; o binding Stellar declara que v1 não será suportado.

Antes de adicionar qualquer dependência nova: confira se um pacote `@x402/*` ou o
`@stellar/stellar-sdk` já resolve. Não adicione biblioteca de HTTP client, de
validação ou de utilidades sem necessidade concreta.

## Layout

```
apps/gateway/      proxy, política, ledger, orquestração de pagamento (:8402)
apps/console/      Next: dashboard e paywall
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
- Commits em Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), assunto em
  inglês, imperativo.
- Sem `any`. Sem `as` para silenciar o compilador. Erro de tipo é informação.
- Valores monetários em `bigint` ou `string`, nunca `number`.
- Erro de domínio é tipo de retorno, não exceção solta: o gateway precisa
  transformar falha de pagamento em 402 com `errorReason`, não em 500.
- Log estruturado (JSON), sem corpo de requisição, sem chave de API, sem dado
  pessoal.
- Nada de `console.log` deixado no caminho de requisição.

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
