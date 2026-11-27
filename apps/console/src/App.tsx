import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  admin,
  demoCredentials,
  gatewayUrl,
  login as signIn,
  logout as signOut,
  payOffer,
  publicGet,
  streamTicket,
  streamUrl,
  whoami,
  type ConsoleUser,
  type LiveEvent,
  type PageInfo,
} from "./api";

const TABS = [
  ["live", "Ao vivo"],
  ["requests", "Requisições"],
  ["revenue", "Receita"],
  ["identities", "Identidades"],
  ["payments", "Pagamentos"],
  ["policy", "Política"],
  ["health", "Saúde"],
] as const;

type Tab = (typeof TABS)[number][0] | "identity" | "pay" | "login";

type Location = { tab: Tab; offerId?: string; identityId?: string };

function readLocation(): Location {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const pay = /^\/pay\/([^/]+)$/.exec(path);
  if (pay?.[1]) return { tab: "pay", offerId: decodeURIComponent(pay[1]) };
  if (path === "/login") return { tab: "login" };
  const identity = /^\/identities\/([^/]+)$/.exec(path);
  if (identity?.[1]) return { tab: "identity", identityId: decodeURIComponent(identity[1]) };
  const name = path.slice(1);
  const known = TABS.some(([id]) => id === name);
  return { tab: known ? (name as Tab) : "live" };
}

function go(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [location, setLocation] = useState<Location>(readLocation);
  /** `undefined` while the session is still being checked. */
  const [user, setUser] = useState<ConsoleUser | null | undefined>(undefined);

  useEffect(() => {
    const sync = () => setLocation(readLocation());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const checkout = location.tab === "pay" && location.offerId !== undefined;

  useEffect(() => {
    // The checkout is public and has no session to ask about.
    if (checkout) return;
    let cancelled = false;
    void whoami().then((found) => {
      if (!cancelled) setUser(found);
    });
    return () => {
      cancelled = true;
    };
  }, [checkout]);

  // The URL follows the session: no session means `/login`, and a session
  // means anything but. Navigation is a side effect, so it is not done while
  // rendering.
  useEffect(() => {
    if (checkout || user === undefined) return;
    if (user === null && location.tab !== "login") go("/login");
    if (user !== null && location.tab === "login") go("/live");
  }, [checkout, user, location.tab]);

  if (location.tab === "pay" && location.offerId) {
    return <Checkout offerId={location.offerId} />;
  }

  if (user === undefined) {
    return <p className="empty">Carregando…</p>;
  }

  // No session: the login screen, whatever the URL still says.
  if (user === null) {
    return <Login onSignedIn={setUser} />;
  }

  // Signed in and on `/login`: the effect above is already moving away.
  if (location.tab === "login") {
    return <p className="empty">Carregando…</p>;
  }

  return (
    <div className="app">
      <header className="nav">
        <div className="nav-inner">
          <button type="button" className="nav-mark" onClick={() => go("/live")} aria-label="AWall, ao vivo">
            AWall<span className="nav-dot">.</span>
            <span className="nav-badge">x402</span>
          </button>
          <nav className="tabs" aria-label="Seções do console">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                aria-current={location.tab === id || (id === "identities" && location.tab === "identity") ? "page" : undefined}
                onClick={() => go(`/${id}`)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="rails" aria-label="Trilhos de pagamento">
            <span className="rail-chip rail-stellar"><i aria-hidden="true" />Redes cripto · testnet</span>
            <span className="rail-chip rail-pix"><i aria-hidden="true" />Pix</span>
          </div>
          <SessionBar user={user} onSignedOut={() => setUser(null)} />
        </div>
      </header>
      <main className="main">
        {location.tab === "live" && <Live />}
        {location.tab === "requests" && <Requests />}
        {location.tab === "revenue" && <Revenue />}
        {location.tab === "identities" && <Identities />}
        {location.tab === "identity" && location.identityId && <IdentityDetail id={location.identityId} />}
        {location.tab === "payments" && <Payments />}
        {location.tab === "policy" && <Policy />}
        {location.tab === "health" && <Health />}
      </main>
    </div>
  );
}

function Login({ onSignedIn }: { onSignedIn: (user: ConsoleUser) => void }) {
  const demo = demoCredentials();
  const [username, setUsername] = useState(demo?.username ?? "");
  const [password, setPassword] = useState(demo?.password ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await signIn(username, password);
    // The typed password is dropped either way: nothing keeps it after the
    // call. A demo deployment refills the form so a wrong try is one click away.
    setPassword(demo?.password ?? "");
    setBusy(false);
    if (!result.ok) {
      // The gateway answers the same for an unknown user and a wrong password,
      // and so does this screen.
      setError(
        result.status === 401
          ? "Usuário ou senha incorretos."
          : "Não consegui falar com o gateway. Confira se ele está no ar.",
      );
      return;
    }
    onSignedIn(result.user);
  }

  return (
    <div className="login">
      <form className="panel" onSubmit={(event) => void submit(event)}>
        <h1 className="mark">AWall<span className="mark-dot">.</span></h1>
        <p className="lede">Console do operador. Entre com usuário e senha.</p>
        {demo && <p className="hint">Demonstração: usuário e senha já preenchidos. Basta entrar.</p>}
        <label htmlFor="username">Usuário</label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoFocus
        />
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="banner bad">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !username || !password}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        {!demo && (
          <p className="hint">
            Sem usuário ainda? Crie o primeiro com <span className="mono">pnpm --filter @awall/gateway create-user</span>.
          </p>
        )}
      </form>
    </div>
  );
}

function SessionBar({ user, onSignedOut }: { user: ConsoleUser; onSignedOut: () => void }) {
  return (
    <div className="session">
      <span>
        Sessão de <strong>{user.username}</strong>
      </span>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          void signOut().then(onSignedOut);
        }}
      >
        Sair
      </button>
    </div>
  );
}

