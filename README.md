# AWall — x402 no lugar do 429

AWall é um gateway que troca o `429 Too Many Requests` por `402 Payment Required`.

Quando um agente de IA excede a cota gratuita de uma API, o rate limit tradicional
simplesmente nega o acesso: o cliente legítimo fica travado e o servidor continua
pagando a infraestrutura do tráfego abusivo. AWall transforma esse excedente em
receita. Em vez de bloquear, o gateway devolve um 402 com os termos de pagamento do
protocolo x402, e o agente volta a ser atendido assim que paga.

O gateway atende dois perfis de cliente com a mesma resposta 402:

- **Agente autônomo (M2M)**: paga sozinho, em **USDC ou moeda nativa** em redes cripto,
  assinando a autorização x402 e repetindo a requisição. A taxa da transação é
  patrocinada pelo facilitator, então o agente não precisa manter token de gas.
  Nenhum humano envolvido.
- **Agente assistido**: há uma pessoa no circuito. O mesmo 402 oferece também um
  trilho em Pix, exibido numa página de checkout com QR Code, além da opção em
  cripto.

## Trilha

Hack Brasil 2026 — trilha *Pagamentos e finanças*.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/01-visao-produto.md](docs/01-visao-produto.md) | Problema, proposta, métricas de impacto |
| [docs/02-arquitetura.md](docs/02-arquitetura.md) | Componentes, ciclo de vida da requisição, layout do repositório |
| [docs/03-protocolo.md](docs/03-protocolo.md) | Uso concreto do x402 v2, headers, exemplos de payload |
| [docs/04-modelo-dados.md](docs/04-modelo-dados.md) | Esquema do banco, ledger de crédito, idempotência |
| [docs/05-roadmap.md](docs/05-roadmap.md) | Plano dia a dia até 30 de novembro e cortes de escopo |
| [docs/06-demo-e-pitch.md](docs/06-demo-e-pitch.md) | Roteiro do vídeo de 3 minutos e checklist de submissão |
| [specs/scheme_pix.md](specs/scheme_pix.md) | Especificação do scheme `pix` para x402 |
| [docs/07-producao.md](docs/07-producao.md) | Produção: AWall atrás de nginx/Traefik, ForwardAuth, estado e falhas |
| [docs/08-dashboard.md](docs/08-dashboard.md) | Console em Vite + React: telas, contrato de API, autenticação e fases |
| [deploy/README.md](deploy/README.md) | Stack de deploy: rodada local, host público com HTTPS, checklist |
| [AGENTS.md](AGENTS.md) | Regras para agentes de código: invariantes, fatos de rede, convenções |

## Rodando local

```
corepack enable pnpm
pnpm install
pnpm dev
```

O gateway sobe em `:8402` na frente da API de exemplo em `:8787`. O console sobe
em `:4179` (com a landing do projeto em `/landing`) e a documentação técnica em
`:4180`, também acessível em `:4179/documentacao/`. A cota gratuita está em [awall.yaml](awall.yaml). Sem `DATABASE_URL`
o gateway usa um Postgres embutido, que some quando o processo sai.

Chave de demonstração: qualquer valor em `x-api-key` (o exemplo usa `demo`).

```
curl -H "x-api-key: demo" "http://localhost:8402/v1/search?q=camera"
```

Repita até a cota acabar: a resposta passa a ser `402 Payment Required`, com os
termos de pagamento no header `PAYMENT-REQUIRED` e repetidos no corpo. O fluxo
inteiro também roda de uma vez:

```
./scripts/demo.sh
```

O console do operador entra com usuário e senha em `http://localhost:4179/login`.
O primeiro usuário vem de um script, que lê a senha da entrada padrão:

```
DATABASE_URL=postgres://... pnpm --filter @awall/gateway create-user ada
```

O login precisa de um Postgres que persista: sem `DATABASE_URL` o banco
embutido some com o processo, e o usuário criado nele iria embora junto.

`AWALL_ADMIN_TOKEN` continua valendo em `Authorization: Bearer` para chamada de
linha de comando — é o que [scripts/demo.sh](scripts/demo.sh) usa. O checkout
público de uma offer é `http://localhost:4179/pay/<offerId>`.

## Stack de deploy

```
cd deploy
AWALL_ADMIN_TOKEN=local-token docker compose up -d --build
```

Sobe Postgres, a aplicação, o gateway, o console e o Caddy em `http://localhost`.
Com `AWALL_DOMAIN` apontando para um nome público, o Caddy emite e renova o
certificado sozinho e o mesmo comando serve HTTPS. O passo a passo e o checklist
estão em [deploy/README.md](deploy/README.md); exemplos de Traefik e Envoy estão
em `deploy/traefik` e `deploy/envoy`.

Este repositório **não tem demo pública** ainda: publicar depende de domínio e
conta de infraestrutura. Quando existir, a URL entra aqui.

## O que já rodou de verdade

Todo número abaixo vem de execução neste repositório. Nada aqui é estimativa.

**Uma liquidação confirmada na testnet Stellar**, pelo trilho de moeda nativa, sem humano no
circuito depois do setup:

- transação `1193d51bc83e0831e775b3f7fd13049f21f1868364008e905540be56375a048d`
  ([stellar.expert](https://stellar.expert/explorer/testnet/tx/1193d51bc83e0831e775b3f7fd13049f21f1868364008e905540be56375a048d))
- Horizon: `successful: true`, ledger `5928781`
- 7.888 XLM na conta de recebimento, taxa paga pelo patrocinador do facilitator
- o gateway creditou o pacote de 10000 créditos e o agente seguiu trabalhando na
  mesma execução

Rodar: `pnpm --filter @awall/agent-m2m setup:testnet` e depois
`AGENT_LIVE=1 ./scripts/demo.sh`. Detalhes em
[apps/agent-m2m/README.md](apps/agent-m2m/README.md).

**Duas réplicas atrás de um balanceador aplicam uma cota só**
(`./scripts/redis-replicas.sh`): 400 requisições em round robin passam 133 com
`REDIS_URL` nas duas réplicas, para uma cota de 130 créditos, e 278 sem — a fase
de controle existe para que a primeira medição não passe por acaso.

**Modo decisão provado nas duas bordas**
(`./scripts/traefik-proof.sh`, `./scripts/envoy-proof.sh`): Traefik v3.2 e Envoy
v1.32 em Docker, com os arquivos de `deploy/`. Em cada um: requisição liberada
chega na aplicação com os headers de decisão, o `402` chega íntegro ao cliente
com `PAYMENT-REQUIRED` e os três itens de `accepts`, requisição com
`PAYMENT-SIGNATURE` desvia do auth e é respondida pelo caminho de liquidação, e
uma rota medida estimada em 50 créditos cobra os 17 tokens que a aplicação
reporta — o segundo relatório da mesma reserva responde `404`.

**Suíte**: 259 testes passando, 3 pulados (os 3 pulados exigem Redis ou rede);
`pnpm typecheck` limpo; `./scripts/demo.sh` com exit 0.

## O que falta

- **Demo pública com HTTPS**: depende de domínio e conta de infraestrutura. O
  stack está pronto e verificado localmente ([deploy/README.md](deploy/README.md)).
- **Vídeo de três minutos**: roteiro em
  [docs/06-demo-e-pitch.md](docs/06-demo-e-pitch.md).
- **USDC de testnet**: o faucet da Circle pede reCAPTCHA, então nenhum saldo de
  USDC foi obtido aqui. Não bloqueia nada: o trilho de moeda nativa liquida de verdade, e o
  402 oferece os dois ativos.

## Licença

MIT.
