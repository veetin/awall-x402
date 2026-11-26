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
| **Traefik** `forwardAuth` | **Sim.** Resposta não-2xx do serviço de auth é devolvida ao cliente com status, corpo e headers | Verificado em Traefik v3.2 por `./scripts/traefik-proof.sh`. O `forwardAuth` do v3 não tem limite de corpo de resposta: `maxResponseBodySize` não é campo válido e a configuração é recusada inteira se ele aparecer |
| **Envoy** `ext_authz` | **Sim.** `DeniedHttpResponse` tem `status`, `headers` e `body` | Caminho mais limpo para alto volume; use a variante gRPC |
| **nginx** `auth_request` | **Não.** Só `2xx`, `401` e `403` são respostas válidas; qualquer outro status da subrequisição é tratado como erro e o cliente recebe `500` | Dá para contornar com `auth_request_set $awall_status $upstream_status` mais `error_page`, mas o corpo e os headers da subrequisição **não** passam, então os termos de pagamento se perdem. Com nginx puro, use o Modo A, ou monte a resposta com njs/OpenResty |

### Provando o Modo B contra um Traefik de verdade

`./scripts/traefik-proof.sh` sobe o gateway e uma aplicação de eco no host,
roda Traefik v3.2 em Docker com o `deploy/traefik/dynamic.yml` deste
repositório — só o host, o endereço do gateway e o da aplicação são
substituídos — e verifica quatro coisas:

1. Requisição liberada chega na aplicação com `X-AWall-Identity`,
   `X-AWall-Cost-Credits` e `X-AWall-Reservation`. Esses headers vão na
   **requisição** que a borda encaminha, não na resposta ao cliente: é por isso
   que a prova usa uma aplicação de eco, que é a única que consegue vê-los.
2. Gasta a cota gratuita até o `402` e confere que ele chega íntegro: header
   `PAYMENT-REQUIRED` presente e `accepts` com os três itens, incluindo o
   scheme `exact`.
3. Requisição com `PAYMENT-SIGNATURE` não passa pelo ForwardAuth: o gateway
   responde pelo caminho de liquidação (`invalid_payload` para um payload
   falso), e não o `402` do ForwardAuth.
4. Rota medida: `POST /v1/completions` é estimada em 50 créditos antes da
   resposta, a aplicação reporta 17 tokens em `POST /awall/usage` com a
   reserva, o gateway cobra 17, e o segundo relatório com a mesma reserva
   responde `404`.

O script falha se o Traefik recusar a configuração, o que foi exatamente o que
aconteceu na primeira execução: `maxResponseBodySize` não existe no
`forwardAuth` do v3 e derrubava toda a configuração dinâmica.

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

`GET /awall/decide` recebe os headers originais (o Traefik envia
`X-Forwarded-Method` e `X-Forwarded-Uri`), decide, e devolve `204` ou o mesmo
`402` que o Modo A devolve. Um `PAYMENT-SIGNATURE` nesse endpoint responde
`400`: liquidar não cabe no timeout do forwardAuth. Exemplos prontos estão em
`deploy/traefik/dynamic.yml` e `deploy/envoy/envoy.yaml`.

### Rotas medidas no Modo B

Em modo decisão o AWall não vê a resposta, então o custo real precisa chegar por
outro caminho. Duas opções, em ordem de preferência:

1. A aplicação informa o consumo: `POST /awall/usage` com o id da identidade, a
   rota e a medição. Uma linha no fim do handler.
2. A borda envia o log de acesso para o AWall (Envoy ALS, ou log estruturado do
   Traefik consumido por um coletor), e o custo é cobrado em diferido.

O gateway aceita a medição em `POST /awall/usage`, autorizada pelo
`X-AWall-Reservation` devolvido no `204`.

A reserva vale 5 minutos (`RESERVATION_TTL_MS` em `apps/gateway/src/reservations.ts`).
Passado esse prazo o gateway responde `404 reservation_not_found`, igual a uma
reserva desconhecida: depois do prazo a borda não decide mais quanto a requisição
custou. O prazo também limita a memória do processo, porque uma borda que nunca
reporta deixaria a reserva viva para sempre.

## Estado, réplicas e latência

O que hoje está em memória e precisa sair de lá antes de produção:

| Estado | Hoje | Produção |
| --- | --- | --- |
| Token bucket da cota gratuita | memória do processo; Redis se `REDIS_URL` estiver definido | Redis com script Lua atômico, que grava o pool e o TTL na mesma operação (`INCRBYFLOAT` seguido de `EXPIRE` não serve: são duas) |
| Identidades e escore de abuso | Postgres | cache local de poucos segundos em cima do Postgres |
| Offers | Postgres | Postgres (schema em `docs/04-modelo-dados.md`) |
| Saldo de crédito | Postgres, com `SELECT ... FOR UPDATE` | o mesmo |

Orçamento de latência do caminho rápido (dentro da cota, sem pagamento): leitura
de bucket e decisão em um dígito de milissegundo. Isso exige o bucket em Redis na
mesma rede, não em Postgres.

Enquanto o bucket é em memória, **o gateway é single-instance**. Duas réplicas com
bucket em memória significam que cada uma concede a cota inteira: o limite efetivo
dobra. É aceitável na demo e não em produção.

### Provando que duas réplicas aplicam uma cota só

