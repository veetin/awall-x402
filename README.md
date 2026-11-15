# AWall — x402 no lugar do 429

AWall é um gateway que troca o `429 Too Many Requests` por `402 Payment Required`.

Quando um agente de IA excede a cota gratuita de uma API, o rate limit tradicional
simplesmente nega o acesso: o cliente legítimo fica travado e o servidor continua
pagando a infraestrutura do tráfego abusivo. AWall transforma esse excedente em
receita. Em vez de bloquear, o gateway devolve um 402 com os termos de pagamento do
protocolo x402, e o agente volta a ser atendido assim que paga.

O gateway atende dois perfis de cliente com a mesma resposta 402:

- **Agente autônomo (M2M)**: paga sozinho, em USDC na **Stellar**, assinando a
  autorização x402 e repetindo a requisição. A taxa da transação é patrocinada pelo
  facilitator, então o agente não precisa manter token de gas. Nenhum humano
  envolvido.
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
| [AGENTS.md](AGENTS.md) | Regras para agentes de código: invariantes, fatos de rede, convenções |

## Rodando local

```
corepack enable pnpm
pnpm install
pnpm dev
```

O gateway sobe em `:8402` na frente da API de exemplo em `:8787`. A cota gratuita
está em [awall.yaml](awall.yaml).

```
curl -H "x-api-key: demo" "http://localhost:8402/v1/search?q=camera"
```

Repita até a cota acabar: a resposta passa a ser `402 Payment Required`, com os
termos de pagamento no header `PAYMENT-REQUIRED` e repetidos no corpo. O fluxo
inteiro também roda de uma vez:

```
./scripts/demo.sh
```

## Status

Gateway, política e API de exemplo funcionando: cota gratuita, `402` com os dois
trilhos (`exact` em Stellar e `pix`), offer com status e estorno quando a origin
falha. **A liquidação do pagamento ainda não existe** — enviar `PAYMENT-SIGNATURE`
devolve `501`, de propósito, em vez de simular sucesso. Próximo passo em
[docs/05-roadmap.md](docs/05-roadmap.md).

## Licença

MIT.
