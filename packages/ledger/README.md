# @awall/ledger

Ledger de crédito do AWall: Postgres com Drizzle. Crédito é **append-only**, saldo
é projeção. Nenhum caminho de código escreve `identities.credit_balance` sem
inserir o lançamento correspondente em `credit_ledger` na mesma transação.

Schema conforme [docs/04-modelo-dados.md](../../docs/04-modelo-dados.md):
`identities`, `usage_events`, `offers`, `payments`, `credit_ledger`. Valor
monetário é sempre inteiro (`bigint`) ou string de inteiro (`text`), nunca float.
Em Stellar o USDC tem 7 decimais: 0,50 USDC são `"5000000"`.

## API

Todas as funções recebem a conexão como primeiro argumento — o pacote nunca abre
conexão por conta própria nem lê variável de ambiente. Erro de domínio é tipo de
retorno, não exceção: o gateway transforma falha em 402, não em 500.

### Conexão

| Função | O que faz |
| --- | --- |
| `createLedgerDatabase(url, max?)` | pool node-postgres sobre o schema |
| `runMigrations(db)` | aplica os SQL de `drizzle/` |

Os tipos `Database`, `Transaction` e `Executor` aceitam qualquer driver Drizzle de
Postgres, então a mesma função roda contra o pool do gateway e contra o PGlite dos
testes.

### Identidade e consumo

| Função | O que faz |
| --- | --- |
| `ensureIdentity(db, input)` | insere na primeira vez, depois atualiza `last_seen_at` |
| `getIdentity(db, id)` | lê a identidade, `null` se desconhecida |
| `recordUsageEvent(db, input)` | grava uma linha por requisição e devolve o id gerado |

`decision` é `allow_free`, `allow_credit`, `payment_required` ou `refunded`.
`payment_required` é a contagem de requisições que o rate limit teria descartado.

### Crédito

| Função | O que faz |
| --- | --- |
| `debitCredits(db, input)` | cobra o custo da rota |
| `refundCredits(db, input)` | estorna quando a origin devolve 5xx |
| `grantCredits(db, input)` | credita o pacote pago, uma vez por pagamento |
| `getBalance(db, identityId)` | saldo materializado |
| `ledgerSum(db, identityId)` | `sum(delta_credits)`, para conferir a invariante |

`debitCredits` trava a identidade com `SELECT … FOR UPDATE`, então requisições
concorrentes da mesma identidade serializam e o saldo nunca fica negativo. Saldo
insuficiente **não escreve nada** e devolve
`{ ok: false, reason: "insufficient_credits", balance }` — é o gatilho do 402.

`grantCredits` insere em `payments` com `ON CONFLICT (idempotency_key) DO NOTHING`.
Se nada foi inserido, o pagamento já foi processado: não credita e devolve o
resultado do processamento original (`alreadyProcessed: true`, mesmo `paymentId` e
mesmo `balanceAfter`). É a defesa contra webhook duplicado e contra retry de
settle. Pagamento com `status` diferente de `settled` é gravado sem creditar. No
caminho que credita, a offer vira `paid`, o saldo é atualizado e o lançamento
`grant` é inserido na mesma transação.

### Offers

| Função | O que faz |
| --- | --- |
| `createOffer(db, input)` | grava os termos emitidos no 402 (`ofr_` + id aleatório) |
| `getOffer(db, id, now?)` | lê a offer, expirando antes a que passou do prazo |
| `markOfferPaid(db, id)` | move `pending` para `paid`, só uma vez |

A expiração é decidida no servidor, nunca por confiança no `maxTimeoutSeconds` que
o cliente devolve. O valor cobrado vem desta linha, nunca do payload do cliente.

## Banco

```
DATABASE_URL=postgres://... pnpm --filter @awall/ledger db:push
```

`db:push` aplica o schema direto (bom para desenvolvimento). `db:generate` gera um
novo SQL em `drizzle/` quando o schema muda; é esse SQL que os testes aplicam.

## Testes

Rodam sem Docker e sem servidor: `@electric-sql/pglite` sobe Postgres em processo e
as migrations geradas são aplicadas nele.

```
pnpm --filter @awall/ledger test
pnpm --filter @awall/ledger typecheck
```

Cobertura relevante:

- **invariante do ledger** (`test/invariant.test.ts`), como teste de propriedade
  sobre sequências aleatórias de débito, estorno e crédito, com seed fixa para ser
  reproduzível: `sum(delta_credits) = identities.credit_balance` e o
  `balance_after` do último lançamento é igual ao saldo;
- **idempotência** (`test/idempotency.test.ts`): `grantCredits` duas vezes com a
  mesma `idempotency_key` credita uma vez só;
- **débito concorrente** (`test/concurrency.test.ts`): o saldo não fica negativo.
  O PGlite tem uma única conexão, então ele serializa as transações em vez de
  exercitar o `FOR UPDATE`; o teste fixa o resultado que o lock tem que produzir,
  mas contenção real contra um servidor Postgres não está coberta aqui;
- **saldo insuficiente** (`test/debit.test.ts`): nada é escrito.

## Fora do pacote

`usage_rollups` (agregados por hora) e o job de retenção de 7 dias não estão aqui:
nada neste pacote escreveria nessas linhas hoje. A promoção de identidade
`fingerprint` para `wallet` quando o pagamento revela o `payer` fica com a sessão de
liquidação, que é quem conhece o `SettlementResponse`.
