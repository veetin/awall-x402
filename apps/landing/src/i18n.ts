export type Lang = "pt" | "en";

export const REPO_URL = "https://github.com/veetin/awall-x402";
export const CONSOLE_URL =
  typeof import.meta.env.VITE_CONSOLE_URL === "string" && import.meta.env.VITE_CONSOLE_URL.length > 0
    ? import.meta.env.VITE_CONSOLE_URL
    : "http://localhost:4179";

export const STELLAR_TX_URL =
  "https://stellar.expert/explorer/testnet/tx/1193d51bc83e0831e775b3f7fd13049f21f1868364008e905540be56375a048d";

export type Copy = {
  metaTitle: string;
  nav: {
    rails: string;
    architecture: string;
    pricing: string;
    quickstart: string;
    consolePreview: string;
    console: string;
    github: string;
  };
  hero: {
    kicker: string;
    title: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
    ctaConsole: string;
    meta: { label: string; value: string }[];
    terminal: {
      tabAwall: string;
      tabLegacy: string;
      captionAwall: string;
      captionLegacy: string;
    };
  };
  thesis: {
    kicker: string;
    title: string;
    subtitle: string;
    items: { index: string; title: string; body: string }[];
  };
  rails: {
    kicker: string;
    title: string;
    subtitle: string;
    tabM2m: string;
    tabPix: string;
    tabFull: string;
    m2m: {
      title: string;
      summary: string;
      steps: { step: string; title: string; detail: string }[];
      specs: { label: string; value: string }[];
      snippetTitle: string;
    };
    pix: {
      title: string;
      summary: string;
      steps: { step: string; title: string; detail: string }[];
      specs: { label: string; value: string }[];
      snippetTitle: string;
    };
    full: {
      title: string;
      summary: string;
      notes: string[];
      snippetTitle: string;
    };
  };
  architecture: {
    kicker: string;
    title: string;
    subtitle: string;
    diagram: {
      clientsTitle: string;
      clients: string[];
      gatewayTitle: string;
      gatewaySteps: string[];
      backendsTitle: string;
      backends: string[];
    };
    stages: { num: string; name: string; pkg: string; desc: string }[];
    yamlDesc: string;
    guaranteesTitle: string;
    guarantees: { rule: string; detail: string }[];
  };
  abusePricing: {
    kicker: string;
    title: string;
    subtitle: string;
    presetsLabel: string;
    presets: { id: "clean" | "retry" | "scraper"; label: string }[];
    signals: {
      burst: { label: string; desc: string };
      identical: { label: string; desc: string };
      errors: { label: string; desc: string };
      cache: { label: string; desc: string };
    };
    tableTitle: string;
    formulaNote: string;
    warmupNote: string;
    cols: {
      rail: string;
      asset: string;
      display: string;
      wire: string;
    };
    labels: {
      score: string;
      multiplier: string;
      pack: string;
      creditsUnit: string;
    };
  };
  quickstart: {
    kicker: string;
    title: string;
    subtitle: string;
    copyLabel: string;
    copiedLabel: string;
    tabs: { id: string; label: string; desc: string; cmd: string }[];
  };
  footer: {
    summary: string;
    meta: string;
    appsTitle: string;
    apps: { label: string; href: string }[];
    docsTitle: string;
    docs: { label: string; href: string }[];
  };
};

