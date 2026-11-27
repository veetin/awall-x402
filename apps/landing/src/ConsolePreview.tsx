import { useMemo, useState } from "react";
import { CodeBlock } from "./CodeBlock.js";
import type { Lang } from "./i18n.js";

type ConsoleTab =
  | "live"
  | "requests"
  | "revenue"
  | "identities"
  | "identity"
  | "payments"
  | "policy"
  | "health";

type MockEvent = {
  id: string;
  at: string;
  identityId: string;
  type: "request" | "payment";
  route?: string;
  decision?: "allow_free" | "allow_credit" | "payment_required" | "refunded";
  rail?: string;
  credits: string;
  originStatus: string;
  latencyMs: string;
};

type MockIdentity = {
  id: string;
  kind: "api_key" | "wallet" | "fingerprint";
  creditBalance: string;
  abuseScore: number;
  multiplier: number;
  lastSeenAt: string;
  ledger: { createdAt: string; reason: string; deltaCredits: number }[];
};

const INITIAL_EVENTS: MockEvent[] = [
  {
    id: "evt-1",
    at: "00:42:18",
    identityId: "idt_k_2a97516c",
    type: "request",
    route: "GET /v1/search",
    decision: "allow_credit",
    credits: "1",
    originStatus: "200",
    latencyMs: "14ms",
  },
  {
    id: "evt-2",
    at: "00:42:16",
    identityId: "idt_k_2a97516c",
    type: "payment",
    rail: "exact",
    credits: "+10000",
    originStatus: "settled",
    latencyMs: "4120ms",
  },
  {
    id: "evt-3",
    at: "00:42:11",
    identityId: "idt_k_2a97516c",
    type: "request",
    route: "GET /v1/search",
    decision: "payment_required",
    credits: "1",
    originStatus: "402",
    latencyMs: "2ms",
  },
  {
    id: "evt-4",
    at: "00:41:58",
    identityId: "idt_w_9f04c11a",
    type: "request",
    route: "POST /v1/completions",
    decision: "allow_credit",
    credits: "17",
    originStatus: "200",
    latencyMs: "340ms",
  },
  {
    id: "evt-5",
    at: "00:41:44",
    identityId: "idt_k_7b1102e9",
    type: "request",
    route: "GET /v1/flaky",
    decision: "refunded",
    credits: "5",
    originStatus: "502",
    latencyMs: "89ms",
  },
  {
    id: "evt-6",
    at: "00:41:30",
    identityId: "idt_f_44c2d810",
    type: "request",
    route: "GET /v1/items/42",
    decision: "allow_free",
    credits: "2",
    originStatus: "200",
    latencyMs: "19ms",
  },
];

const MOCK_IDENTITIES: MockIdentity[] = [
  {
    id: "idt_k_2a97516c",
    kind: "api_key",
    creditBalance: "9984",
    abuseScore: 0.08,
    multiplier: 1.16,
    lastSeenAt: "2026-11-27 00:42",
    ledger: [
      { createdAt: "2026-11-27 00:42:18", reason: "debit: GET /v1/search", deltaCredits: -1 },
      { createdAt: "2026-11-27 00:42:16", reason: "grant: stellar exact (USDC)", deltaCredits: 10000 },
      { createdAt: "2026-11-27 00:41:05", reason: "debit: GET /v1/items/*", deltaCredits: -2 },
    ],
  },
  {
    id: "idt_w_9f04c11a",
    kind: "wallet",
    creditBalance: "4120",
    abuseScore: 0.18,
    multiplier: 1.36,
    lastSeenAt: "2026-11-27 00:41",
    ledger: [
      { createdAt: "2026-11-27 00:41:58", reason: "metered settle: POST /v1/completions", deltaCredits: -17 },
      { createdAt: "2026-11-27 00:39:12", reason: "reserve: POST /v1/completions", deltaCredits: -50 },
      { createdAt: "2026-11-27 00:39:12", reason: "refund unused metered delta", deltaCredits: 33 },
    ],
  },
  {
    id: "idt_k_7b1102e9",
    kind: "api_key",
    creditBalance: "7650",
    abuseScore: 0.54,
    multiplier: 2.08,
    lastSeenAt: "2026-11-27 00:41",
    ledger: [
      { createdAt: "2026-11-27 00:41:44", reason: "refund: origin 502 GET /v1/flaky", deltaCredits: 5 },
      { createdAt: "2026-11-27 00:41:44", reason: "debit: GET /v1/flaky", deltaCredits: -5 },
      { createdAt: "2026-11-27 00:35:02", reason: "grant: pix (AbacatePay)", deltaCredits: 10000 },
    ],
  },
];

