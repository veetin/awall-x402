# 04 — Modelo de dados

Postgres com Drizzle. O princípio central: **crédito é ledger append-only**, saldo
é projeção. Nenhum caminho de código escreve saldo sem escrever o lançamento
correspondente na mesma transação.

## Tabelas

### `identities`

Quem consome a API.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | text PK | `idt_` + nanoid |
| `kind` | text | `api_key` \| `wallet` \| `signed_agent` \| `fingerprint` |
| `api_key_hash` | text null | SHA-256 da chave; nunca a chave |
| `wallet` | text null | endereço Stellar, quando conhecido: `G…`/`C…` (56 chars) ou `M…` muxed (69) |
| `fingerprint` | text null | hash de IP + ASN + User-Agent |
| `abuse_score` | real | 0..1, média móvel exponencial |
| `credit_balance` | bigint | saldo materializado, atualizado só com lançamento |
| `first_seen_at` | timestamptz | |
| `last_seen_at` | timestamptz | |

Índices únicos parciais em `api_key_hash`, `wallet` e `fingerprint`.

Quando uma identidade `fingerprint` paga, o `payer` da liquidação é gravado em
`wallet` e a identidade é promovida para `kind = 'wallet'`. Pagar consolida
identidade.

### `usage_events`

Uma linha por requisição. É a fonte do dashboard e da métrica de impacto.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | bigserial PK | |
| `identity_id` | text FK | |
| `method` | text | |
| `route` | text | padrão casado da política, não o path cru |
| `credits` | integer | custo cobrado |
| `decision` | text | `allow_free` \| `allow_credit` \| `payment_required` \| `refunded` |
| `origin_status` | integer null | status devolvido pela origin |
| `latency_ms` | integer null | |
| `request_hash` | text | hash de método + path + query + corpo, para duplicatas |
| `created_at` | timestamptz | |

Índice em `(identity_id, created_at desc)` e em `(created_at desc)`.

`decision = 'payment_required'` é a contagem de "requisições que o rate limit
teria descartado". Combinada com os pagamentos, dá a receita recuperada.

### `offers`

Termos de pagamento emitidos num 402. Vive por 15 minutos.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | text PK | `ofr_` + nanoid, aparece em `extra.offerId` |
| `identity_id` | text FK | a quem o crédito será dado |
| `pack_credits` | integer | créditos que o pagamento compra |
| `price_usdc_atomic` | text | string, unidades atômicas com **7 decimais** (Stellar), evita float |
| `price_brl_cents` | integer | |
| `multiplier` | real | multiplicador de abuso aplicado |
| `network` | text | CAIP-2, ex. `stellar:testnet` |
| `asset` | text | contrato SEP-41 do token (`C…`) ou código ISO 4217 |
| `pay_to` | text | carteira de recebimento ou `merchant` |
| `rails` | text[] | `{exact,pix}` |
| `pix_charge_id` | text null | id da cobrança na AbacatePay |
| `pix_br_code` | text null | copia-e-cola |
| `status` | text | `pending` \| `paid` \| `expired` \| `canceled` |
| `expires_at` | timestamptz | |
| `created_at` | timestamptz | |

Valores monetários são sempre inteiros ou strings de inteiro. Nunca float. Em
Stellar o USDC tem **7 decimais**: 0,50 USDC são `"5000000"`. Qualquer exemplo
copiado de EVM (6 decimais) erra o valor em cem vezes.

### `payments`

Liquidação efetiva, de qualquer trilho.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | text PK | `pay_` + nanoid |
| `offer_id` | text FK | |
| `rail` | text | `exact` \| `pix` |
| `amount` | text | unidades atômicas (cripto) ou centavos (Pix) |
| `asset` | text | |
| `network` | text | |
| `idempotency_key` | text UNIQUE | hash da transação on-chain, ou `pix:<chargeId>` |
| `tx_hash` | text null | hash Stellar em hex de 64 caracteres |
| `payer` | text null | endereço pagador, quando houver (vazio no trilho Pix, por decisão do scheme) |
| `settle_response` | jsonb null | `SettlementResponse` bruto, para auditoria |
| `status` | text | `settled` \| `failed` \| `pending` |
| `error_reason` | text null | código de erro do x402 |
| `created_at` | timestamptz | |

A unicidade de `idempotency_key` é a defesa contra webhook duplicado e contra
retry de settle. Conflito na inserção significa "já processado": a resposta é a
mesma do processamento original, sem crédito novo.

