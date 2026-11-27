# Deploy

The stack in `docker-compose.yml` is the deploy shape: Postgres, the protected
application, the gateway, the console and Caddy in front of all of it. One
image (`Dockerfile`) runs every Node process; compose overrides the command per
service.

Nothing here holds a secret. Every value comes from the environment, and
`.env.example` at the repository root lists the names.

## Local run

```bash
cd deploy
AWALL_ADMIN_TOKEN=local-token docker compose up -d --build
```

Then, on `http://localhost`:

| What | Check |
| --- | --- |
| protected API | `curl -H "Authorization: Bearer k" "http://localhost/v1/search?q=x"` answers `200`, and `402` once the free quota is gone |
| control plane | `curl http://localhost/awall/stats/summary` answers `401`; with `Authorization: Bearer local-token` it answers `200` |
| console | `http://localhost/` serves the dashboard |
| console login | `http://localhost/login` asks for a username and a password |
| checkout | `http://localhost/pay/<offerId>` serves the console |
| persistence | an offer read with `GET /awall/offers/<id>` still answers `202` after `docker compose restart gateway` |

Those were run on this stack before this file was written. The gateway
logs `"database":"postgres"` and `"origin":"http://origin:8787"` at boot, which
is how you know it is not on PGlite and not pointed at the policy file's
localhost.

## First console user

Nobody can sign in until a user exists. The gateway service already holds
`DATABASE_URL`, so create it there:

```bash
cd deploy
docker compose exec gateway pnpm --filter @awall/gateway create-user ada
```

It asks for the password on standard input and refuses to take one as an
argument: an argument would land in the shell history and in the process list.
`AWALL_ADMIN_TOKEN` keeps working for the `curl` checks above, which is why the
examples in this file are unchanged.

## Public host with HTTPS

Point the DNS record at the machine, open 80 and 443, and set the domain:

```bash
cd deploy
export AWALL_DOMAIN=awall.example.com
export AWALL_ADMIN_TOKEN=...            # long random value
export AWALL_PUBLIC_BASE_URL=https://awall.example.com
export AWALL_CHECKOUT_BASE_URL=https://awall.example.com
export AWALL_CONSOLE_ORIGIN=https://awall.example.com
export VITE_AWALL_URL=https://awall.example.com
export STELLAR_PAY_TO=G...              # receiving account
docker compose up -d --build
```

Caddy obtains and renews the certificate on its own, because `AWALL_DOMAIN`
becomes the site address in the `Caddyfile`. Without it the site address is
`:80`, which is the local shape above. Port 80 has to stay reachable: that is
where the ACME challenge lands.

`AWALL_TRUST_PROXY=1` is already set for the gateway in compose, because Caddy
is the only thing in front of it and it is the one setting
`X-Forwarded-For`. Do not set it when something untrusted can reach the
gateway directly.

## Demo login for a hackathon

A judge opening the console should not need a password. Create a throwaway
user, then build the console with its credentials:

```bash
docker compose exec gateway pnpm --filter @awall/gateway create-user demo
export VITE_DEMO_USERNAME=demo
export VITE_DEMO_PASSWORD=...           # the one you just typed
docker compose up -d --build console
```

The login form then opens filled in and "Entrar" is one click. The values are
compiled into the public bundle, so anyone with the URL can sign in and use
the control plane, including editing the policy. Use it on a testnet deployment
with nothing real behind it, and take the two variables out (rebuild the
console) when the demo is over.

## Before calling it production

Read the checklist in `../docs/07-producao.md`. The items that bite first:

- **`DATABASE_URL`**: compose points at its own Postgres. A managed database is
  a URL change and nothing else; migrations run at boot.
- **`STELLAR_NETWORK=stellar:pubnet`**: the gateway then refuses to start
  unless `STELLAR_ASSET`, `STELLAR_PAY_TO` and `X402_FACILITATOR_URL` are set,
  because every remaining default is a testnet value.
- **Receiving account**: it needs the USDC trustline before anything settles,
  or settlement fails on the gateway's side.
- **`REDIS_URL`**: required before a second replica. Without it each replica
  grants the whole free quota; `../scripts/redis-replicas.sh` demonstrates
  both halves of that.
- **Admin token**: the control plane answers `401` for every route, read
  routes included, without it. There is no default.
- **The demo origin**: `origin` in compose is a stand-in. Point `AWALL_ORIGIN`
  at the real application and remove the service.

## Replacing the application

`AWALL_ORIGIN` overrides `origin` in `awall.yaml`, so one policy file works in
development and in a deployment. The policy file names `http://localhost:8787`,
which is correct on a laptop and wrong inside any container network.
