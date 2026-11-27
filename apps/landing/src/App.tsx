import { useEffect, useRef, useState, type ReactNode } from "react";
import { CodeBlock } from "./CodeBlock.js";
import { ConsolePreview } from "./ConsolePreview.js";
import {
  COPY,
  REPO_URL,
  SAMPLE_402_JSON,
  SAMPLE_AWALL_YAML,
  SNIPPET_EXACT_STELLAR,
  SNIPPET_PIX,
  initialLang,
  type Lang,
} from "./i18n.js";
import {
  computePackQuote,
  formatBrlDisplay,
  formatStellarDisplay,
  type SignalInputs,
} from "./pricing.js";

type RailTab = "m2m" | "pix" | "full";
type WireMode = "awall" | "legacy";

const PRESETS: Record<"clean" | "retry" | "scraper", SignalInputs> = {
  clean: { burst: 0, identical: 0, errors: 0, cache: 0 },
  retry: { burst: 0.22, identical: 0.3, errors: 0.1, cache: 0.1 },
  scraper: { burst: 1, identical: 1, errors: 1, cache: 1 },
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to hidden textarea below when clipboard permission is unavailable.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({
  text,
  copyLabel,
  copiedLabel,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button type="button" className="btn sm quiet" onClick={() => void onCopy()}>
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--ok)" }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}

function BrandWordmark() {
  return (
    <a className="brand" href="#top">
      <span className="brand-mark" aria-hidden="true">
        <svg
          width="14"
          height="14"
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
    </a>
  );
}

function ThesisIcon({ index }: { index: string }) {
  if (index === "01") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  }
  if (index === "02") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function WireTrace({ mode }: { mode: WireMode }) {
  if (mode === "legacy") {
    return (
      <pre className="wire-pre">
        <code>
          <span className="tok-cmd">$ curl -i -H &quot;x-api-key: demo&quot; /v1/search?q=camera</span>
          {"\n\n"}
          <span className="tok-429">HTTP/1.1 429 Too Many Requests</span>
          {"\n"}
          <span className="tok-hdr">Retry-After:</span> 60{"\n"}
          <span className="tok-hdr">Content-Type:</span> application/json{"\n\n"}
          {`{\n  "error": "rate_limit_exceeded",\n  "message": "Try again later."\n}`}
        </code>
      </pre>
    );
  }

  return (
    <pre className="wire-pre">
      <code>
        <span className="tok-cmd">$ curl -i -H &quot;x-api-key: demo&quot; /v1/search?q=camera</span>
        {"\n\n"}
        <span className="tok-402">HTTP/1.1 402 Payment Required</span>
        {"\n"}
        <span className="tok-hdr">PAYMENT-REQUIRED:</span> eyJ4NDAyVmVyc2lvbiI6Miwi...{"\n"}
        <span className="tok-hdr">X-AWall-Identity:</span> idt_k_2a97516c354b6884{"\n"}
        <span className="tok-hdr">X-AWall-Cost-Credits:</span> 1{"\n"}
        <span className="tok-hdr">X-AWall-Price-Multiplier:</span> 1.00{"\n\n"}
        <span className="tok-dim"># Agent signs Stellar auth entries (or human pays Pix) &amp; retries</span>
        {"\n"}
        <span className="tok-cmd">$ curl -H &quot;PAYMENT-SIGNATURE: eyJ4NDAy...&quot; /v1/search?q=camera</span>
        {"\n\n"}
        <span className="tok-200">HTTP/1.1 200 OK</span>
        {"\n"}
        <span className="tok-hdr">PAYMENT-RESPONSE:</span> eyJzdWNjZXNzIjp0cnVl...{"\n"}
        <span className="tok-hdr">X-AWall-Credits-Remaining:</span> 9999
      </code>
    </pre>
  );
}

function RevealSection({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id={id}
      ref={ref}
      className={visible ? "section reveal is-visible" : "section reveal"}
    >
      {children}
    </section>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="arch-edge" aria-hidden="true">
      <span className="arch-edge-label">{label}</span>
      <svg width="36" height="14" viewBox="0 0 36 14" fill="none">
        <line x1="0" y1="7" x2="30" y2="7" stroke="currentColor" strokeWidth="1.5" />
        <polyline points="26 2 32 7 26 12" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [wireMode, setWireMode] = useState<WireMode>("awall");
  const [railTab, setRailTab] = useState<RailTab>("m2m");
  const [quickTab, setQuickTab] = useState<string>("dev");
  const [signals, setSignals] = useState<SignalInputs>(PRESETS.retry);
  const [activeStage, setActiveStage] = useState<number>(0);

  const t = COPY[lang];
  const quote = computePackQuote(signals);
  const activeQuick = t.quickstart.tabs.find((tab) => tab.id === quickTab) ?? t.quickstart.tabs[0]!;

  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    document.title = t.metaTitle;
    try {
      window.localStorage.setItem("awall_landing_lang", lang);
    } catch {
      // Ignore storage errors.
    }
  }, [lang, t.metaTitle]);

  const setSignal = (key: keyof SignalInputs, value: number) => {
    setSignals((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div id="top">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <BrandWordmark />
          <nav className="nav-links" aria-label="Primary">
            <a href="#rails">{t.nav.rails}</a>
            <a href="#architecture">{t.nav.architecture}</a>
            <a href="#pricing">{t.nav.pricing}</a>
            <a href="#quickstart">{t.nav.quickstart}</a>
            <a href="#console-preview">{t.nav.consolePreview}</a>
          </nav>
          <div className="nav-actions">
            <div className="lang-switch" role="group" aria-label="Language">
              <button type="button" aria-pressed={lang === "pt"} onClick={() => setLang("pt")}>
                PT
              </button>
              <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                EN
              </button>
            </div>
            <a className="btn sm quiet" href={REPO_URL} target="_blank" rel="noreferrer">
              {t.nav.github}
            </a>
            <a className="btn sm" href="/landing">
              {t.nav.home}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="wrap hero-grid">
            <div className="hero-stagger">
              <span className="hero-kicker">
                <span className="live-dot ok" />
                {t.hero.kicker}
              </span>
              <h1>
                <span className="hero-code-402">402 Payment Required</span>
                {lang === "pt" ? " no lugar do " : " instead of "}
                <span className="hero-code-429">429</span>.
              </h1>
              <p className="hero-lead">{t.hero.subtitle}</p>
              <div className="hero-ctas">
                <a className="btn primary" href="#rails">
                  {t.hero.ctaPrimary}
                </a>
                <a className="btn" href="#console-preview">
                  {t.nav.consolePreview}
                </a>
                <a className="btn quiet" href="#quickstart">
                  {t.hero.ctaSecondary}
                </a>
              </div>
              <div className="meta-grid">
                {t.hero.meta.map((item) => (
                  <div className="meta-cell" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="wire-box hero-stagger">
              <div className="wire-header">
                <div className="wire-chrome">
                  <span className="win-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <div className="wire-tabs" role="tablist" aria-label="HTTP flow">
                    <button
                      type="button"
                      role="tab"
                      className="wire-tab"
                      aria-selected={wireMode === "awall"}
                      onClick={() => setWireMode("awall")}
                    >
                      {t.hero.terminal.tabAwall}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className="wire-tab"
                      aria-selected={wireMode === "legacy"}
                      onClick={() => setWireMode("legacy")}
                    >
                      {t.hero.terminal.tabLegacy}
                    </button>
                  </div>
                </div>
                <span className={wireMode === "awall" ? "wire-badge ok" : "wire-badge err"}>
                  {wireMode === "awall" ? "402 → 200 OK" : "429 BLOCKED"}
                </span>
              </div>
              <div key={wireMode} className="panel-animate">
                <WireTrace mode={wireMode} />
              </div>
              <div className="wire-foot">
                {wireMode === "awall" ? t.hero.terminal.captionAwall : t.hero.terminal.captionLegacy}
              </div>
            </div>
          </div>
        </section>

        <RevealSection>
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">{t.thesis.kicker}</span>
              <h2>{t.thesis.title}</h2>
              <p>{t.thesis.subtitle}</p>
            </div>
            <div className="matrix-3">
              {t.thesis.items.map((item) => (
                <article className="matrix-cell" key={item.index}>
                  <div className="matrix-top">
                    <span className="matrix-icon">
                      <ThesisIcon index={item.index} />
                    </span>
                    <span className="matrix-index">{item.index}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </RevealSection>

        <RevealSection id="rails">
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">{t.rails.kicker}</span>
              <h2>{t.rails.title}</h2>
              <p>{t.rails.subtitle}</p>
            </div>

            <div className="seg-tabs" role="tablist" aria-label={t.rails.title}>
              <button
                type="button"
                role="tab"
                aria-selected={railTab === "m2m"}
                onClick={() => setRailTab("m2m")}
              >
                {t.rails.tabM2m}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={railTab === "pix"}
                onClick={() => setRailTab("pix")}
              >
                {t.rails.tabPix}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={railTab === "full"}
                onClick={() => setRailTab("full")}
              >
                {t.rails.tabFull}
              </button>
            </div>

            {railTab !== "full" && (
              <div className="rail-wire-strip" aria-hidden="true">
                <span className="wire-node">
                  {railTab === "m2m" ? "Agent (@x402/fetch)" : "Assisted Agent + Browser"}
                </span>
                <span className="wire-arrow">── 402 PAYMENT-REQUIRED ──▶</span>
                <span className="wire-node accent">
                  {railTab === "m2m" ? "Stellar Soroban (/settle)" : "AbacatePay + /pay/:offerId"}
                </span>
                <span className="wire-arrow">── credit_ledger ──▶</span>
                <span className="wire-node ok">200 OK · Origin API</span>
              </div>
            )}

            {railTab === "full" ? (
              <div key="full" className="rail-split panel-animate" role="tabpanel">
                <div className="rail-intro">
                  <h3>{t.rails.full.title}</h3>
                  <p>{t.rails.full.summary}</p>
                  <ul className="bullet-notes">
                    {t.rails.full.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
                <div className="code-frame">
                  <div className="code-bar">
                    <span>{t.rails.full.snippetTitle}</span>
                    <span>x402 v2</span>
                  </div>
                  <CodeBlock code={SAMPLE_402_JSON} lang="json" />
                </div>
              </div>
            ) : (
              (() => {
                const active = railTab === "m2m" ? t.rails.m2m : t.rails.pix;
                const snippet = railTab === "m2m" ? SNIPPET_EXACT_STELLAR : SNIPPET_PIX;
                return (
                  <div key={railTab} className="rail-split panel-animate" role="tabpanel">
                    <div>
                      <div className="rail-intro">
                        <h3>{active.title}</h3>
                        <p>{active.summary}</p>
                      </div>
                      <ol className="timeline">
                        {active.steps.map((item) => (
                          <li key={item.step}>
                            <span className="timeline-step" aria-hidden="true" />
                            <span className="timeline-label">STEP {item.step}</span>
                            <h4>{item.title}</h4>
                            <p>{item.detail}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <div className="code-frame">
                        <div className="code-bar">
                          <span>{active.snippetTitle}</span>
                          <span className="syn-str">
                            {railTab === "m2m" ? "stellar:testnet" : "pix:bcb"}
                          </span>
                        </div>
                        <CodeBlock code={snippet} lang="json" />
                      </div>
                      <div className="spec-grid">
                        {active.specs.map((spec) => (
                          <div className="spec-cell" key={spec.label}>
                            <span>{spec.label}</span>
                            <strong>{spec.value}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </RevealSection>

        <RevealSection id="architecture">
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">{t.architecture.kicker}</span>
              <h2>{t.architecture.title}</h2>
              <p>{t.architecture.subtitle}</p>
            </div>

            <div className="arch-diagram-v2">
              <div className="arch-col">
                <div className="arch-col-title">{t.architecture.diagram.clientsTitle}</div>
                {t.architecture.diagram.clients.map((node) => (
                  <div className="arch-node" key={node}>
                    {node}
                  </div>
                ))}
              </div>
              <FlowArrow label="HTTP / ForwardAuth" />
              <div className="arch-col core">
                <div className="arch-col-title">{t.architecture.diagram.gatewayTitle}</div>
                {t.architecture.diagram.gatewaySteps.map((step, idx) => (
                  <button
                    key={step}
                    type="button"
                    className={activeStage === idx ? "arch-node btn-node active" : "arch-node btn-node"}
                    onClick={() => setActiveStage(idx)}
                  >
                    {step}
                  </button>
                ))}
              </div>
              <FlowArrow label="Proxy / Settle" />
              <div className="arch-col">
                <div className="arch-col-title">{t.architecture.diagram.backendsTitle}</div>
                {t.architecture.diagram.backends.map((node) => (
                  <div className="arch-node" key={node}>
                    {node}
                  </div>
                ))}
              </div>
            </div>

            <div className="stages-grid">
              {t.architecture.stages.map((stage, idx) => (
                <article
                  className={activeStage === idx ? "stage-cell active" : "stage-cell"}
                  key={stage.num}
                  onMouseEnter={() => setActiveStage(idx)}
                >
                  <div className="stage-meta">
                    <span>{stage.num}</span>
                    <span>{stage.pkg}</span>
                  </div>
                  <h3>{stage.name}</h3>
                  <p>{stage.desc}</p>
                </article>
              ))}
            </div>

            <div className="arch-bottom">
              <div className="code-frame">
                <div className="code-bar">
                  <span>awall.yaml</span>
                  <span>{t.architecture.yamlDesc}</span>
                </div>
                <CodeBlock code={SAMPLE_AWALL_YAML} lang="yaml" />
              </div>
              <div className="invariants-box">
                <div className="invariants-head">{t.architecture.guaranteesTitle}</div>
                {t.architecture.guarantees.map((item) => (
                  <div className="invariant-row" key={item.rule}>
                    <strong>{item.rule}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </RevealSection>

        <RevealSection id="pricing">
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">{t.abusePricing.kicker}</span>
              <h2>{t.abusePricing.title}</h2>
              <p>{t.abusePricing.subtitle}</p>
            </div>

            <div className="sim-layout">
              <div>
                <div className="preset-bar">
                  <span>{t.abusePricing.presetsLabel}</span>
                  {t.abusePricing.presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="preset-btn"
                      onClick={() => setSignals(PRESETS[preset.id])}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="sliders">
                  {(["burst", "identical", "errors", "cache"] as const).map((key) => {
                    const meta = t.abusePricing.signals[key];
                    const value = signals[key];
                    const id = `signal-${key}`;
                    return (
                      <div className="slider-item" key={key}>
                        <div className="slider-head">
                          <label htmlFor={id}>{meta.label}</label>
                          <span>{value.toFixed(2)}</span>
                        </div>
                        <p>{meta.desc}</p>
                        <input
                          id={id}
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={value}
                          onChange={(event) => setSignal(key, Number(event.target.value))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="quote-box">
                <div className="quote-summary">
                  <div className="quote-stat">
                    <span>{t.abusePricing.labels.score}</span>
                    <strong style={{ color: "var(--accent)" }}>{quote.score.toFixed(2)}</strong>
                  </div>
                  <div className="quote-stat">
                    <span>{t.abusePricing.labels.multiplier}</span>
                    <strong style={{ color: quote.multiplier > 1.2 ? "var(--warn)" : "var(--ok)" }}>
                      {quote.multiplier.toFixed(2)}×
                    </strong>
                  </div>
                  <div className="quote-stat">
                    <span>{t.abusePricing.labels.pack}</span>
                    <strong>
                      {quote.packCredits.toLocaleString()} {t.abusePricing.labels.creditsUnit}
                    </strong>
                  </div>
                </div>

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.abusePricing.cols.rail}</th>
                      <th>{t.abusePricing.cols.asset}</th>
                      <th>{t.abusePricing.cols.display}</th>
                      <th>{t.abusePricing.cols.wire}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="mono">exact (Stellar)</td>
                      <td className="mono">USDC</td>
                      <td className="mono">{formatStellarDisplay(quote.usdcAtomic)} USDC</td>
                      <td className="mono syn-str">&quot;{quote.usdcAtomic}&quot;</td>
                    </tr>
                    <tr>
                      <td className="mono">exact (Stellar)</td>
                      <td className="mono">XLM</td>
                      <td className="mono">{formatStellarDisplay(quote.xlmAtomic)} XLM</td>
                      <td className="mono syn-str">&quot;{quote.xlmAtomic}&quot;</td>
                    </tr>
                    <tr>
                      <td className="mono">pix (AbacatePay)</td>
                      <td className="mono">BRL</td>
                      <td className="mono">
                        {formatBrlDisplay(quote.brlCents, lang === "pt" ? "," : ".")}
                      </td>
                      <td className="mono syn-str">&quot;{quote.brlCents}&quot;</td>
                    </tr>
                  </tbody>
                </table>

                <div className="quote-notes">
                  <span>{t.abusePricing.formulaNote}</span>
                  <span>{t.abusePricing.warmupNote}</span>
                </div>
              </div>
            </div>
          </div>
        </RevealSection>

        <RevealSection id="quickstart">
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">{t.quickstart.kicker}</span>
              <h2>{t.quickstart.title}</h2>
              <p>{t.quickstart.subtitle}</p>
            </div>

            <div className="quick-box">
              <div className="quick-head">
                <div className="wire-tabs" role="tablist" aria-label={t.quickstart.title}>
                  {t.quickstart.tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      className="wire-tab"
                      aria-selected={activeQuick.id === tab.id}
                      onClick={() => setQuickTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <CopyButton
                  text={activeQuick.cmd}
                  copyLabel={t.quickstart.copyLabel}
                  copiedLabel={t.quickstart.copiedLabel}
                />
              </div>
              <div key={activeQuick.id} className="panel-animate">
                <p className="quick-desc">{activeQuick.desc}</p>
                <CodeBlock code={activeQuick.cmd} lang="bash" />
              </div>
            </div>
          </div>
        </RevealSection>

        <ConsolePreview lang={lang} />
      </main>

      <footer className="footer">
        <div className="wrap footer-grid">
          <div>
            <BrandWordmark />
            <p className="footer-summary">{t.footer.summary}</p>
            <p className="footer-meta">{t.footer.meta}</p>
          </div>
          <div>
            <h4>{t.footer.appsTitle}</h4>
            <ul>
              {t.footer.apps.map((item) => (
                <li key={item.label}>
                  <a href={item.href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>{t.footer.docsTitle}</h4>
            <ul>
              {t.footer.docs.map((doc) => (
                <li key={doc.label}>
                  <a className="mono" style={{ fontSize: 12.5 }} href={doc.href} target="_blank" rel="noreferrer">
                    {doc.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