const MOCK_ROLLUPS = [
  { hour: "2026-11-27 00:00", identityId: "idt_k_2a97516c", route: "GET /v1/search", requests: 142, credits: 142, paidCredits: 42 },
  { hour: "2026-11-27 00:00", identityId: "idt_w_9f04c11a", route: "POST /v1/completions", requests: 18, credits: 306, paidCredits: 306 },
  { hour: "2026-11-27 00:00", identityId: "idt_k_7b1102e9", route: "GET /v1/reports/*", requests: 9, credits: 180, paidCredits: 80 },
  { hour: "2026-11-26 23:00", identityId: "idt_f_44c2d810", route: "GET /v1/items/*", requests: 64, credits: 128, paidCredits: 0 },
];

const MOCK_OFFERS = [
  { id: "ofr_01JDX7QMV3", status: "paid", usdcAtomic: "5800000", xlmAtomic: "58000000", brlCents: 336, packCredits: 10000 },
  { id: "ofr_01JDX7K8P1", status: "paid", usdcAtomic: "6800000", xlmAtomic: "68000000", brlCents: 394, packCredits: 10000 },
  { id: "ofr_01JDX79T2A", status: "waiting", usdcAtomic: "10400000", xlmAtomic: "104000000", brlCents: 603, packCredits: 10000 },
];

const MOCK_POLICY = {
  origin: "http://localhost:8787",
  defaults: { unmatched: "deny", credits: 1 },
  free_tier: { window_seconds: 60, credits: 100, burst: 30 },
  pricing: { pack_credits: 10000, price_usdc: "0.50", price_xlm: "5.00", price_brl_cents: 290, max_multiplier: 3.0 },
  routes: [
    { match: "GET /v1/health", free: true },
    { match: "GET /v1/search", credits: 1 },
    { match: "POST /v1/completions", credits: 50, metered: true },
  ],
};

const MOCK_HEALTH = {
  database: { ok: true, latencyMs: 1 },
  decisionMs: { ok: true, ms: 0.14, sampleRoute: "GET /v1/search" },
  facilitator: { ok: true, url: "https://www.x402.org/facilitator", supportsExactStellarTestnet: true },
  stellar: { network: "stellar:testnet", usdcTrustline: true },
  pix: { provider: "abacatepay", configured: true },
};