function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    admin(path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "falha");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, error, loading };
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  return (
    <span className={`pill ${normalized}`}>
      <span className="pill-dot" />
      {value}
    </span>
  );
}

function Live() {
  const [rows, setRows] = useState<LiveEvent[]>([]);
  const [decision, setDecision] = useState("");
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let retry = 0;

    const onEvent = (event: MessageEvent) => {
      const parsed = JSON.parse(event.data) as LiveEvent;
      setRows((current) => [parsed, ...current].slice(0, 80));
    };

    /**
     * A ticket is single use, so a dropped stream needs a new one. The browser
     * would reconnect with the spent ticket and be refused, so the retry closes
     * the source and mints again.
     */
    const open = async () => {
      try {
        const ticket = await streamTicket();
        if (stopped) return;
        const opened = new EventSource(streamUrl(ticket));
        source = opened;
        opened.addEventListener("request", onEvent);
        opened.addEventListener("payment", onEvent);
        opened.addEventListener("open", () => setError(""));
        opened.onerror = () => {
          opened.close();
          if (stopped) return;
          setError("A conexão ao vivo caiu. Reconectando…");
          retry = window.setTimeout(() => void open(), 2000);
        };
      } catch {
        if (stopped) return;
        setError("Não consegui abrir o fluxo. Confira se o gateway está no ar.");
        retry = window.setTimeout(() => void open(), 5000);
      }
    };

    void open();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      source?.close();
    };
  }, []);

  const visible = rows.filter((row) => {
    if (decision && row.decision !== decision) return false;
    if (identity && !row.identityId.includes(identity)) return false;
    return true;
  });

  return (
    <section>
      <h1>
        Ao vivo
        {!error && <span className="pill good"><span className="pill-dot" />STREAM SSE CONECTADO</span>}
      </h1>
      <p className="lede">Cada requisição e cada pagamento, assim que o gateway decide no pipeline x402.</p>
      {error && <p className="banner bad">{error}</p>}
      <div className="filters">
        <input
          value={identity}
          onChange={(event) => setIdentity(event.target.value)}
          placeholder="Filtrar por identidade…"
          aria-label="Filtrar identidade"
        />
        <select
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
          aria-label="Filtrar decisão"
        >
          <option value="">Todas as decisões</option>
          <option value="allow_free">allow_free</option>
          <option value="allow_credit">allow_credit</option>
          <option value="payment_required">payment_required</option>
          <option value="refunded">refunded</option>
        </select>
      </div>
      {visible.length === 0 ? (
        <div className="panel empty">
          Nenhuma requisição recebida ainda. Faça uma chamada no gateway e ela aparecerá aqui instantaneamente.
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Identidade</th>
                <th>Rota</th>
                <th>Decisão</th>
                <th>Créditos</th>
                <th>Status</th>
                <th>Latência</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={`${row.at}-${index}`}>
                  <td className="mono">{row.at.slice(11, 19)}</td>
                  <td className="mono" style={{ color: "var(--accent)" }}>{row.identityId}</td>
                  <td>{row.type === "payment" ? <span className="pill allow_credit">pagamento {row.rail ?? ""}</span> : row.route}</td>
                  <td>
                    {row.decision ? <StatusPill value={row.decision} /> : <StatusPill value={row.rail ?? "payment"} />}
                  </td>
                  <td className="mono">{row.credits ?? row.creditedCredits ?? "—"}</td>
                  <td className="mono">{row.originStatus ?? "—"}</td>
                  <td className="mono">{row.latencyMs !== undefined ? `${row.latencyMs}ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Requests() {
  const { data, error, loading } = useAdmin<{ rollups: Record<string, unknown>[] }>("/awall/usage/rollups");
  const rollups = data?.rollups ?? [];
  return (
    <section>
      <h1>Requisições</h1>
      <p className="lede">Agregado histórico por identidade, rota e hora. Métricas de consumo do gateway.</p>
      {loading && <p className="empty">Carregando telemetria…</p>}
      {error && <p className="banner bad">{error}</p>}
      {!loading && !error && rollups.length === 0 && <p className="empty">Nenhum agregado nesta janela.</p>}
      {rollups.length > 0 && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Identidade</th>
                <th>Rota</th>
                <th>Pedidos</th>
                <th>Créditos</th>
                <th>Pagos</th>
              </tr>
            </thead>
            <tbody>
              {rollups.map((row, index) => (
                <tr key={index}>
                  <td className="mono">{String(row["hour"] ?? "")}</td>
                  <td className="mono" style={{ color: "var(--accent)" }}>{String(row["identityId"] ?? "")}</td>
                  <td>{String(row["route"] ?? "")}</td>
                  <td className="mono">{String(row["requests"] ?? "")}</td>
                  <td className="mono">{String(row["credits"] ?? "")}</td>
                  <td className="mono" style={{ color: "var(--good)" }}>{String(row["paidCredits"] ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Revenue() {
  const { data, error, loading } = useAdmin<Summary>("/awall/stats/summary?window=24h");
  return (
    <section>
      <h1>Receita & Telemetria</h1>
      <p className="lede">Últimas 24 horas. Requisição recuperada é a que teria sido 429 e foi atendida após liquidação x402.</p>
      {loading && <p className="empty">Calculando métricas financeiras…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && (
        <div className="cards">
          <article className="card">
            <span>Requisições Recuperadas</span>
            <strong style={{ color: "var(--accent)" }}>{data.recoveredRequests}</strong>
          </article>
          <article className="card">
            <span>Volume Total</span>
            <strong>{data.requests}</strong>
          </article>
          <article className="card">
            <span>Créditos Consumidos</span>
            <strong>{data.credits}</strong>
          </article>
          <article className="card">
            <span>USDC liquidado (redes cripto)</span>
            <strong style={{ color: "var(--stellar)" }}>{atomic(codeAmount(data.revenue, "USDC"))}</strong>
          </article>
          <article className="card">
            <span>Moeda nativa liquidada (redes cripto)</span>
            <strong style={{ color: "var(--stellar)" }}>{atomic(codeAmount(data.revenue, "XLM"))}</strong>
          </article>
          <article className="card">
            <span>Pix Liquidado (BRL)</span>
            <strong style={{ color: "var(--pix)" }}>R$ {(Number(codeAmount(data.revenue, "BRL")) / 100).toFixed(2)}</strong>
          </article>
          <article className="card">
            <span>Infraestrutura Estimada</span>
            <strong>${data.infra.estimatedUsd.toFixed(4)}</strong>
          </article>
        </div>
      )}
      {data && (
        <div className="panel" style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>Multiplicador médio de abuso de tráfego:</span>
          <span className="pill wait"><span className="pill-dot" />{data.abuse.avgMultiplier.toFixed(2)}×</span>
        </div>
      )}
    </section>
  );
}

type Summary = {
  requests: number;
  recoveredRequests: number;
  credits: number;
  revenue: { rail: string; asset: string; code: string; count: number; amount: string }[];
  infra: { estimatedUsd: number };
  abuse: { avgMultiplier: number };
};

function codeAmount(rows: Summary["revenue"], code: string): string {
  const total = rows
    .filter((row) => row.code === code)
    .reduce((sum, row) => sum + BigInt(row.amount || "0"), 0n);
  return total.toString();
}

function atomic(value: string): string {
  try {
    const whole = BigInt(value || "0");
    const units = whole / 10_000_000n;
    const frac = (whole % 10_000_000n).toString().padStart(7, "0").slice(0, 2);
    return `${units}.${frac}`;
  } catch {
    return value;
  }
}

const PAGE_LIMIT = 50;

function Identities() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useAdmin<{ identities: Identity[]; page: PageInfo }>(
    `/awall/identities?limit=${PAGE_LIMIT}&offset=${offset}`,
  );
  const rows = data?.identities ?? [];
  const page = data?.page;
  return (
    <section>
      <h1>Identidades</h1>
      <p className="lede">Saldos de créditos, índices de abuso e multiplicador de preço por cliente.</p>
      {loading && <p className="empty">Consultando identidades…</p>}
      {error && <p className="banner bad">{error}</p>}
      {!loading && !error && rows.length === 0 && offset === 0 && <p className="empty">Ninguém passou pelo gateway ainda.</p>}
      {rows.length > 0 && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Id</th>
                <th>Tipo</th>
                <th>Saldo de Créditos</th>
                <th>Escore de Abuso</th>
                <th>Multiplicador</th>
                <th>Visto em</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button className="row-link" onClick={() => go(`/identities/${row.id}`)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      {row.id}
                    </button>
                  </td>
                  <td><span className="pill neutral">{row.kind}</span></td>
                  <td className="mono" style={{ fontWeight: 600, color: "var(--good)" }}>{row.creditBalance}</td>
                  <td className="mono">{row.abuseScore.toFixed(2)}</td>
                  <td>
                    <span className={`pill ${row.multiplier > 1.2 ? "wait" : "good"}`}>
                      {row.multiplier.toFixed(2)}×
                    </span>
                  </td>
                  <td className="mono">{row.lastSeenAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && (offset > 0 || page.hasMore) && (
        <div className="panel" style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button className="primary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}>
            Anteriores
          </button>
          <span className="mono" style={{ color: "var(--text-2)", fontSize: 13 }}>
            Linhas {offset + 1}–{offset + rows.length}
          </span>
          <button className="primary" type="button" disabled={page.nextOffset === null} onClick={() => setOffset(page.nextOffset ?? offset)}>
            Próximas
          </button>
        </div>
      )}
    </section>
  );
}

type Identity = {
  id: string;
  kind: string;
  abuseScore: number;
  multiplier: number;
  creditBalance: string;
  lastSeenAt: string;
};

function IdentityDetail({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useAdmin<{
    identity: Identity;
    ledger: Record<string, unknown>[];
    ledgerPage: PageInfo;
    payments: Record<string, unknown>[];
  }>(`/awall/identities/${id}?limit=${PAGE_LIMIT}&offset=${offset}`);
  const ledgerPage = data?.ledgerPage;
  return (
    <section>
      <button className="row-link" style={{ marginBottom: 16 }} onClick={() => go("/identities")}>
        ← Voltar para lista de identidades
      </button>
      <h1>Identidade: <span className="mono" style={{ color: "var(--accent)" }}>{id}</span></h1>
      {loading && <p className="empty">Carregando detalhes do cliente…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && (
        <div className="cards" style={{ margin: "20px 0" }}>
          <div className="card">
            <span>Saldo Atual</span>
            <strong style={{ color: "var(--good)" }}>{data.identity.creditBalance} créditos</strong>
          </div>
          <div className="card">
            <span>Multiplicador de Abuso</span>
            <strong>{data.identity.multiplier.toFixed(2)}×</strong>
          </div>
          <div className="card">
            <span>Tipo de Credencial</span>
            <strong>{data.identity.kind}</strong>
          </div>
        </div>
      )}
      {data && data.ledger.length === 0 && offset === 0 && <p className="empty">Extrato do ledger vazio.</p>}
      {data && data.ledger.length > 0 && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Motivo do Lançamento</th>
                <th>Delta de Créditos</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((row, index) => {
                const delta = Number(row["deltaCredits"] ?? 0);
                return (
                  <tr key={index}>
                    <td className="mono">{String(row["createdAt"] ?? "")}</td>
                    <td>{String(row["reason"] ?? "")}</td>
                    <td className="mono" style={{ color: delta > 0 ? "var(--good)" : delta < 0 ? "var(--bad)" : "inherit", fontWeight: 600 }}>
                      {delta > 0 ? `+${delta}` : delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ledgerPage && (offset > 0 || ledgerPage.hasMore) && (
        <div className="panel" style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button className="primary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}>
            Anteriores
          </button>
          <span className="mono" style={{ color: "var(--text-2)", fontSize: 13 }}>
            Lançamentos {offset + 1}–{offset + (data?.ledger.length ?? 0)}
          </span>
          <button className="primary" type="button" disabled={ledgerPage.nextOffset === null} onClick={() => setOffset(ledgerPage.nextOffset ?? offset)}>
            Próximos
          </button>
        </div>
      )}
    </section>
  );
}

function Payments() {
  const { data, error, loading } = useAdmin<{ payments: Record<string, unknown>[]; offers: Record<string, unknown>[] }>("/awall/payments");
  const payments = data?.payments ?? [];
  const offers = data?.offers ?? [];
  return (
    <section>
      <h1>Pagamentos & Offers</h1>
      <p className="lede">Todo crédito concedido no gateway possui liquidação e idempotência auditável.</p>
      {loading && <p className="empty">Consultando liquidações…</p>}
      {error && <p className="banner bad">{error}</p>}
      {!loading && !error && payments.length === 0 && offers.length === 0 && <p className="empty">Nenhuma offer emitida ainda.</p>}
      {offers.length > 0 && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Offer ID</th>
                <th>Status</th>
                <th>USDC (redes cripto)</th>
                <th>Moeda nativa (redes cripto)</th>
                <th>Pix (BRL)</th>
                <th>Pacote de Créditos</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((row) => (
                <tr key={String(row["id"])}>
                  <td className="mono" style={{ color: "var(--accent)" }}>{String(row["id"])}</td>
                  <td><StatusPill value={String(row["status"])} /></td>
                  <td className="mono" style={{ color: "var(--stellar)" }}>{formatStellarAmount(String(row["priceUsdcAtomic"] ?? ""))}</td>
                  <td className="mono" style={{ color: "var(--stellar)" }}>{formatStellarAmount(String(row["priceXlmAtomic"] ?? ""))}</td>
                  <td className="mono" style={{ color: "var(--pix)" }}>R$ {(Number(row["priceBrlCents"] ?? 0) / 100).toFixed(2)}</td>
                  <td className="mono" style={{ color: "var(--good)", fontWeight: 600 }}>{String(row["packCredits"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Policy() {
  const { data, error, loading } = useAdmin<{ source: string; policy: unknown; versions: { id: string; appliedBy: string; createdAt: string }[] }>("/awall/policy");
  const original = useMemo(() => (data ? JSON.stringify(data.policy, null, 2) : ""), [data]);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setDraft(original), [original]);

  async function apply() {
    setMessage("");
    // No actor header: the gateway records the signed-in user from the session.
    const response = await admin("/awall/policy", {
      method: "PUT",
      body: draft,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(`Recusado (${response.status}). O schema da política não aceitou a configuração JSON.`);
      return;
    }
    setConfirming(false);
    setMessage(`Política aplicada com sucesso. Versão ${String((body as { version?: { id?: string } }).version?.id ?? "")}.`);
  }

  return (
    <section>
      <h1>Política do Gateway</h1>
      <p className="lede">Origem atual: <span className="mono" style={{ color: "var(--accent)" }}>{data?.source ?? "…"}</span>. As alterações são dinâmicas sem reinicialização.</p>
      {loading && <p className="empty">Carregando política…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && (
        <>
          <textarea
            className="json"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Política em JSON"
            spellCheck={false}
          />
          <div style={{ marginTop: 12 }}>
            <button className="primary" type="button" onClick={() => setConfirming(true)} disabled={draft === original}>
              Revisar Alteração
            </button>
          </div>
          {confirming && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Comparativo de Alterações (Diff)</h3>
              <p style={{ color: "var(--text-2)", fontSize: 13, margin: "0 0 12px" }}>Confira a política anterior à esquerda e a nova proposta à direita antes de cometer.</p>
              <div className="diff">
                <div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>POLÍTICA ATUAL</span>
                  <pre>{original}</pre>
                </div>
                <div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>NOVA VERSÃO</span>
                  <pre>{draft}</pre>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="primary" type="button" onClick={() => void apply()}>
                  Confirmar e Aplicar
                </button>
                <button className="row-link" type="button" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {message && <p className="banner" style={{ marginTop: 16 }}>{message}</p>}
          <h2 style={{ fontSize: 18, marginTop: 32, marginBottom: 12 }}>Histórico de Versões</h2>
          {data.versions.length === 0 ? (
            <p className="empty">Nenhuma versão gravada. O arquivo YAML inicial ainda é a fonte ativa.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Versão</th>
                    <th>Aplicado por</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {data.versions.map((version) => (
                    <tr key={version.id}>
                      <td className="mono" style={{ color: "var(--accent)" }}>{version.id}</td>
                      <td>{version.appliedBy}</td>
                      <td className="mono">{version.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Health() {
  const { data, error, loading } = useAdmin<Record<string, unknown>>("/awall/health/checks");
  return (
    <section>
      <h1>Diagnóstico de Saúde</h1>
      <p className="lede">Facilitator x402, provedores Pix e conectividade de recebimento em tempo real.</p>
      {loading && <p className="empty">Executando verificações no gateway…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && (
        <div className="panel">
          <pre className="json" style={{ margin: 0, minHeight: 300 }}>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}

function stellarRow(value: unknown) {
  if (!value || typeof value !== "object") {
    return <p className="muted">Termos cripto ainda não sincronizados.</p>;
  }
  const stellar = value as {
    network?: string;
    payTo?: string;
    usdc?: { amount?: string; asset?: string; code?: string };
    xlm?: { amount?: string; asset?: string; code?: string };
  };
  return (
    <div style={{ marginTop: 12 }}>
      <p className="mono" style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
        <span style={{ color: "var(--accent)" }}>{stellar.network}</span> → {stellar.payTo}
      </p>
      <div className="table-container" style={{ margin: 0 }}>
        <table>
          <thead>
            <tr><th>Ativo</th><th>Valor</th><th>Contrato</th></tr>
          </thead>
          <tbody>
            {[stellar.usdc, stellar.xlm].filter(Boolean).map((row) => (
              <tr key={row?.code}>
                <td style={{ fontWeight: 600 }}>{row?.code}</td>
                <td className="mono" style={{ color: "var(--good)" }}>{formatStellarAmount(row?.amount)}</td>
                <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{row?.asset}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatStellarAmount(atomic: string | undefined): string {
  if (!atomic) return "—";
  try {
    const whole = BigInt(atomic);
    const units = whole / 10_000_000n;
    const frac = (whole % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
    return frac ? `${units}.${frac}` : `${units}`;
  } catch {
    return atomic;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  const copy = useCallback(async () => {
    const done = await copyText(text);
    setState(done ? "done" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  }, [text]);

  return (
    <button type="button" className="copy" onClick={() => void copy()}>
      {state === "done" ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--good)" }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copiado!
        </>
      ) : state === "failed" ? (
        "Copie à mão"
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the textarea below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

function PixQr({ brCode }: { brCode: string }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    QRCode.toDataURL(brCode, { errorCorrectionLevel: "M", margin: 1, width: 280 })
      .then((url) => {
        if (!stopped) setSrc(url);
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, [brCode]);

  if (failed) return <p className="muted">Não consegui desenhar o QR. Use o código Pix abaixo.</p>;
  if (!src) return <p className="muted">Gerando QR Code Pix…</p>;
  return (
    <div className="qr-container">
      <div className="qr-frame">
        <img src={src} alt="QR Code do Pix" width={280} height={280} />
      </div>
    </div>
  );
}

function walletTerms(offerId: string, stellar: unknown): string {
  return JSON.stringify({ offerId, stellar }, null, 2);
}

function WalletPayment({ offerId }: { offerId: string }) {
  const [open, setOpen] = useState(false);
  const [payment, setPayment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  const send = async () => {
    setState("sending");
    setError("");
    try {
      const answer = await payOffer(offerId, payment.trim());
      if (answer.status === 200) {
        setState("done");
        return;
      }
      setError(String(answer.body["error"] ?? `erro ${answer.status}`));
      setState("idle");
    } catch {
      setError("Não consegui falar com o gateway.");
      setState("idle");
    }
  };

  if (state === "done") {
    return <p className="status-paid" style={{ marginTop: 12 }}>✓ Pagamento aceito pelo gateway. Atualizando status…</p>;
  }

  if (!open) {
    return (
      <button type="button" className="copy" onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
          <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
          <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
        </svg>
        Pagar com a Carteira
      </button>
    );
  }

  return (
    <div className="wallet">
      <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
        Assine os termos acima na sua carteira cripto e cole aqui o header
        <span className="mono" style={{ color: "var(--accent)" }}> PAYMENT-SIGNATURE</span>:
      </p>
      <textarea
        className="mono"
        rows={4}
        value={payment}
        onChange={(event) => setPayment(event.target.value)}
        placeholder="eyJ4NDAyVmVyc2lvbiI6Mi..."
      />
      {error && <p className="banner bad">{error}</p>}
      <button
        type="button"
        className="copy"
        disabled={state === "sending" || payment.trim().length === 0}
        onClick={() => void send()}
      >
        {state === "sending" ? "Enviando assinatura…" : "Enviar Pagamento Assinado"}
      </button>
    </div>
  );
}

function Checkout({ offerId }: { offerId: string }) {
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const tick = async () => {
      try {
        const response = await publicGet(`/awall/offers/${offerId}`);
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!stopped) {
          setStatus(response.status);
          setBody(json);
          setError("");
          if (response.status === 202) timer = window.setTimeout(() => void tick(), 2000);
        }
      } catch {
        if (!stopped) setError("Não consegui estabelecer comunicação com o gateway.");
      }
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [offerId]);

  const paid = status === 200;
  const brCode = typeof body?.["brCode"] === "string" ? body["brCode"] : "";
  const expired = status === 410;

  return (
    <div className="pay-layout">
      <div className="pay-card">
        <div className="pay-header">
          <h1 className="mark">
            AWall<span className="mark-dot">.</span>
            <span className="brand-badge">TERMINAL DE CHECKOUT</span>
          </h1>
          <div className="offer-chip">
            <span>OFFER</span>
            <span style={{ color: "var(--accent)" }}>{offerId}</span>
          </div>
        </div>

        {error && <p className="banner bad">{error}</p>}
        {!body && !error && <p className="empty">Consultando liquidação no gateway…</p>}
        {paid && (
          <div className="banner" style={{ background: "rgba(52, 211, 153, 0.1)", borderColor: "var(--good-border)", color: "var(--good)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div>
              <strong>Pagamento Confirmado!</strong>
              <div style={{ fontSize: 13, marginTop: 2 }}>
                {String(body?.["creditedCredits"] ?? "")} créditos creditados com sucesso. O agente autônomo já pode retomar a requisição.
              </div>
            </div>
          </div>
        )}
        {expired && (
          <div className="banner bad">
            Essa cobrança expirou. Por favor, reenvie a chamada para obter uma nova oferta x402.
          </div>
        )}

        {status === 202 && (
          <div className="checkout-grid">
            <section className="checkout-panel rail-stellar">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="status-wait">
                  <span className="pulse-beacon" />
                  Trilho cripto (USDC / moeda nativa)
                </span>
                <span className="pill stellar">AUTÔNOMO</span>
              </div>
              <p style={{ color: "var(--text-2)", fontSize: 13, margin: "0 0 12px" }}>
                Pacote de <strong style={{ color: "var(--text-pure)" }}>{String(body?.["packCredits"] ?? "—")} créditos</strong>. Pague diretamente com a carteira em um dos dois ativos.
              </p>
              {stellarRow(body?.["stellar"])}
              {body?.["stellar"] ? (
                <div style={{ marginTop: 14 }}>
                  <CopyButton
                    text={walletTerms(offerId, body["stellar"])}
                    label="Copiar termos cripto para carteira"
                  />
                  <WalletPayment offerId={offerId} />
                </div>
              ) : null}
            </section>

            <section className="checkout-panel rail-pix">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="status-wait">
                  <span className="pulse-beacon" />
                  Pix Rail (Instantâneo BR)
                </span>
                <span className="pill pix">HUMANO NO CIRCUITO</span>
              </div>
              {brCode ? (
                <>
                  <PixQr brCode={brCode} />
                  <div className="br-box">{brCode}</div>
                  <CopyButton text={brCode} label="Copiar Código Pix (Copia e Cola)" />
                </>
              ) : (
                <p className="empty" style={{ padding: "16px 0" }}>O código Pix aparecerá aqui assim que gerado pelo provedor.</p>
              )}
              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-2)" }}>
                <span>Valor:</span>
                <strong style={{ color: "var(--text-pure)" }}>R$ {(Number(body?.["amountCents"] ?? 0) / 100).toFixed(2)}</strong>
              </div>
            </section>
          </div>
        )}

        {status === 404 && <p className="banner bad">Offer desconhecida ou não encontrada.</p>}
        <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
          GATEWAY: {gatewayUrl()}
        </div>
      </div>
    </div>
  );
}
