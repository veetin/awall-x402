# 07 — Produção: onde o AWall entra numa infra que já tem nginx ou Traefik

Resposta curta: o AWall **não substitui** o nginx nem o Traefik. A borda continua
fazendo o que faz hoje — TLS, HTTP/2 e HTTP/3, limites de corpo, timeouts,
compressão, mitigação volumétrica, roteamento. O AWall decide uma coisa só: esta
requisição passa de graça, passa com crédito, ou vira `402`.

Existem dois modos de implantação, e eles diferem em uma pergunta: o AWall fica
**no caminho da resposta** ou só **no caminho da decisão**?

## Modo A — proxy em linha (o que está implementado)

```
cliente ──► Traefik/nginx (TLS, borda) ──► AWall ──► aplicação
```

A borda trata o AWall como um upstream comum; o AWall encaminha para a aplicação.

Vantagens: funciona com qualquer borda, sem configuração especial; o AWall vê a
resposta, o que é necessário para rotas medidas (custo calculado a partir de
tokens ou bytes) e para estornar quando a aplicação devolve 5xx.

Custo: um salto a mais, e o AWall entra no caminho da resposta — se ele cair, a
API cai. Mitigação: duas réplicas sem estado compartilhado de bucket (ver
"Estado" abaixo) e `proxy_next_upstream` / health check na borda.

Quando escolher: time pequeno, tráfego moderado, ou quando as rotas medidas
importam. É o modo do MVP e da demo.

**Com nginx, este modo funciona sem configuração especial.** O `402` é uma
resposta de upstream como qualquer outra: passa inteira, com corpo e com o header
`PAYMENT-REQUIRED`, porque `proxy_intercept_errors` é `off` por padrão e o nginx
só esconde um punhado de headers de resposta (`Date`, `Server`, `X-Accel-*`).

```nginx
upstream awall { server 127.0.0.1:8402; }

server {
    listen 443 ssl;
    server_name api.exemplo.com;

    location / {
        proxy_pass http://awall;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Deixe off (o padrão): on faria o nginx engolir o 402 e servir error_page.
        proxy_intercept_errors off;

        # A liquidação fala com o facilitator: segundos, não milissegundos.
        proxy_read_timeout 60s;
    }
}
```

Com `X-Forwarded-For` vindo da borda, suba o gateway com `AWALL_TRUST_PROXY=1`.
Se a configuração existente tiver `proxy_intercept_errors on` junto de um
`error_page 402`, o cliente recebe a página de erro em vez dos termos de
pagamento: é a única pegadinha deste modo no nginx.

## Modo B — serviço de decisão (ForwardAuth / ext_authz)

```
                       ┌──► AWall /awall/decide   (decide, não serve)
cliente ──► Traefik/Envoy ──► aplicação
```

A borda pergunta ao AWall antes de cada requisição. `2xx` libera, e qualquer
coisa diferente de `2xx` é devolvida ao cliente.

Este modo — e **só** este — depende de a borda saber propagar um status
arbitrário com corpo e headers, porque o `402` precisa chegar ao cliente com o
header `PAYMENT-REQUIRED` intacto:

| Borda | Propaga `402` com corpo e headers? | Observação |
| --- | --- | --- |
| **Traefik** `forwardAuth` | **Sim.** Resposta não-2xx do serviço de auth é devolvida ao cliente com status, corpo e headers | Atenção ao `maxResponseBodySize`: corpo maior que o limite vira `401`. Nosso `PaymentRequired` tem poucos KB |
| **Envoy** `ext_authz` | **Sim.** `DeniedHttpResponse` tem `status`, `headers` e `body` | Caminho mais limpo para alto volume; use a variante gRPC |
| **nginx** `auth_request` | **Não.** Só `2xx`, `401` e `403` são respostas válidas; qualquer outro status da subrequisição é tratado como erro e o cliente recebe `500` | Dá para contornar com `auth_request_set $awall_status $upstream_status` mais `error_page`, mas o corpo e os headers da subrequisição **não** passam, então os termos de pagamento se perdem. Com nginx puro, use o Modo A, ou monte a resposta com njs/OpenResty |

### Requisições que carregam pagamento não passam pelo ForwardAuth

Verificar e liquidar um pagamento leva segundos (`/verify` e `/settle` no
facilitator). Isso estoura o timeout razoável de um ForwardAuth, que precisa
responder em milissegundos.

Solução: roteie por header. Requisição **com** `PAYMENT-SIGNATURE` vai direto ao
AWall em linha; o resto segue pelo ForwardAuth.