const LABELS = {
  pt: {
    kicker: "06 / Console do operador (prévia interativa)",
    title: "Explore o painel do AWall sem precisar subir o servidor.",
    subtitle:
      "Mesma interface do console em apps/console, preenchida com dados fictícios de demonstração para navegação livre sem login.",
    mockBadge: "DADOS MOCADOS · SEM LOGIN",
    sseBadge: "SSE STREAM (DEMO)",
    simulateBtn: "Simular 402 → Pagamento",
    sideDesc: "Gateway autônomo: 402 Payment Required substituindo o 429.",
    sessionLabel: "Prévia pública",
    tabs: {
      live: "Ao vivo",
      requests: "Requisições",
      revenue: "Receita",
      identities: "Identidades",
      payments: "Pagamentos",
      policy: "Política",
      health: "Saúde",
    },
    headers: {
      live: ["Quando", "Identidade", "Rota", "Decisão", "Créditos", "Status", "Latência"],
      requests: ["Hora", "Identidade", "Rota", "Pedidos", "Créditos", "Pagos"],
      identities: ["Id", "Tipo", "Saldo", "Abuso", "Multiplicador", "Visto em"],
      payments: ["Offer ID", "Status", "USDC (Stellar)", "XLM (Stellar)", "Pix (BRL)", "Pacote"],
    },
    filterIdentity: "Filtrar por identidade…",
    allDecisions: "Todas as decisões",
    backIdentities: "← Voltar para identidades",
    revenueCards: {
      recovered: { label: "Requisições recuperadas", sub: "429 evitados via x402" },
      volume: { label: "Volume total", sub: "últimas 24 horas" },
      credits: { label: "Créditos consumidos", sub: "débito off-chain" },
      usdc: { label: "USDC liquidado", sub: "stellar:testnet (exact)" },
      xlm: { label: "XLM liquidado", sub: "stellar:testnet (exact)" },
      pix: { label: "Pix liquidado", sub: "pix:bcb · AbacatePay" },
      infra: { label: "Custo infra estimado", sub: "coberto por receita" },
      avgMult: { label: "Multiplicador médio", sub: "teto 3.00×" },
    },
    policyNote: "Origem simulada: awall.yaml. Edite o JSON abaixo para testar a revisão de diff.",
    reviewDiff: "Revisar alteração",
    applyMock: "Aplicar (simulação)",
    appliedMsg: "Prévia atualizada localmente (nenhuma chamada ao servidor real).",
  },
  en: {
    kicker: "06 / Operator console (interactive preview)",
    title: "Inspect the AWall dashboard without spinning up the stack.",
    subtitle:
      "The exact operator console UI from apps/console, populated with mocked sample data for public exploration without login.",
    mockBadge: "MOCKED DATA · NO LOGIN",
    sseBadge: "SSE STREAM (DEMO)",
    simulateBtn: "Simulate 402 → Settle",
    sideDesc: "Autonomous gateway: 402 Payment Required replacing 429.",
    sessionLabel: "Public preview",
    tabs: {
      live: "Live",
      requests: "Requests",
      revenue: "Revenue",
      identities: "Identities",
      payments: "Payments",
      policy: "Policy",
      health: "Health",
    },
    headers: {
      live: ["Time", "Identity", "Route", "Decision", "Credits", "Status", "Latency"],
      requests: ["Hour", "Identity", "Route", "Requests", "Credits", "Paid"],
      identities: ["Id", "Kind", "Balance", "Abuse", "Multiplier", "Last seen"],
      payments: ["Offer ID", "Status", "USDC (Stellar)", "XLM (Stellar)", "Pix (BRL)", "Pack"],
    },
    filterIdentity: "Filter by identity…",
    allDecisions: "All decisions",
    backIdentities: "← Back to identities",
    revenueCards: {
      recovered: { label: "Recovered requests", sub: "429s turned into 200" },
      volume: { label: "Total volume", sub: "last 24 hours" },
      credits: { label: "Credits spent", sub: "off-chain ledger" },
      usdc: { label: "USDC settled", sub: "stellar:testnet (exact)" },
      xlm: { label: "XLM settled", sub: "stellar:testnet (exact)" },
      pix: { label: "Pix settled", sub: "pix:bcb · AbacatePay" },
      infra: { label: "Estimated infra cost", sub: "covered by revenue" },
      avgMult: { label: "Avg abuse multiplier", sub: "cap 3.00×" },
    },
    policyNote: "Simulated source: awall.yaml. Edit the JSON below to preview the diff workflow.",
    reviewDiff: "Review change",
    applyMock: "Apply (mocked)",
    appliedMsg: "Preview updated locally (no live gateway call made).",
  },
} as const;

function NavIcon({ name }: { name: Exclude<ConsoleTab, "identity"> }) {
  switch (name) {
    case "live":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2" />
          <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
        </svg>
      );
    case "requests":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "revenue":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M12 8v8m-4-5h8" />
        </svg>
      );
    case "identities":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        </svg>
      );
    case "payments":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "policy":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case "health":
      return (
        <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      );
  }
}

function formatAtomic7(atomic: string): string {
  const whole = BigInt(atomic);
  const units = whole / 10_000_000n;
  const frac = (whole % 10_000_000n).toString().padStart(7, "0").slice(0, 2);
  return `${units}.${frac}`;
}