export const COPY: Record<Lang, Copy> = {
  pt: {
    metaTitle: "AWall — Gateway x402 no lugar do 429 Too Many Requests",
    nav: {
      rails: "Trilhos 402",
      architecture: "Arquitetura",
      pricing: "Preço dinâmico",
      quickstart: "Rodar local",
      consolePreview: "Prévia Console",
      console: "Console",
      github: "GitHub",
    },
    hero: {
      kicker: "Hack Brasil 2026 · Pagamentos e finanças · x402 v2",
      title: "402 Payment Required no lugar do 429.",
      subtitle:
        "AWall é um gateway reverse proxy que preserva a cota gratuita da sua API e cobra apenas o excedente via protocolo x402. Agentes autônomos liquidam em USDC ou XLM na Stellar com taxa patrocinada; agentes com humano no circuito pagam por Pix — tudo na mesma resposta HTTP.",
      ctaPrimary: "Explorar fluxo 402",
      ctaSecondary: "Rodar localmente",
      ctaConsole: "Abrir Console",
      meta: [
        { label: "Protocolo", value: "x402 v2 · HTTP" },
        { label: "Trilho M2M", value: "Stellar USDC & XLM (7 dec)" },
        { label: "Trilho Assistido", value: "scheme pix · AbacatePay" },
        { label: "Contabilização", value: "Pacotes de créditos + Postgres" },
      ],
      terminal: {
        tabAwall: "awall-gateway (:8402)",
        tabLegacy: "rate-limit-tradicional",
        captionAwall: "Cota gratuita acabou: responde 402 com termos, liquida e entrega 200 OK.",
        captionLegacy: "Cota acabou: responde 429 e descarta um cliente disposto a pagar.",
      },
    },
    thesis: {
      kicker: "01 / A tese",
      title: "Capacidade de API como mercado, não como muro.",
      subtitle:
        "Agentes de IA iteram, varrem paginações e repetem chamadas quando o raciocínio muda. Responder 429 trava o cliente legítimo enquanto o servidor já gastou infraestrutura recusando a requisição.",
      items: [
        {
          index: "01",
          title: "Zero alteração na origin",
          body: "Roda na frente de qualquer API HTTP como reverse proxy standalone (Hono) ou em modo decisão ForwardAuth atrás de Traefik v3.2 e Envoy v1.32.",
        },
        {
          index: "02",
          title: "Pacote de créditos, não por request",
          body: "O pagamento compra 10.000 créditos no ledger Postgres. O consumo acontece off-chain por rota ou medição, evitando milhares de liquidações on-chain e viabilizando Pix.",
        },
        {
          index: "03",
          title: "Falha 5xx estorna automaticamente",
          body: "Se a API de destino responder 5xx ou timeout, os créditos debitados voltam para o bucket ou ledger na mesma hora. O cliente não paga por erro do servidor.",
        },
      ],
    },
    rails: {
      kicker: "02 / Trilhos de pagamento",
      title: "Um header PAYMENT-REQUIRED, duas jornadas de liquidação.",
      subtitle:
        "O array accepts liga uma mesma offer no banco a clientes autônomos e humanos. Qualquer um dos trilhos que liquidar credita o mesmo saldo na identidade.",
      tabM2m: "Agente autônomo · Stellar",
      tabPix: "Agente assistido · Pix",
      tabFull: "Payload 402 completo",
      m2m: {
        title: "Liquidação exact na Stellar sem token de gas",
        summary:
          "O agente lê o header PAYMENT-REQUIRED, assina apenas as auth entries da invocação Soroban (SEP-41) e repete a requisição com PAYMENT-SIGNATURE.",
        steps: [
          {
            step: "01",
            title: "Cota esgotada → 402",
            detail: "Gateway cria a offer no Postgres com preço multiplicado pelo escore de abuso e envia PAYMENT-REQUIRED em base64.",
          },
          {
            step: "02",
            title: "Assinatura das auth entries",
            detail: "O cliente (@x402/fetch + @x402/stellar) simula a transferência SAC (7 decimais) e assina só as auth entries, sem gastar sequence number.",
          },
          {
            step: "03",
            title: "Revalidação + /verify + /settle",
            detail: "O gateway revalida accepted contra a offer gravada no banco (nunca confia no cliente) e aciona o facilitator x402, que patrocina a taxa.",
          },
          {
            step: "04",
            title: "Crédito idempotente → 200 OK",
            detail: "Insere em credit_ledger com chave única tx_hash, encaminha para a origin e responde com o recibo em PAYMENT-RESPONSE.",
          },
        ],
        specs: [
          { label: "Rede", value: "stellar:testnet (pubnet via env)" },
          { label: "Decimais", value: "7 (0.50 USDC = \"5000000\")" },
          { label: "Taxa de rede", value: "areFeesSponsored: true" },
          { label: "Ativos", value: "USDC SAC + XLM nativo SAC" },
        ],
        snippetTitle: "Item exact no array accepts",
      },
      pix: {
        title: "Scheme pix especificado para x402 v2",
        summary:
          "Especificado em specs/scheme_pix.md no formato oficial do protocolo. O 402 expõe checkoutUrl e statusUrl para um humano pagar no app do banco.",
        steps: [
          {
            step: "01",
            title: "Mesma offer, cobrança BRL",
            detail: "Ao emitir a offer, o gateway registra o valor em centavos e abre a cobrança transparente na AbacatePay.",
          },
          {
            step: "02",
            title: "Checkout público (/pay/:offerId)",
            detail: "O console renderiza o QR Code direto do BR Code EMV e exibe o código copia-e-cola com fallback de clipboard.",
          },
          {
            step: "03",
            title: "Webhook é gatilho, não verdade",
            detail: "Ao receber o webhook assinado, o gateway consulta a API do provedor para confirmar status PAID antes de creditar (chave pix:<chargeId>).",
          },
          {
            step: "04",
            title: "Polling e retomada",
            detail: "O agente acompanha GET /awall/offers/:id (202 → 200) e repete a chamada original assim que o crédito cai.",
          },
        ],
        specs: [
          { label: "Scheme / Rede", value: "scheme: pix · pix:bcb" },
          { label: "Ativo / Unidade", value: "BRL em centavos (inteiro)" },
          { label: "Idempotência", value: "pix:<chargeId> (UNIQUE)" },
          { label: "Janela", value: "maxTimeoutSeconds: 900" },
        ],
        snippetTitle: "Item pix no array accepts",
      },
      full: {
        title: "Corpo e header PAYMENT-REQUIRED",
        summary:
          "O protocolo trafega em base64 no header PAYMENT-REQUIRED; o AWall repete o JSON no corpo do 402 para facilitar inspeção e clientes em depuração.",
        notes: [
          "Valores sempre em string de inteiro: 7 decimais em Stellar (\"6800000\" = 0.68 USDC) e centavos em BRL (\"394\" = R$ 3,94).",
          "O mesmo offerId amarra os 3 itens de accepts à mesma offer no Postgres.",
        ],
        snippetTitle: "402 Payment Required · body",
      },
    },
    architecture: {
      kicker: "03 / Arquitetura",
      title: "Do proxy de entrada até o ledger append-only.",
      subtitle:
        "Responsabilidades separadas em pacotes TypeScript independentes: @awall/policy, @awall/ledger, @awall/settlement e @awall/pix.",
      diagram: {
        clientsTitle: "Clientes",
        clients: ["Agente M2M (@x402/fetch)", "Agente assistido + humano", "Traefik / Envoy (ForwardAuth)"],
        gatewayTitle: "AWall Gateway (Hono · Node 24)",
        gatewaySteps: [
          "1. Identity Resolver (SHA-256 / wallet / fingerprint)",
          "2. Policy Engine (awall.yaml / rotas & custos)",
          "3. Token Bucket (memória ou Redis Lua) + credit_ledger",
          "4. Abuse Score EMA → multiplicador de preço",
          "5. Payment Orchestrator (exact + pix) & /awall/* SSE",
        ],
        backendsTitle: "Liquidação & Estado",
        backends: ["Origin API (sem alteração)", "x402 Facilitator (Stellar Soroban)", "AbacatePay (Pix) + Postgres"],
      },
      stages: [
        {
          num: "01",
          name: "Identity Resolver",
          pkg: "apps/gateway",
          desc: "Precedência fixa: hash SHA-256 da API key → carteira Stellar pagadora → assinatura de agente → fingerprint (IP + ASN + User-Agent).",
        },
        {
          num: "02",
          name: "Policy Engine",
          pkg: "@awall/policy",
          desc: "Define custo em créditos por rota, rotas isentas (free: true), cota isolada por rota, rotas medidas (metered: true) e unmatched: deny.",
        },
        {
          num: "03",
          name: "Token Bucket & Ledger",
          pkg: "@awall/policy · @awall/ledger",
          desc: "Gasta primeiro a cota gratuita (in-process ou Redis Lua entre réplicas). Sem cota, debita credit_balance junto com credit_ledger.",
        },
        {
          num: "04",
          name: "Abuse Score",
          pkg: "@awall/policy",
          desc: "Média móvel exponencial (alpha 0.35) em 4 sinais ajusta o preço até max_multiplier, preservando as primeiras 8 requisições.",
        },
        {
          num: "05",
          name: "Payment Orchestrator",
          pkg: "@awall/settlement · @awall/pix",
          desc: "Revalida accepted contra o banco, liquida exact no facilitator x402 ou reconcilia cobrança Pix via webhook + API do provedor.",
        },
        {
          num: "06",
          name: "Control Plane & Console",
          pkg: "apps/gateway · apps/console",
          desc: "Prefixo reservado /awall (nunca vai à origin) expõe SSE ao vivo, receita por ativo, auditoria de offers e edição de política.",
        },
      ],
      yamlDesc: "Política declarativa carregada no boot e atualizável pelo plano de controle.",
      guaranteesTitle: "Invariantes que não quebram",
      guarantees: [
        {
          rule: "Dinheiro nunca é float",
          detail: "Toda quantia usa bigint ou string de inteiro (7 decimais em Stellar, centavos em BRL).",
        },
        {
          rule: "Cliente não define preço",
          detail: "O objeto accepted do PAYMENT-SIGNATURE é conferido campo a campo contra a offer no Postgres.",
        },
        {
          rule: "Ledger append-only",
          detail: "Nenhum caminho altera identities.credit_balance sem gravar credit_ledger na mesma transação SQL.",
        },
        {
          rule: "Idempotência obrigatória",
          detail: "Constraint UNIQUE em tx_hash (Stellar) e pix:<chargeId> (Pix) impede crédito duplicado.",
        },
      ],
    },
    abusePricing: {
      kicker: "04 / Precificação comportamental",
      title: "Tráfego bem comportado paga barato. Abuso financia a infraestrutura.",
      subtitle:
        "Simulador conectado à mesma fórmula de packages/policy/src/price.ts sobre os parâmetros de awall.yaml (pacote de 10.000 créditos, teto 3.0×).",
      presetsLabel: "Perfis:",
      presets: [
        { id: "clean", label: "Comportado (1.00×)" },
        { id: "retry", label: "Retentativas (1.36×)" },
        { id: "scraper", label: "Scraper abusivo (3.00×)" },
      ],
      signals: {
        burst: {
          label: "Burstiness",
          desc: "Queda súbita no intervalo entre requisições frente à média móvel (ou < 80 ms).",
        },
        identical: {
          label: "Duplicate ratio",
          desc: "Repetição consecutiva do mesmo hash SHA-256 de método + caminho + query + corpo.",
        },
        errors: {
          label: "Error ratio (4xx)",
          desc: "Proporção de respostas 4xx causadas por chamadas inválidas na origin.",
        },
        cache: {
          label: "Cache-miss bypass",
          desc: "Uso explícito de Cache-Control: no-cache / no-store ou Pragma: no-cache.",
        },
      },
      tableTitle: "Cotação calculada para a próxima offer",
      formulaNote:
        "score = média dos 4 sinais; multiplier = 1 + (max_multiplier − 1) × score. Multiplicação aplicada em basis points sobre inteiros.",
      warmupNote:
        "Carência inicial: identidades novas têm samples < 8 ignorado para que esgotar a cota gratuita não eleve o preço.",
      cols: {
        rail: "Trilho",
        asset: "Ativo",
        display: "Valor legível",
        wire: "Valor exato no 402",
      },
      labels: {
        score: "Abuse score",
        multiplier: "Multiplicador",
        pack: "Pacote",
        creditsUnit: "créditos",
      },
    },
    quickstart: {
      kicker: "05 / Rodar local",
      title: "Suba o gateway e veja o 402 em menos de um minuto.",
      subtitle:
        "Sem DATABASE_URL o gateway sobe um Postgres embutido automaticamente; com Docker Compose sobe o stack completo atrás do Caddy.",
      copyLabel: "Copiar",
      copiedLabel: "Copiado",
      tabs: [
        {
          id: "dev",
          label: "Desenvolvimento",
          desc: "Gateway (:8402), origin-demo (:8787), console (:4179) e landing (:4180) em paralelo.",
          cmd: "corepack enable pnpm\npnpm install\npnpm dev",
        },
        {
          id: "curl",
          label: "Testar 402 + demo.sh",
          desc: "Consuma a cota de 100 créditos em awall.yaml ou execute o roteiro ponta a ponta.",
          cmd: 'curl -i -H "x-api-key: demo" "http://localhost:8402/v1/search?q=camera"\n\n# Fluxo completo (cota gratuita -> 402 -> offer -> estorno 5xx):\n./scripts/demo.sh',
        },
        {
          id: "docker",
          label: "Docker + Caddy",
          desc: "Postgres, origin, gateway, console e Caddy (HTTPS automático com AWALL_DOMAIN).",
          cmd: "cd deploy\nAWALL_ADMIN_TOKEN=local-token docker compose up -d --build",
        },
      ],
    },
    footer: {
      summary: "Gateway reverse proxy x402 para transformar rate limit em receita atribuível.",
      meta: "Hack Brasil 2026 · Trilha Pagamentos e finanças · Licença MIT",
      appsTitle: "Aplicações",
      apps: [
        { label: "Console do Operador", href: CONSOLE_URL },
        { label: "Repositório GitHub", href: REPO_URL },
        { label: "Tx Stellar Testnet", href: STELLAR_TX_URL },
      ],
      docsTitle: "Documentação",
      docs: [
        { label: "specs/scheme_pix.md", href: `${REPO_URL}/blob/main/specs/scheme_pix.md` },
        { label: "docs/02-arquitetura.md", href: `${REPO_URL}/blob/main/docs/02-arquitetura.md` },
        { label: "docs/03-protocolo.md", href: `${REPO_URL}/blob/main/docs/03-protocolo.md` },
        { label: "docs/08-dashboard.md", href: `${REPO_URL}/blob/main/docs/08-dashboard.md` },
      ],
    },
  },
  en: {
    metaTitle: "AWall — x402 Gateway replacing 429 Too Many Requests",
    nav: {
      rails: "402 Rails",
      architecture: "Architecture",
      pricing: "Dynamic pricing",
      quickstart: "Quickstart",
      consolePreview: "Console Preview",
      console: "Console",
      github: "GitHub",
    },
    hero: {
      kicker: "Hack Brasil 2026 · Payments & Finance · x402 v2",
      title: "402 Payment Required instead of 429.",
      subtitle:
        "AWall is a reverse proxy gateway that preserves your API's free tier and turns overage traffic into attributable revenue via x402. Autonomous agents settle in Stellar USDC or XLM with sponsored fees; human-assisted agents pay via Pix — both inside the same HTTP 402.",
      ctaPrimary: "Explore 402 flow",
      ctaSecondary: "Run locally",
      ctaConsole: "Open Console",
      meta: [
        { label: "Protocol", value: "x402 v2 · HTTP" },
        { label: "M2M Rail", value: "Stellar USDC & XLM (7 dec)" },
        { label: "Assisted Rail", value: "scheme pix · AbacatePay" },
        { label: "Accounting", value: "Credit packs + Postgres" },
      ],
      terminal: {
        tabAwall: "awall-gateway (:8402)",
        tabLegacy: "traditional-rate-limit",
        captionAwall: "Free quota spent: returns 402 with terms, settles, and serves 200 OK.",
        captionLegacy: "Quota spent: returns 429 and blocks a client willing to pay.",
      },
    },
    thesis: {
      kicker: "01 / Thesis",
      title: "API capacity as a market, not a wall.",
      subtitle:
        "AI agents iterate, crawl full pagination, and retry calls whenever reasoning changes. Returning 429 stalls legitimate callers after your origin has already spent resources rejecting them.",
      items: [
        {
          index: "01",
          title: "Zero changes in origin",
          body: "Runs in front of any HTTP API as a standalone reverse proxy (Hono) or in ForwardAuth decision mode behind Traefik v3.2 and Envoy v1.32.",
        },
        {
          index: "02",
          title: "Credit packs, not per-request",
          body: "Settlement buys a 10,000-credit pack in Postgres. Requests spend off-chain per route or metered usage, avoiding per-call on-chain latency and making Pix practical.",
        },
        {
          index: "03",
          title: "Automatic 5xx refund",
          body: "If the upstream origin fails with 5xx or times out, reserved credits are automatically refunded back to the bucket or ledger. Callers never pay for server errors.",
        },
      ],
    },
    rails: {
      kicker: "02 / Payment rails",
      title: "One PAYMENT-REQUIRED header, two settlement journeys.",
      subtitle:
        "The accepts array links a single Postgres offer to both autonomous wallets and human operators. Whichever rail settles credits the exact same identity balance.",
      tabM2m: "Autonomous agent · Stellar",
      tabPix: "Assisted agent · Pix",
      tabFull: "Full 402 payload",
      m2m: {
        title: "Stellar exact settlement with zero gas tokens",
        summary:
          "The agent reads PAYMENT-REQUIRED, signs only the Soroban SEP-41 auth entries, and retries with PAYMENT-SIGNATURE.",
        steps: [
          {
            step: "01",
            title: "Quota exhausted → 402",
            detail: "Gateway creates a Postgres offer scaled by the identity's abuse multiplier and sends base64 PAYMENT-REQUIRED.",
          },
          {
            step: "02",
            title: "Sign Soroban auth entries",
            detail: "Client (@x402/fetch + @x402/stellar) simulates the SAC transfer (7 decimals) and signs auth entries only — no sequence number spent.",
          },
          {
            step: "03",
            title: "Revalidate + /verify + /settle",
            detail: "Gateway checks accepted against the stored offer (never trusting client amounts) and calls the x402 facilitator, which sponsors network fees.",
          },
          {
            step: "04",
            title: "Idempotent credit → 200 OK",
            detail: "Inserts into credit_ledger with unique tx_hash, proxies to origin, and returns the settlement receipt in PAYMENT-RESPONSE.",
          },
        ],
        specs: [
          { label: "Network", value: "stellar:testnet (pubnet via env)" },
          { label: "Decimals", value: "7 (0.50 USDC = \"5000000\")" },
          { label: "Fee model", value: "areFeesSponsored: true" },
          { label: "Assets", value: "USDC SAC + native XLM SAC" },
        ],
        snippetTitle: "exact entry inside accepts",
      },
      pix: {
        title: "First-class pix scheme for x402 v2",
        summary:
          "Specified in specs/scheme_pix.md following the official protocol template. The 402 embeds checkoutUrl and statusUrl so a human can settle via banking app.",
        steps: [
          {
            step: "01",
            title: "Same offer, BRL charge",
            detail: "When minting the offer, the gateway stores the centavos price and creates a transparent Pix charge via AbacatePay.",
          },
          {
            step: "02",
            title: "Public checkout (/pay/:offerId)",
            detail: "Console renders the QR directly from the EMV BR Code alongside a copy-paste button with clipboard fallback.",
          },
          {
            step: "03",
            title: "Webhook triggers lookup",
            detail: "After verifying the webhook signature, the gateway queries the provider API to confirm PAID before crediting (key pix:<chargeId>).",
          },
          {
            step: "04",
            title: "Poll and resume",
            detail: "The agent polls GET /awall/offers/:id (202 → 200) and replays the original request as soon as credits land.",
          },
        ],
        specs: [
          { label: "Scheme / Network", value: "scheme: pix · pix:bcb" },
          { label: "Asset / Unit", value: "BRL in integer centavos" },
          { label: "Idempotency", value: "pix:<chargeId> (UNIQUE)" },
          { label: "Window", value: "maxTimeoutSeconds: 900" },
        ],
        snippetTitle: "pix entry inside accepts",
      },
      full: {
        title: "PAYMENT-REQUIRED header and body",
        summary:
          "The wire protocol rides as base64 in PAYMENT-REQUIRED; AWall mirrors the JSON in the 402 response body for inspection and debugging.",
        notes: [
          "Amounts are always integer strings: 7 decimals on Stellar (\"6800000\" = 0.68 USDC) and centavos on BRL (\"394\" = R$ 3.94).",
          "One offerId binds all 3 accepts items to the same offer row in Postgres.",
        ],
        snippetTitle: "402 Payment Required · body",
      },
    },
    architecture: {
      kicker: "03 / Architecture",
      title: "From reverse proxy edge to append-only ledger.",
      subtitle:
        "Clear package boundaries across @awall/policy, @awall/ledger, @awall/settlement, and @awall/pix.",
      diagram: {
        clientsTitle: "Clients",
        clients: ["M2M Agent (@x402/fetch)", "Assisted Agent + Human", "Traefik / Envoy (ForwardAuth)"],
        gatewayTitle: "AWall Gateway (Hono · Node 24)",
        gatewaySteps: [
          "1. Identity Resolver (SHA-256 / wallet / fingerprint)",
          "2. Policy Engine (awall.yaml / routes & weights)",
          "3. Token Bucket (memory or Redis Lua) + credit_ledger",
          "4. Abuse Score EMA → price multiplier",
          "5. Payment Orchestrator (exact + pix) & /awall/* SSE",
        ],
        backendsTitle: "Settlement & State",
        backends: ["Origin API (unmodified)", "x402 Facilitator (Stellar Soroban)", "AbacatePay (Pix) + Postgres"],
      },
      stages: [
        {
          num: "01",
          name: "Identity Resolver",
          pkg: "apps/gateway",
          desc: "Strict precedence: API key SHA-256 hash → known Stellar payer wallet → signed agent identity → IP + ASN + User-Agent fingerprint.",
        },
        {
          num: "02",
          name: "Policy Engine",
          pkg: "@awall/policy",
          desc: "Defines per-route credit cost, free: true exemptions, isolated per-route free_tier, metered routes, and unmatched: deny.",
        },
        {
          num: "03",
          name: "Token Bucket & Ledger",
          pkg: "@awall/policy · @awall/ledger",
          desc: "Consumes free quota first (in-process or atomic Redis Lua across replicas). Above quota, debits credit_balance with a credit_ledger row.",
        },
        {
          num: "04",
          name: "Abuse Score",
          pkg: "@awall/policy",
          desc: "Exponential moving average (alpha 0.35) over 4 behavioral signals adjusts price up to max_multiplier after an 8-request warmup.",
        },
        {
          num: "05",
          name: "Payment Orchestrator",
          pkg: "@awall/settlement · @awall/pix",
          desc: "Revalidates accepted against Postgres, settles exact via x402 facilitator, or confirms Pix via webhook + provider API lookup.",
        },
        {
          num: "06",
          name: "Control Plane & Console",
          pkg: "apps/gateway · apps/console",
          desc: "Reserved /awall prefix (never proxied to origin) exposes live SSE stream, per-asset revenue, offer audit, and policy management.",
        },
      ],
      yamlDesc: "Declarative policy loaded at boot and updatable through the control plane.",
      guaranteesTitle: "Hard engineering invariants",
      guarantees: [
        {
          rule: "Money is never a float",
          detail: "All amounts use bigint or integer strings (7 Stellar decimals, integer BRL centavos).",
        },
        {
          rule: "Clients never dictate price",
          detail: "The accepted field in PAYMENT-SIGNATURE is checked field by field against the Postgres offer.",
        },
        {
          rule: "Append-only ledger",
          detail: "No code path mutates identities.credit_balance without inserting a matching credit_ledger row in the same SQL transaction.",
        },
        {
          rule: "Strict idempotency",
          detail: "UNIQUE constraint on tx_hash (Stellar) and pix:<chargeId> (Pix) prevents double-crediting.",
        },
      ],
    },
    abusePricing: {
      kicker: "04 / Behavioral pricing",
      title: "Well-behaved traffic pays base rate. Abuse funds infrastructure.",
      subtitle:
        "Interactive quote using the exact basis-point math from packages/policy/src/price.ts over awall.yaml defaults (10,000-credit pack, 3.0× cap).",
      presetsLabel: "Profiles:",
      presets: [
        { id: "clean", label: "Clean (1.00×)" },
        { id: "retry", label: "Retrying (1.36×)" },
        { id: "scraper", label: "Abusive (3.00×)" },
      ],
      signals: {
        burst: {
          label: "Burstiness",
          desc: "Sharp drop in inter-request interval vs. identity EMA interval (or < 80 ms).",
        },
        identical: {
          label: "Duplicate ratio",
          desc: "Consecutive requests sharing identical method + path + query + body SHA-256 hash.",
        },
        errors: {
          label: "Error ratio (4xx)",
          desc: "Share of 4xx responses triggered by malformed client calls against origin.",
        },
        cache: {
          label: "Cache-miss bypass",
          desc: "Explicit Cache-Control: no-cache / no-store or Pragma: no-cache headers.",
        },
      },
      tableTitle: "Calculated quote for the next offer",
      formulaNote:
        "score = mean of 4 signals; multiplier = 1 + (max_multiplier − 1) × score. Applied via integer basis points.",
      warmupNote:
        "Warmup window: new identities with samples < 8 ignore abuse score so exhausting a free tier never raises price.",
      cols: {
        rail: "Rail",
        asset: "Asset",
        display: "Human display",
        wire: "Exact 402 wire amount",
      },
      labels: {
        score: "Abuse score",
        multiplier: "Multiplier",
        pack: "Pack",
        creditsUnit: "credits",
      },
    },
    quickstart: {
      kicker: "05 / Run locally",
      title: "Boot the gateway and trigger a 402 in under a minute.",
      subtitle:
        "Without DATABASE_URL the gateway starts an embedded Postgres automatically; Docker Compose runs the full stack behind Caddy.",
      copyLabel: "Copy",
      copiedLabel: "Copied",
      tabs: [
        {
          id: "dev",
          label: "Development",
          desc: "Starts gateway (:8402), origin-demo (:8787), console (:4179), and landing (:4180) in parallel.",
          cmd: "corepack enable pnpm\npnpm install\npnpm dev",
        },
        {
          id: "curl",
          label: "Trigger 402 + demo.sh",
          desc: "Spend the 100-credit free tier in awall.yaml or run the automated end-to-end verification script.",
          cmd: 'curl -i -H "x-api-key: demo" "http://localhost:8402/v1/search?q=camera"\n\n# Full E2E flow (free quota -> 402 -> offer -> 5xx refund):\n./scripts/demo.sh',
        },
        {
          id: "docker",
          label: "Docker + Caddy",
          desc: "Postgres, origin, gateway, console, and Caddy (automatic HTTPS when AWALL_DOMAIN is set).",
          cmd: "cd deploy\nAWALL_ADMIN_TOKEN=local-token docker compose up -d --build",
        },
      ],
    },
    footer: {
      summary: "x402 reverse proxy gateway turning rate limits into attributable revenue.",
      meta: "Hack Brasil 2026 · Payments & Finance · MIT License",
      appsTitle: "Applications",
      apps: [
        { label: "Operator Console", href: CONSOLE_URL },
        { label: "GitHub Repository", href: REPO_URL },
        { label: "Stellar Testnet Tx", href: STELLAR_TX_URL },
      ],
      docsTitle: "Documentation",
      docs: [
        { label: "specs/scheme_pix.md", href: `${REPO_URL}/blob/main/specs/scheme_pix.md` },
        { label: "docs/02-arquitetura.md", href: `${REPO_URL}/blob/main/docs/02-arquitetura.md` },
        { label: "docs/03-protocolo.md", href: `${REPO_URL}/blob/main/docs/03-protocolo.md` },
        { label: "docs/08-dashboard.md", href: `${REPO_URL}/blob/main/docs/08-dashboard.md` },
      ],
    },
  },
};