`./scripts/redis-replicas.sh` sobe Redis e Caddy em Docker, duas réplicas do
gateway em portas diferentes, e manda 400 requisições pelo balanceador em
round robin. Com `REDIS_URL` nas duas réplicas, passam 133 requisições para uma
cota de 130 créditos — a diferença é a recarga durante a corrida. O script
repete a corrida com as mesmas duas réplicas sem `REDIS_URL` e passam 278: é
assim que se sabe que a corrida anterior não passou por acaso. Ele falha se o
número com Redis subir acima de uma vez e meia a cota, ou se o controle sem
Redis não dobrar.

No fim ele roda `apps/gateway/test/redis-live.test.ts`, que só executa quando
`REDIS_TEST_URL` aponta para um Redis de verdade: duas instâncias de
`SharedQuota` contra o mesmo pool, alternadas como um balanceador, e `PTTL`
positivo na chave gravada. Sem a variável, o teste é pulado e o `pnpm test`
continua hermético.

### Tempo de vida das chaves do bucket

Toda chave do bucket expira, e a expiração é gravada dentro do mesmo `EVAL` que
lê, recarrega e gasta o pool. Não existe caminho que escreva o pool sem
lifetime: o script faz `HSET` e `PEXPIRE` na mesma execução, de modo que uma
réplica que morra entre as duas chamadas não deixa chave imortal para trás. Isso
importa num gateway público, onde cada identidade anônima que fez uma requisição
gratuita criaria uma chave permanente — crescimento de memória sem limite,
dirigido por tráfego anônimo.

O prazo não é um literal escolhido à mão: vem da janela de recarga do escopo.
A janela é `capacity / refillPerSecond`, os segundos que um pool vazio precisa
para voltar ao cheio. O lifetime é **duas** janelas, limitado ao intervalo de
**60 s a 24 h**:

- a primeira janela é o que a identidade ainda pode precisar: dentro dela o pool
  gravado ainda não voltou ao cheio, então apagá-lo devolveria cota que a
  identidade já gastou;
- a segunda é folga para um lease que foi tirado pouco antes de a identidade
  ficar quieta, para que a réplica ainda consiga confirmar ou devolver o lease
  contra o mesmo pool;
- o piso de 60 s protege escopos de janela muito curta de perder estado por
  causa de uma réplica lenta;
- o teto de 24 h existe porque `refillPerSecond = 0` nunca recarrega, e sem teto
  isso voltaria a significar "para sempre".

A expiração é deslizante — cada acesso a renova —, e sozinha isso manteria uma
identidade morta viva enquanto qualquer coisa tocasse a chave. Por isso o script
**apaga** a chave em vez de reescrevê-la quando o pool volta ao estado inicial
(sem lease pendente e com `tokens` em `capacity`): nesse ponto o pool gravado não
diz nada que um pool novo não diria, e a próxima requisição o reconstrói cheio.

Nada disso muda a resposta do gateway: cota esgotada continua respondendo `402`,
nunca `429`. Uma chave que expirou é indistinguível de uma identidade nova, que é
exatamente o comportamento desejado.

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

## Rede: testnet por default, pubnet sempre explícita

`STELLAR_NETWORK` tem default `stellar:testnet`, e nessa rede todo valor de
Stellar tem fallback de testnet: a demo roda sem nenhuma configuração. Em
`stellar:pubnet` não existe default seguro, e o gateway **recusa subir** em vez
de cair para um valor de testnet.

Três variáveis não têm default em pubnet:

| Variável | Por que não tem default |
| --- | --- |
| `STELLAR_ASSET` | o contrato USDC de testnet não existe em pubnet. Com o default, o gateway cotaria um ativo inexistente e o cliente real pagaria no vazio |
| `STELLAR_PAY_TO` | conta que recebe, com trustline de USDC já criada. Vazio significa anunciar um recebedor vazio |
| `X402_FACILITATOR_URL` | `https://www.x402.org/facilitator` é serviço de testnet, não caminho de produção |

Faltando qualquer uma delas, `readConfig` lança `GatewayConfigError`, o processo
escreve a lista das variáveis faltantes em `stderr` e sai com código 1. A
mensagem nomeia cada variável; não há modo degradado.

`STELLAR_XLM_ASSET` é o caso oposto e continua com default: os dois SACs nativos
(`CDLZFC3S…` em testnet, `CAS3J7GY…` em pubnet) são contratos reais e conhecidos,
então o default acompanha a rede em vez de exigir configuração.

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

- [ ] Bucket em Redis; mais de uma réplica só depois disso. Confira que `PTTL`
      de uma chave `awall:bucket:*` ativa devolve um prazo, nunca `-1`.
- [ ] Postgres com as tabelas de `docs/04-modelo-dados.md` e backup.
- [ ] `AWALL_TRUST_PROXY` coerente com a topologia; borda sobrescrevendo `X-Forwarded-For`.
- [ ] `STELLAR_PAY_TO` apontando para conta com trustline de USDC criada.
- [ ] `STELLAR_ASSET` com o contrato USDC de pubnet; o de testnet não existe lá.
- [ ] `stellar:pubnet` e facilitator de produção escolhidos de forma explícita — o
      facilitator público de testnet não é caminho de produção.
- [ ] Subida testada com a configuração real: sem as três variáveis acima o
      gateway sai com código 1 nomeando o que falta.
- [ ] Política de falha (fail-open ou fail-closed) decidida e configurada.
- [ ] Timeout do ForwardAuth menor que o timeout da borda, e requisições com
      `PAYMENT-SIGNATURE` roteadas fora dele.
- [ ] Alarme em taxa de `402`, taxa de liquidação falha e latência da decisão.