function decisionClass(value: string): string {
  switch (value) {
    case "allow_free":
    case "paid":
      return "cp-pill ok";
    case "allow_credit":
    case "exact":
      return "cp-pill accent";
    case "payment_required":
    case "waiting":
      return "cp-pill warn";
    case "refunded":
      return "cp-pill err";
    default:
      return "cp-pill";
  }
}

export function ConsolePreview({ lang }: { lang: Lang }) {
  const copy = LABELS[lang];
  const [tab, setTab] = useState<ConsoleTab>("live");
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>(MOCK_IDENTITIES[0]!.id);
  const [events, setEvents] = useState<MockEvent[]>(INITIAL_EVENTS);
  const [decisionFilter, setDecisionFilter] = useState("");
  const [identityFilter, setIdentityFilter] = useState("");
  const [recoveredCount, setRecoveredCount] = useState(48);
  const [usdcTotalAtomic, setUsdcTotalAtomic] = useState(12_600_000n);
  const [policyBase, setPolicyBase] = useState(() => JSON.stringify(MOCK_POLICY, null, 2));
  const [policyDraft, setPolicyDraft] = useState(() => JSON.stringify(MOCK_POLICY, null, 2));
  const [showDiff, setShowDiff] = useState(false);
  const [policyNotice, setPolicyNotice] = useState("");

  const filteredEvents = useMemo(
    () =>
      events.filter((row) => {
        if (decisionFilter && row.decision !== decisionFilter) return false;
        if (identityFilter && !row.identityId.includes(identityFilter)) return false;
        return true;
      }),
    [events, decisionFilter, identityFilter],
  );

  const activeIdentity =
    MOCK_IDENTITIES.find((item) => item.id === selectedIdentityId) ?? MOCK_IDENTITIES[0]!;

  const simulateFlow = () => {
    const now = new Date().toTimeString().slice(0, 8);
    const seq = events.length + 1;
    const req402: MockEvent = {
      id: `sim-402-${seq}`,
      at: now,
      identityId: "idt_k_2a97516c",
      type: "request",
      route: "GET /v1/search",
      decision: "payment_required",
      credits: "1",
      originStatus: "402",
      latencyMs: "2ms",
    };
    const payEvent: MockEvent = {
      id: `sim-pay-${seq}`,
      at: now,
      identityId: "idt_k_2a97516c",
      type: "payment",
      rail: "exact",
      credits: "+10000",
      originStatus: "settled",
      latencyMs: "3980ms",
    };
    const req200: MockEvent = {
      id: `sim-200-${seq}`,
      at: now,
      identityId: "idt_k_2a97516c",
      type: "request",
      route: "GET /v1/search",
      decision: "allow_credit",
      credits: "1",
      originStatus: "200",
      latencyMs: "12ms",
    };
    setEvents((prev) => [req200, payEvent, req402, ...prev].slice(0, 14));
    setRecoveredCount((n) => n + 1);
    setUsdcTotalAtomic((prev) => prev + 5_000_000n);
    setTab("live");
  };

  return (
    <section id="console-preview" className="section">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">{copy.kicker}</span>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>

        <div className="console-frame">
          <aside className="console-side">
            <div className="console-brand">
              <span className="brand-mark" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </span>
              <span>AWall</span>
              <span className="brand-tag">x402</span>
            </div>
            <p className="console-side-desc">{copy.sideDesc}</p>

            <nav className="console-nav" aria-label="Console preview tabs">
              {(
                ["live", "requests", "revenue", "identities", "payments", "policy", "health"] as const
              ).map((id) => {
                const active = tab === id || (tab === "identity" && id === "identities");
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setTab(id)}
                  >
                    <NavIcon name={id} />
                    <span>{copy.tabs[id]}</span>
                  </button>
                );
              })}
            </nav>

            <div className="console-side-foot">
              <div>
                <span><i className="live-dot ok" />STELLAR TESTNET</span>
                <span>USDC / XLM</span>
              </div>
              <div>
                <span><i className="live-dot ok" />PIX RAIL</span>
                <span>ABACATEPAY</span>
              </div>
            </div>
          </aside>

          <div className="console-main">
            <div className="console-topbar">
              <div className="console-topbar-left">
                <span className="cp-pill warn">{copy.mockBadge}</span>
                <span className="cp-pill ok"><i className="live-dot ok" />{copy.sseBadge}</span>
                <span className="console-session">{copy.sessionLabel}</span>
              </div>
              <button type="button" className="btn sm primary" onClick={simulateFlow}>
                {copy.simulateBtn}
              </button>
            </div>

            <div key={tab} className="panel-animate">
            {tab === "live" && (
              <div>
                <div className="console-filters">
                  <input
                    value={identityFilter}
                    onChange={(event) => setIdentityFilter(event.target.value)}
                    placeholder={copy.filterIdentity}
                    aria-label={copy.filterIdentity}
                  />
                  <select
                    value={decisionFilter}
                    onChange={(event) => setDecisionFilter(event.target.value)}
                    aria-label={copy.allDecisions}
                  >
                    <option value="">{copy.allDecisions}</option>
                    <option value="allow_free">allow_free</option>
                    <option value="allow_credit">allow_credit</option>
                    <option value="payment_required">payment_required</option>
                    <option value="refunded">refunded</option>
                  </select>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {copy.headers.live.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((row) => (
                        <tr
                          key={row.id}
                          className={row.id.startsWith("sim-") ? "row-flash" : undefined}
                        >
                          <td className="mono">{row.at}</td>
                          <td className="mono" style={{ color: "var(--accent)" }}>
                            {row.identityId}
                          </td>
                          <td className="mono">
                            {row.type === "payment" ? `payment (${row.rail})` : row.route}
                          </td>
                          <td>
                            <span className={decisionClass(row.decision ?? row.rail ?? "")}>
                              {row.decision ?? row.rail}
                            </span>
                          </td>
                          <td className="mono">{row.credits}</td>
                          <td className="mono">{row.originStatus}</td>
                          <td className="mono">{row.latencyMs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "requests" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {copy.headers.requests.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_ROLLUPS.map((row, idx) => (
                      <tr key={idx}>
                        <td className="mono">{row.hour}</td>
                        <td className="mono" style={{ color: "var(--accent)" }}>
                          {row.identityId}
                        </td>
                        <td className="mono">{row.route}</td>
                        <td className="mono">{row.requests}</td>
                        <td className="mono">{row.credits}</td>
                        <td className="mono" style={{ color: "var(--ok)" }}>
                          {row.paidCredits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "revenue" && (
              <div>
                <div className="cp-cards">
                  <div className="cp-card">
                    <span>{copy.revenueCards.recovered.label}</span>
                    <strong style={{ color: "var(--accent)" }}>{recoveredCount}</strong>
                    <small>{copy.revenueCards.recovered.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.volume.label}</span>
                    <strong>{233 + (recoveredCount - 48) * 2}</strong>
                    <small>{copy.revenueCards.volume.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.credits.label}</span>
                    <strong>756</strong>
                    <small>{copy.revenueCards.credits.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.usdc.label}</span>
                    <strong style={{ color: "var(--ok)" }}>
                      {formatAtomic7(usdcTotalAtomic.toString())} USDC
                    </strong>
                    <small>{copy.revenueCards.usdc.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.xlm.label}</span>
                    <strong>7.88 XLM</strong>
                    <small>{copy.revenueCards.xlm.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.pix.label}</span>
                    <strong style={{ color: "var(--ok)" }}>R$ 7,30</strong>
                    <small>{copy.revenueCards.pix.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.infra.label}</span>
                    <strong>$0.0378</strong>
                    <small>{copy.revenueCards.infra.sub}</small>
                  </div>
                  <div className="cp-card">
                    <span>{copy.revenueCards.avgMult.label}</span>
                    <strong style={{ color: "var(--warn)" }}>1.53×</strong>
                    <small>{copy.revenueCards.avgMult.sub}</small>
                  </div>
                </div>
              </div>
            )}

            {tab === "identities" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {copy.headers.identities.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_IDENTITIES.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className="cp-link"
                            onClick={() => {
                              setSelectedIdentityId(row.id);
                              setTab("identity");
                            }}
                          >
                            {row.id}
                          </button>
                        </td>
                        <td className="mono">{row.kind}</td>
                        <td className="mono" style={{ color: "var(--ok)" }}>
                          {row.creditBalance}
                        </td>
                        <td className="mono">{row.abuseScore.toFixed(2)}</td>
                        <td className="mono">
                          <span className={row.multiplier > 1.3 ? "cp-pill warn" : "cp-pill ok"}>
                            {row.multiplier.toFixed(2)}×
                          </span>
                        </td>
                        <td className="mono">{row.lastSeenAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "identity" && (
              <div>
                <button
                  type="button"
                  className="cp-link"
                  style={{ marginBottom: 12 }}
                  onClick={() => setTab("identities")}
                >
                  {copy.backIdentities}
                </button>
                <div className="cp-cards" style={{ marginBottom: 14, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div className="cp-card">
                    <span>ID</span>
                    <strong style={{ fontSize: 15, color: "var(--accent)" }}>
                      {activeIdentity.id}
                    </strong>
                  </div>
                  <div className="cp-card">
                    <span>Balance</span>
                    <strong style={{ color: "var(--ok)" }}>{activeIdentity.creditBalance}</strong>
                  </div>
                  <div className="cp-card">
                    <span>Multiplier</span>
                    <strong>{activeIdentity.multiplier.toFixed(2)}×</strong>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Reason</th>
                        <th>Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeIdentity.ledger.map((entry, idx) => (
                        <tr key={idx}>
                          <td className="mono">{entry.createdAt}</td>
                          <td>{entry.reason}</td>
                          <td
                            className="mono"
                            style={{ color: entry.deltaCredits > 0 ? "var(--ok)" : "var(--err)" }}
                          >
                            {entry.deltaCredits > 0 ? `+${entry.deltaCredits}` : entry.deltaCredits}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "payments" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {copy.headers.payments.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_OFFERS.map((row) => (
                      <tr key={row.id}>
                        <td className="mono" style={{ color: "var(--accent)" }}>
                          {row.id}
                        </td>
                        <td>
                          <span className={decisionClass(row.status)}>{row.status}</span>
                        </td>
                        <td className="mono">{formatAtomic7(row.usdcAtomic)}</td>
                        <td className="mono">{formatAtomic7(row.xlmAtomic)}</td>
                        <td className="mono">R$ {(row.brlCents / 100).toFixed(2)}</td>
                        <td className="mono" style={{ color: "var(--ok)" }}>
                          {row.packCredits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "policy" && (
              <div>
                <p className="cp-note">{copy.policyNote}</p>
                <textarea
                  className="cp-textarea"
                  value={policyDraft}
                  onChange={(event) => setPolicyDraft(event.target.value)}
                  spellCheck={false}
                  aria-label="Mocked policy JSON"
                />
                <div className="cp-actions">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={policyDraft === policyBase}
                    onClick={() => setShowDiff((v) => !v)}
                  >
                    {copy.reviewDiff}
                  </button>
                  {showDiff && (
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => {
                        setPolicyBase(policyDraft);
                        setShowDiff(false);
                        setPolicyNotice(copy.appliedMsg);
                      }}
                    >
                      {copy.applyMock}
                    </button>
                  )}
                </div>
                {showDiff && (
                  <div className="cp-diff">
                    <pre className="code-pre">{policyBase}</pre>
                    <pre className="code-pre">{policyDraft}</pre>
                  </div>
                )}
                {policyNotice && <p className="cp-notice">{policyNotice}</p>}
              </div>
            )}

            {tab === "health" && (
              <div className="code-frame">
                <div className="code-bar">
                  <span>GET /awall/health/checks</span>
                  <span style={{ color: "var(--ok)" }}>200 OK</span>
                </div>
                <CodeBlock code={JSON.stringify(MOCK_HEALTH, null, 2)} lang="json" />
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
