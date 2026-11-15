# 05 — Roadmap

Prazo real de submissão: **30 de novembro de 2026, 23h59 (horário de Brasília)**.
Data de referência deste plano: 15 de novembro. Meta interna: **submeter dia 28**,
deixando 48 horas de folga para imprevisto.

Regra do hackathon que afeta o plano: o repositório precisa ser público, criado
depois da abertura (4 de novembro), com licença que permita ao júri ler, executar
e testar. Boilerplate open source já público é exceção permitida.

## Marcos

| Dia | Entrega | Pronto quando |
| --- | --- | --- |
| 15/11 | Esqueleto do monorepo; `origin-demo` no ar; proxy repassando tráfego; policy YAML carregando; token bucket por identidade. **Em paralelo: setup Stellar** — duas contas de testnet pelo friendbot, trustline de USDC nas duas, USDC de testnet na conta do agente, e probe no `/supported` do facilitator confirmando `exact` em `stellar:testnet` | `curl` atravessa o gateway e o 101º pedido no minuto recebe 402 com corpo JSON; uma transferência manual de USDC entre as duas contas funciona |
| 16-17/11 | Trilho M2M completo em Stellar testnet: `PaymentRequired` com `areFeesSponsored`, revalidação dos termos, `/verify`, `/settle`, crédito | `apps/agent-m2m` roda em loop, toma 402, assina auth entries, paga e continua sem intervenção |
| 18-19/11 | Ledger em Postgres: identidades, offers, payments, lançamentos, idempotência, estorno de 5xx | teste de invariante `sum(delta_cu) = cu_balance` passa; webhook duplicado não credita duas vezes |
| 20-21/11 | Trilho Pix: offer com cobrança AbacatePay, página de paywall, webhook, polling de status | humano paga Pix no ambiente de teste e o agente assistido retoma sozinho |
| 22/11 | `specs/scheme_pix.md` escrito no formato do template oficial de schemes | documento completo, com fluxo, campos obrigatórios e considerações de segurança |
| 23-24/11 | Escore de abuso e preço dinâmico; headers informativos; recibos | duas identidades com padrões diferentes recebem preços diferentes, visível no dashboard |
| 25/11 | Dashboard ao vivo por SSE: 200/402/pagos, receita por trilho, requisições recuperadas | dashboard reflete a demo em tempo real, sem recarregar |
| 26/11 | Deploy HTTPS (gateway e console), seed de demonstração, `scripts/demo.sh` | roteiro inteiro roda contra a URL pública |
| 27/11 | Endurecimento: testes, tratamento de erro do facilitator, `settlement_pending`, limites de corpo e timeout | suíte verde; falha do facilitator não derruba o gateway |
| 28/11 | README final, vídeo de 3 minutos, submissão | submetido |
| 29-30/11 | Folga | — |

## Ordem de implementação dentro do gateway

A ordem importa, porque cada etapa é demonstrável sozinha:

1. Proxy burro (repassa tudo).
2. Política + custo em CU + token bucket → 402 sem pagamento ainda (corpo JSON).
3. `PaymentRequired` correto no header, offer no banco.
4. Verificação e liquidação `exact`, crédito, débito de CU.
5. Ledger persistido e idempotência.
6. Trilho Pix sobre a mesma offer.
7. Escore de abuso multiplicando o preço.
8. Observabilidade (SSE, recibos, dashboard).
9. Rota medida: custo em CU calculado a partir da medição da origin.

## Cortes de escopo, em ordem de sacrifício

Se o cronograma apertar, corta de cima para baixo. Cada corte é uma decisão
consciente, não uma falha:

1. **Rota medida** (`metered: true`, custo em CU calculado após a resposta). O
   custo fixo por rota já sustenta a narrativa inteira.
2. **Preço dinâmico por escore de abuso** → multiplicador fixo por tier. O escore
   continua sendo calculado e exibido, só não altera preço.
3. **Dashboard rico** → tabela simples com SSE.
4. **Promoção de identidade** (fingerprint para wallet) → identidade só por chave
   de API.
5. **Recibos por identidade** → extrato só no dashboard.

Não cortáveis, porque são a tese do projeto: 402 em vez de 429, trilho M2M em
stablecoin, trilho Pix para agente assistido, ledger com idempotência.

## Testes mínimos

- Unidade: cálculo de CU por rota, token bucket, multiplicador de abuso,
  codificação e decodificação base64 dos três headers, e conversão de preço para
  unidades atômicas com 7 decimais (o erro de decimais é o mais provável do
  projeto).
- Invariante: ledger (soma dos lançamentos igual ao saldo) como teste de
  propriedade.
- Integração: 402 → pagamento → 200, com facilitator falso; webhook duplicado;
  origin 5xx gera estorno; cliente adulterando `amount` no `accepted` é rejeitado.
- Ponta a ponta: `scripts/demo.sh` como teste executável do roteiro da demo.

## Infraestrutura

- Gateway: um container, deploy em Fly.io ou Railway, HTTPS gerenciado.
- Console: Vercel.
- Postgres: Neon, free tier.
- Segredos necessários: endereço Stellar de recebimento (`payTo`; a chave privada
  dele não entra no gateway), URL do facilitator, URL do Soroban RPC, chave de API
  da AbacatePay, segredo do webhook, URL do Postgres. A chave privada do agente de
  demonstração vive só em `apps/agent-m2m`, e é de testnet.
- Nenhum segredo no repositório. `.env.example` documenta todos.

## O que entregar na submissão

- Repositório público com licença MIT, README explicando como rodar local em um
  comando.
- Demo HTTPS acessível pelo júri, com chave de API de demonstração publicada no
  README, Pix em ambiente de teste e carteira Stellar de testnet com saldo de USDC
  para quem quiser reproduzir o fluxo M2M.
- Vídeo de até 3 minutos (roteiro em [06-demo-e-pitch.md](06-demo-e-pitch.md)).
- Nome, resumo e descrição no painel, na trilha *Pagamentos e finanças*.