```yaml
# Traefik, configuração dinâmica (arquivo)
http:
  routers:
    api-payment:
      rule: "Host(`api.exemplo.com`) && HeaderRegexp(`PAYMENT-SIGNATURE`, `.+`)"
      priority: 100
      service: awall
    api:
      rule: "Host(`api.exemplo.com`)"
      priority: 10
      middlewares: [awall-decide]
      service: app

  middlewares:
    awall-decide:
      forwardAuth:
        address: "http://awall:8402/awall/decide"
        authResponseHeaders:
          - "X-AWall-Identity"
          - "X-AWall-Cost-Credits"
        maxResponseBodySize: 65536

  services:
    awall:
      loadBalancer:
        servers: [{ url: "http://awall:8402" }]
    app:
      loadBalancer:
        servers: [{ url: "http://app:8080" }]
```

O endpoint `/awall/decide` ainda não existe: está no roadmap como o passo que
habilita o Modo B. Ele recebe os headers originais (o Traefik envia
`X-Forwarded-Method` e `X-Forwarded-Uri`), decide, e devolve `204` ou o mesmo
`402` que o Modo A devolve.

### Rotas medidas no Modo B

Em modo decisão o AWall não vê a resposta, então o custo real precisa chegar por
outro caminho. Duas opções, em ordem de preferência:

1. A aplicação informa o consumo: `POST /awall/usage` com o id da identidade, a
   rota e a medição. Uma linha no fim do handler.
2. A borda envia o log de acesso para o AWall (Envoy ALS, ou log estruturado do
   Traefik consumido por um coletor), e o custo é cobrado em diferido.

Até isso existir, rota medida fica no Modo A.

## Estado, réplicas e latência

O que hoje está em memória e precisa sair de lá antes de produção:

| Estado | Hoje | Produção |
| --- | --- | --- |
| Token bucket da cota gratuita | memória do processo | Redis com script Lua atômico (`INCRBYFLOAT` + TTL não serve: precisa ser uma operação só) |
| Identidades e escore de abuso | memória | Postgres com cache local de poucos segundos |
| Offers | memória | Postgres (schema em `docs/04-modelo-dados.md`) |
| Saldo de crédito | ainda não existe | Postgres, com `SELECT ... FOR UPDATE` |

Orçamento de latência do caminho rápido (dentro da cota, sem pagamento): leitura
de bucket e decisão em um dígito de milissegundo. Isso exige o bucket em Redis na
mesma rede, não em Postgres.

Enquanto o bucket é em memória, **o gateway é single-instance**. Duas réplicas com
bucket em memória significam que cada uma concede a cota inteira: o limite efetivo
dobra. É aceitável na demo e não em produção.

## Identidade atrás de proxy

Com uma borda na frente, o endereço do socket é sempre o da borda. Sem tratar
isso, todo cliente anônimo colapsa numa identidade só e divide a mesma cota.

O AWall usa `X-Forwarded-For` quando `AWALL_TRUST_PROXY=1`, e nesse caso o
operador é responsável por garantir que a borda **sobrescreve** o header (Traefik
e nginx fazem isso por padrão quando configurados como borda real). Com
`AWALL_TRUST_PROXY=0`, o padrão, vale o endereço do socket: é o modo seguro para
exposição direta, porque `X-Forwarded-For` é um header que qualquer cliente pode
inventar.

Identidade por chave de API não depende disso, e é a identidade que importa para
quem paga.

## Se o AWall cair

Decisão de operação, não de código, e precisa ser explícita:

- **Fail-open** (recomendado para a maioria): a borda libera o tráfego quando o
  AWall não responde. A API continua no ar, a cobrança para, e o alarme dispara.
  No Traefik, isso significa remover o middleware por health check; no Envoy,
  `failure_mode_allow: true`.
- **Fail-closed**: nada passa sem decisão. Só faz sentido quando o custo de
  tráfego não cobrado é maior que o custo de indisponibilidade.

Em qualquer dos dois, pagamento parcial nunca fica pendurado: crédito só existe
após liquidação confirmada, com chave de idempotência.

## Checklist antes de colocar em produção

- [ ] Bucket em Redis; mais de uma réplica só depois disso.
- [ ] Postgres com as tabelas de `docs/04-modelo-dados.md` e backup.
- [ ] `AWALL_TRUST_PROXY` coerente com a topologia; borda sobrescrevendo `X-Forwarded-For`.
- [ ] `STELLAR_PAY_TO` apontando para conta com trustline de USDC criada.
- [ ] `stellar:pubnet` e facilitator de produção escolhidos de forma explícita — o
      facilitator público de testnet não é caminho de produção.
- [ ] Política de falha (fail-open ou fail-closed) decidida e configurada.
- [ ] Timeout do ForwardAuth menor que o timeout da borda, e requisições com
      `PAYMENT-SIGNATURE` roteadas fora dele.
- [ ] Alarme em taxa de `402`, taxa de liquidação falha e latência da decisão.