export const SNIPPET_EXACT_STELLAR = `{
  "scheme": "exact",
  "network": "stellar:testnet",
  "amount": "6800000",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "payTo": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
  "maxTimeoutSeconds": 60,
  "extra": {
    "areFeesSponsored": true,
    "packCredits": 10000,
    "offerId": "ofr_01JDX7...",
    "assetCode": "USDC"
  }
}`;

export const SNIPPET_PIX = `{
  "scheme": "pix",
  "network": "pix:bcb",
  "amount": "394",
  "asset": "BRL",
  "payTo": "merchant",
  "maxTimeoutSeconds": 900,
  "extra": {
    "assetTransferMethod": "pixCharge",
    "paymentFlow": "upfront",
    "chargeId": "ofr_01JDX7...",
    "checkoutUrl": "https://awall.demo/pay/ofr_01JDX7...",
    "statusUrl": "https://api.awall.demo/awall/offers/ofr_01JDX7...",
    "packCredits": 10000,
    "offerId": "ofr_01JDX7..."
  }
}`;

export const SAMPLE_402_JSON = `{
  "x402Version": 2,
  "error": "Free quota exhausted. Pay to continue.",
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "6800000",
      "asset": "CBIELTK6...MXQDAMA",
      "extra": { "assetCode": "USDC", "areFeesSponsored": true, "offerId": "ofr_01JDX7..." }
    },
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "68000000",
      "asset": "CDLZFC3S...HHGCYSC",
      "extra": { "assetCode": "XLM", "areFeesSponsored": true, "offerId": "ofr_01JDX7..." }
    },
    {
      "scheme": "pix",
      "network": "pix:bcb",
      "amount": "394",
      "asset": "BRL",
      "payTo": "merchant",
      "extra": { "checkoutUrl": "https://awall.demo/pay/ofr_01JDX7...", "offerId": "ofr_01JDX7..." }
    }
  ]
}`;

export const SAMPLE_AWALL_YAML = `origin: http://localhost:8787

defaults:
  unmatched: deny
  credits: 1

free_tier:
  window_seconds: 60
  credits: 100
  burst: 30

pricing:
  pack_credits: 10000
  price_usdc: "0.50"
  price_xlm: "5.00"
  price_brl_cents: 290
  max_multiplier: 3.0

routes:
  - match: "GET /v1/health"
    free: true
  - match: "GET /v1/search"
    credits: 1
  - match: "POST /v1/completions"
    credits: 50
    metered: true
  - match: "GET /v1/reports/*"
    credits: 20
    free_tier:
      window_seconds: 3600
      credits: 100`;

export function initialLang(): Lang {
  if (typeof window === "undefined") return "pt";
  try {
    const saved = window.localStorage.getItem("awall_landing_lang");
    if (saved === "pt" || saved === "en") return saved;
  } catch {
    // Ignore storage access failures in restricted browsing contexts.
  }
  return navigator.language.toLowerCase().startsWith("en") ? "en" : "pt";
}