### `credit_ledger`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | bigserial PK | |
| `identity_id` | text FK | |
| `delta_credits` | bigint | positivo em crédito, negativo em débito |
| `reason` | text | `grant` \| `debit` \| `refund` \| `expiry` |
| `payment_id` | text null FK | preenchido em `grant` |
| `usage_event_id` | bigint null FK | preenchido em `debit` e `refund` |
| `balance_after` | bigint | saldo resultante, para conferência |
| `created_at` | timestamptz | |

Invariante verificável por teste: para toda identidade,
`sum(delta_credits) = identities.credit_balance`, e o `balance_after` do último lançamento
é igual ao saldo. Um teste de propriedade sobre essa invariante vale mais que
qualquer teste de unidade do ledger.

### `console_users`

Quem entra no console do operador. Não tem relação com `identities`: identidade é
quem consome a API, usuário de console é quem opera o gateway.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | text PK | prefixo `usr_` |
| `username` | text UNIQUE | como digitado no login |
| `password_hash` | text | argon2id em formato PHC, nunca a senha |
| `created_at` | timestamptz | |
| `last_login_at` | timestamptz null | nulo até o primeiro login |
| `disabled_at` | timestamptz null | nulo enquanto ativo |

Revogação é `disabled_at`, não `DELETE`: o log de auditoria continua apontando
para um `username` que resolve. Preencher `disabled_at` também revoga, na mesma
transação, toda sessão viva do usuário — cookie já emitido para de valer.

O hash é argon2id do `node:crypto` (nativo a partir do Node 24), com os
parâmetros em `apps/gateway/src/auth.ts`. O formato PHC guarda o custo junto do
hash, então subir o custo depois não invalida o que já está gravado.

### `console_sessions`

Uma linha por login do console.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | text PK | prefixo `ses_` |
| `user_id` | text FK | referência a `console_users.id` |
| `token_hash` | text UNIQUE | SHA-256 do token de sessão, hex |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | |
| `revoked_at` | timestamptz null | nulo enquanto válida; preenchido no logout |

Vale a mesma regra da chave de API: **só o hash persiste**. O token em claro
existe no cookie `HttpOnly` e em nenhum outro lugar, então um dump do banco não
entrega sessão viva. Expirada, revogada e de usuário desabilitado são a mesma
resposta — `401` — porque não há nada que o cliente deva aprender sobre qual dos
três se aplicou.

## Transações

**Débito de crédito** (requisição atendida com saldo):

```sql
BEGIN;
SELECT credit_balance FROM identities WHERE id = $1 FOR UPDATE;
-- se credit_balance < custo da rota: ROLLBACK e emite 402
UPDATE identities SET credit_balance = credit_balance - $2 WHERE id = $1;
INSERT INTO credit_ledger (identity_id, delta_credits, reason, usage_event_id, balance_after) ...;
COMMIT;
```

`SELECT ... FOR UPDATE` serializa requisições concorrentes da mesma identidade.
É o ponto de contenção conhecido e aceito do MVP.

**Crédito após pagamento**:

```sql
BEGIN;
INSERT INTO payments (...) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id;
-- nenhuma linha retornada: pagamento já processado, encerra sem creditar
UPDATE offers SET status = 'paid' WHERE id = $1 AND status = 'pending';
UPDATE identities SET credit_balance = credit_balance + $2 WHERE id = $3;
INSERT INTO credit_ledger (..., reason = 'grant', payment_id = $4, ...);
COMMIT;
```

**Estorno** quando a origin devolve 5xx: lançamento `refund` positivo referenciando
o `usage_event`. O cliente não paga por falha do servidor.

## Segurança do dado

- Chave de API nunca é persistida em claro, só o hash.
- Senha de console nunca é persistida em claro, só o hash argon2id; e nunca
  aparece em log, em mensagem de erro ou em URL.
- Token de sessão do console nunca é persistido em claro, só o SHA-256.
- Webhook da AbacatePay tem assinatura validada; além disso, o gateway confirma o
  status consultando a API da AbacatePay antes de creditar. Webhook é gatilho, não
  é fonte de verdade.
- Nada que vem do cliente no `accepted` é usado para decidir valor. O valor vem da
  offer gravada no banco.
- Expiração de offer é verificada no servidor, não por confiança no
  `maxTimeoutSeconds` enviado de volta.

## Retenção

`usage_events` cresce rápido. Para o MVP, retenção de 7 dias com job de limpeza;
agregados por hora em `usage_rollups` (identidade, rota, hora, contagens, créditos, créditos
pago) alimentam o dashboard histórico.
