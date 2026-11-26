import { useEffect, useMemo, useState } from "react";
import { admin, gatewayUrl, publicGet, streamUrl, type LiveEvent } from "./api";

const TABS = [
  ["live", "Ao vivo"],
  ["requests", "Requisições"],
  ["revenue", "Receita"],
  ["identities", "Identidades"],
  ["payments", "Pagamentos"],
  ["policy", "Política"],
  ["health", "Saúde"],
] as const;

type Tab = (typeof TABS)[number][0] | "identity" | "pay";

type Location = { tab: Tab; offerId?: string; identityId?: string };

function readLocation(): Location {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const pay = /^\/pay\/([^/]+)$/.exec(path);
  if (pay?.[1]) return { tab: "pay", offerId: decodeURIComponent(pay[1]) };
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
  const [token, setToken] = useState(() => sessionStorage.getItem("awall-admin") ?? "");

  useEffect(() => {
    const sync = () => setLocation(readLocation());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  if (location.tab === "pay" && location.offerId) {
    return <Checkout offerId={location.offerId} />;
  }

  return (
    <div className="app">
      <aside className="side">
        <h1 className="mark">A<span>Wall</span></h1>
        <p>O 402 no lugar do 429. Quem opera a API vê o consumo e a receita aqui.</p>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} aria-current={location.tab === id ? "page" : undefined} onClick={() => go(`/${id}`)}>
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <TokenBar token={token} onToken={setToken} />
        {location.tab === "live" && <Live token={token} />}
        {location.tab === "requests" && <Requests token={token} />}
        {location.tab === "revenue" && <Revenue token={token} />}
        {location.tab === "identities" && <Identities token={token} />}
        {location.tab === "identity" && location.identityId && <IdentityDetail token={token} id={location.identityId} />}
        {location.tab === "payments" && <Payments token={token} />}
        {location.tab === "policy" && <Policy token={token} />}
        {location.tab === "health" && <Health token={token} />}
      </main>
    </div>
  );
}

function TokenBar({ token, onToken }: { token: string; onToken: (value: string) => void }) {
  const [draft, setDraft] = useState(token);
  return (
    <form
      className="token"
      onSubmit={(event) => {
        event.preventDefault();
        sessionStorage.setItem("awall-admin", draft);
        onToken(draft);
      }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Token de administrador"
        autoComplete="off"
        aria-label="Token de administrador"
      />
      <button className="primary" type="submit">Entrar</button>
    </form>
  );
}

function useAdmin<T>(token: string, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setData(null);
      setError("Informe o token. Sem ele o gateway responde 401.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    admin(path, token)
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
  }, [token, path]);

  return { data, error, loading };
}

function Live({ token }: { token: string }) {
  const [rows, setRows] = useState<LiveEvent[]>([]);
  const [decision, setDecision] = useState("");
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const source = new EventSource(streamUrl(token));
    const onEvent = (event: MessageEvent) => {
      const parsed = JSON.parse(event.data) as LiveEvent;
      setRows((current) => [parsed, ...current].slice(0, 80));
    };
    source.addEventListener("request", onEvent);
    source.addEventListener("payment", onEvent);
    source.onerror = () => setError("A conexão ao vivo caiu. Confira o token e se o gateway está no ar.");
    return () => source.close();
  }, [token]);

  const visible = rows.filter((row) => {
    if (decision && row.decision !== decision) return false;
    if (identity && !row.identityId.includes(identity)) return false;
    return true;
  });

  return (
    <section>
      <h1>Ao vivo</h1>
      <p className="lede">Cada requisição e cada pagamento, assim que o gateway decide.</p>
      {!token && <p className="banner">Informe o token para abrir o fluxo.</p>}
      {error && <p className="banner bad">{error}</p>}
      <div className="filters">
        <input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="Filtrar identidade" aria-label="Filtrar identidade" />
        <select value={decision} onChange={(event) => setDecision(event.target.value)} aria-label="Filtrar decisão">
          <option value="">Todas as decisões</option>
          <option value="allow_free">allow_free</option>
          <option value="allow_credit">allow_credit</option>
          <option value="payment_required">payment_required</option>
          <option value="refunded">refunded</option>
        </select>
      </div>
      {visible.length === 0 ? <p className="empty">Nada ainda. Faça uma chamada no gateway e ela aparece aqui.</p> : (
        <table>
          <thead>
            <tr><th>Quando</th><th>Identidade</th><th>Rota</th><th>Decisão</th><th>Créditos</th><th>Status</th><th>ms</th></tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={`${row.at}-${index}`}>
                <td className="mono">{row.at.slice(11, 19)}</td>
                <td className="mono">{row.identityId}</td>
                <td>{row.type === "payment" ? `pagamento ${row.rail ?? ""}` : row.route}</td>
                <td>{row.decision ?? row.rail}</td>
                <td>{row.credits ?? row.creditedCredits ?? ""}</td>
                <td>{row.originStatus ?? ""}</td>
                <td>{row.latencyMs ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Requests({ token }: { token: string }) {
  const { data, error, loading } = useAdmin<{ rollups: Record<string, unknown>[] }>(token, "/awall/usage/rollups");
  const rollups = data?.rollups ?? [];
  return (
    <section>
      <h1>Requisições</h1>
      <p className="lede">Agregado por identidade, rota e hora. O detalhe cru fica só no ao vivo.</p>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {!loading && !error && rollups.length === 0 && <p className="empty">Nenhum agregado nesta janela.</p>}
      {rollups.length > 0 && (
        <table>
          <thead>
            <tr><th>Hora</th><th>Identidade</th><th>Rota</th><th>Pedidos</th><th>Créditos</th><th>Pagos</th></tr>
          </thead>
          <tbody>
            {rollups.map((row, index) => (
              <tr key={index}>
                <td className="mono">{String(row["hour"] ?? "")}</td>
                <td className="mono">{String(row["identityId"] ?? "")}</td>
                <td>{String(row["route"] ?? "")}</td>
                <td>{String(row["requests"] ?? "")}</td>
                <td>{String(row["credits"] ?? "")}</td>
                <td>{String(row["paidCredits"] ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Revenue({ token }: { token: string }) {
  const { data, error, loading } = useAdmin<Summary>(token, "/awall/stats/summary?window=24h");
  return (
    <section>
      <h1>Receita</h1>
      <p className="lede">Últimas 24 horas. Requisição recuperada é a que teria sido 429 e foi atendida depois do pagamento.</p>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && (
        <div className="cards">
          <article className="card"><span>Recuperadas</span><strong>{data.recoveredRequests}</strong></article>
          <article className="card"><span>Pedidos</span><strong>{data.requests}</strong></article>
          <article className="card"><span>Créditos</span><strong>{data.credits}</strong></article>
          <article className="card">
            <span>USDC liquidado</span>
            <strong>{atomic(railAmount(data.revenue, "exact"))}</strong>
          </article>
          <article className="card">
            <span>Pix (centavos)</span>
            <strong>{railAmount(data.revenue, "pix")}</strong>
          </article>
          <article className="card">
            <span>Infra estimada (USD)</span>
            <strong>{data.infra.estimatedUsd.toFixed(4)}</strong>
          </article>
        </div>
      )}
      {data && <p className="muted">Multiplicador médio de abuso: {data.abuse.avgMultiplier.toFixed(2)}</p>}
    </section>
  );
}

type Summary = {
  requests: number;
  recoveredRequests: number;
  credits: number;
  revenue: { rail: string; count: number; amount: string }[];
  infra: { estimatedUsd: number };
  abuse: { avgMultiplier: number };
};

function railAmount(rows: Summary["revenue"], rail: string): string {
  return rows.find((row) => row.rail === rail)?.amount ?? "0";
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

function Identities({ token }: { token: string }) {
  const { data, error, loading } = useAdmin<{ identities: Identity[] }>(token, "/awall/identities");
  const rows = data?.identities ?? [];
  return (
    <section>
      <h1>Identidades</h1>
      <p className="lede">Saldo, escore e o preço que essa identidade paga agora.</p>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="empty">Ninguém passou pelo gateway ainda.</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr><th>Id</th><th>Tipo</th><th>Saldo</th><th>Abuso</th><th>Preço</th><th>Visto</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><button className="row-link" onClick={() => go(`/identities/${row.id}`)}>{row.id}</button></td>
                <td>{row.kind}</td>
                <td>{row.creditBalance}</td>
                <td>{row.abuseScore.toFixed(2)}</td>
                <td>{row.multiplier.toFixed(2)}×</td>
                <td className="mono">{row.lastSeenAt.slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function IdentityDetail({ token, id }: { token: string; id: string }) {
  const { data, error, loading } = useAdmin<{ identity: Identity; ledger: Record<string, unknown>[]; payments: Record<string, unknown>[] }>(
    token,
    `/awall/identities/${id}`,
  );
  return (
    <section>
      <button className="row-link" onClick={() => go("/identities")}>Voltar</button>
      <h1>{id}</h1>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && <p className="lede">Saldo {data.identity.creditBalance} créditos. Multiplicador {data.identity.multiplier.toFixed(2)}×.</p>}
      {data && data.ledger.length === 0 && <p className="empty">Extrato vazio.</p>}
      {data && data.ledger.length > 0 && (
        <table>
          <thead><tr><th>Quando</th><th>Motivo</th><th>Delta</th></tr></thead>
          <tbody>
            {data.ledger.map((row, index) => (
              <tr key={index}>
                <td className="mono">{String(row["createdAt"] ?? "")}</td>
                <td>{String(row["reason"] ?? "")}</td>
                <td>{String(row["deltaCredits"] ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Payments({ token }: { token: string }) {
  const { data, error, loading } = useAdmin<{ payments: Record<string, unknown>[]; offers: Record<string, unknown>[] }>(token, "/awall/payments");
  const payments = data?.payments ?? [];
  const offers = data?.offers ?? [];
  return (
    <section>
      <h1>Pagamentos</h1>
      <p className="lede">Todo crédito concedido precisa de um pagamento rastreável.</p>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {!loading && !error && payments.length === 0 && offers.length === 0 && <p className="empty">Nenhuma offer ainda.</p>}
      {offers.length > 0 && (
        <table>
          <thead><tr><th>Offer</th><th>Status</th><th>USDC</th><th>XLM</th><th>Centavos</th><th>Pacote</th></tr></thead>
          <tbody>
            {offers.map((row) => (
              <tr key={String(row["id"])}>
                <td className="mono">{String(row["id"])}</td>
                <td>{String(row["status"])}</td>
                <td className="mono">{formatStellarAmount(String(row["priceUsdcAtomic"] ?? ""))}</td>
                <td className="mono">{formatStellarAmount(String(row["priceXlmAtomic"] ?? ""))}</td>
                <td>{String(row["priceBrlCents"])}</td>
                <td>{String(row["packCredits"])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Policy({ token }: { token: string }) {
  const { data, error, loading } = useAdmin<{ source: string; policy: unknown; versions: { id: string; appliedBy: string; createdAt: string }[] }>(token, "/awall/policy");
  const original = useMemo(() => (data ? JSON.stringify(data.policy, null, 2) : ""), [data]);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setDraft(original), [original]);

  async function apply() {
    setMessage("");
    const response = await admin("/awall/policy", token, {
      method: "PUT",
      headers: { "x-awall-actor": "console" },
      body: draft,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(`Recusado (${response.status}). O schema da política não aceitou o JSON.`);
      return;
    }
    setConfirming(false);
    setMessage(`Aplicada. Versão ${String((body as { version?: { id?: string } }).version?.id ?? "")}. Vale na próxima requisição.`);
  }

  return (
    <section>
      <h1>Política</h1>
      <p className="lede">Origem atual: {data?.source ?? "…"}. A alteração passa a valer sem reiniciar.</p>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && (
        <>
          <textarea className="json" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Política em JSON" spellCheck={false} />
          <p>
            <button className="primary" type="button" onClick={() => setConfirming(true)} disabled={draft === original}>
              Revisar alteração
            </button>
          </p>
          {confirming && (
            <div className="panel">
              <p>Confira o que muda antes de aplicar.</p>
              <div className="diff">
                <pre>{original}</pre>
                <pre>{draft}</pre>
              </div>
              <button className="primary" type="button" onClick={() => void apply()}>Aplicar</button>
            </div>
          )}
          {message && <p className="banner">{message}</p>}
          <h2>Histórico</h2>
          {data.versions.length === 0 ? <p className="empty">Nenhuma versão gravada. O YAML de boot ainda é a política.</p> : (
            <ul>
              {data.versions.map((version) => (
                <li key={version.id}><span className="mono">{version.id}</span> por {version.appliedBy} em {version.createdAt}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Health({ token }: { token: string }) {
  const { data, error, loading } = useAdmin<Record<string, unknown>>(token, "/awall/health/checks");
  return (
    <section>
      <h1>Saúde</h1>
      <p className="lede">Facilitator, Pix e a conta de recebimento, antes do cliente reclamar.</p>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="banner bad">{error}</p>}
      {data && <pre className="panel">{JSON.stringify(data, null, 2)}</pre>}
    </section>
  );
}

function stellarRow(value: unknown) {
  if (!value || typeof value !== "object") {
    return <p className="muted">Termos Stellar ainda não chegaram.</p>;
  }
  const stellar = value as {
    network?: string;
    payTo?: string;
    usdc?: { amount?: string; asset?: string; code?: string };
    xlm?: { amount?: string; asset?: string; code?: string };
  };
  return (
    <div>
      <p className="mono muted">{stellar.network} → {stellar.payTo}</p>
      <table>
        <thead>
          <tr><th>Ativo</th><th>Valor</th><th>Contrato</th></tr>
        </thead>
        <tbody>
          {[stellar.usdc, stellar.xlm].filter(Boolean).map((row) => (
            <tr key={row?.code}>
              <td>{row?.code}</td>
              <td className="mono">{formatStellarAmount(row?.amount)}</td>
              <td className="mono">{row?.asset}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        if (stopped) return;
        setStatus(response.status);
        setBody(json);
        setError("");
        if (response.status === 202) timer = window.setTimeout(() => void tick(), 2000);
      } catch {
        if (!stopped) setError("Não consegui falar com o gateway.");
      }
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [offerId]);

  const paid = status === 200;
  const expired = status === 410;
  return (
    <main className="pay">
      <h1 className="mark">A<span>Wall</span></h1>
      <p className="lede">Pagamento da offer <span className="mono">{offerId}</span></p>
      {error && <p className="banner bad">{error}</p>}
      {!body && !error && <p className="empty">Consultando o gateway…</p>}
      {paid && <p className="status-paid">Pago. {String(body?.["creditedCredits"] ?? "")} créditos na conta. Pode voltar ao agente.</p>}
      {expired && <p className="banner bad">Essa cobrança expirou. Faça a chamada de novo para gerar outra.</p>}
      {status === 202 && (
        <>
          <section className="panel">
            <p className="status-wait">Stellar (USDC ou XLM)</p>
            <p className="muted">
              Pacote de {String(body?.["packCredits"] ?? "—")} créditos. Pague com a carteira
              do agente em um dos dois ativos; o mesmo pacote é creditado.
            </p>
            {stellarRow(body?.["stellar"])}
          </section>
          <section className="panel">
            <p className="status-wait">Pix</p>
            {body?.["brCode"] ? <p className="br mono">{String(body["brCode"])}</p> : <p>O código Pix aparece aqui quando a cobrança é criada.</p>}
            <p className="muted">Valor em centavos: {String(body?.["amountCents"] ?? "—")}</p>
          </section>
        </>
      )}
      {status === 404 && <p className="banner bad">Offer desconhecida.</p>}
      <p className="muted">Gateway {gatewayUrl()}</p>
    </main>
  );
}
