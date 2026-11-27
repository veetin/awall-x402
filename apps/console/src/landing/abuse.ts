/**
 * "Quem abusa paga mais": an agent's traffic turns into a score, and the score
 * into a price multiplier. The scenarios are examples, not captured traffic.
 *
 * The multiplier and the price come from the same formulas as the gateway
 * (`abuseMultiplier` and `applyMultiplier` in sim.ts), and money is `bigint`.
 */

import { $$, fitCanvas, must, trackVisible } from "./dom";
import { POLICY, abuseMultiplier, applyMultiplier, formatBrl, formatStellar } from "./sim";

type Scenario = "calmo" | "rajada" | "repetidas" | "erros";
type Signals = { burst: number; repeats: number; errors: number };
type Particle = { x: number; y: number; speed: number; kind: "err" | "rep" | "ok" };

const TARGETS: Record<Scenario, Signals> = {
  calmo: { burst: 0.08, repeats: 0.05, errors: 0.04 },
  rajada: { burst: 0.95, repeats: 0.2, errors: 0.1 },
  repetidas: { burst: 0.3, repeats: 0.9, errors: 0.1 },
  erros: { burst: 0.2, repeats: 0.15, errors: 0.9 },
};
const AUTO_ORDER: readonly Scenario[] = ["calmo", "rajada", "calmo", "repetidas", "calmo", "erros"];

function isScenario(value: string | undefined): value is Scenario {
  return value !== undefined && Object.hasOwn(TARGETS, value);
}

/** Score the gateway would compute from the three signals, 0 to 1. */
function scoreOf(s: Signals): number {
  return Math.min(1, Math.max(s.burst, s.repeats, s.errors) * 0.85 + ((s.burst + s.repeats + s.errors) / 3) * 0.15);
}

function decimal(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function mountAbuse(root: HTMLElement, reduced: boolean): void {
  const canvas = must<HTMLCanvasElement>("canvas", root);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const stage = canvas.parentElement;
  if (!stage) return;

  const multiplierEl = must("[data-mult]", root);
  const priceEl = must("[data-price]", root);
  const burstBar = must<HTMLElement>('[data-sig="burst"]', root);
  const repeatsBar = must<HTMLElement>('[data-sig="repeats"]', root);
  const errorsBar = must<HTMLElement>('[data-sig="errors"]', root);
  const scoreBar = must<HTMLElement>("[data-score]", root);
  const scoreValue = must("[data-score-v]", root);
  const headers = must("[data-hdr]", root);
  const buttons = $$<HTMLButtonElement>("[data-scen]", root);

  let width = 0;
  let height = 0;
  const refit = (): void => {
    ({ width, height } = fitCanvas(canvas, ctx, stage));
  };
  new ResizeObserver(() => {
    refit();
    if (reduced) paint();
  }).observe(stage);
  refit();

  const view = trackVisible(root);
  let scenario: Scenario = "calmo";
  let auto = false;
  let autoTime = 0;
  let time = 0;
  let signals: Signals = { ...TARGETS.calmo };
  let score = 0;
  let particles: Particle[] = [];
  let emit = 0;

  for (const button of buttons) {
    button.addEventListener("click", () => {
      for (const other of buttons) other.classList.remove("on");
      button.classList.add("on");
      auto = button.dataset["scen"] === "auto";
      const chosen = button.dataset["scen"];
      if (!auto && isScenario(chosen)) scenario = chosen;
      autoTime = 0;
      if (reduced) {
        signals = { ...TARGETS[scenario] };
        score = scoreOf(signals);
        paint();
      }
    });
  }

  function advance(dt: number): void {
    time += dt;
    if (auto) {
      autoTime += dt;
      scenario = AUTO_ORDER[Math.floor(autoTime / 2.6) % AUTO_ORDER.length] ?? "calmo";
    }
    const target = TARGETS[scenario];
    const k = dt * 2.2;
    signals.burst += (target.burst - signals.burst) * k;
    signals.repeats += (target.repeats - signals.repeats) * k;
    signals.errors += (target.errors - signals.errors) * k;
    score += (scoreOf(signals) - score) * dt * 1.8;

    emit += (14 + signals.burst * 90 + signals.repeats * 25) * dt;
    const agentX = width * 0.1;
    const centerY = height * 0.6;
    while (emit >= 1) {
      emit -= 1;
      const roll = Math.random();
      const kind =
        roll < signals.errors * 0.6 ? "err" : roll < signals.errors * 0.6 + signals.repeats * 0.5 ? "rep" : "ok";
      particles.push({
        x: agentX,
        y: centerY + (kind === "rep" ? 0 : (Math.random() - 0.5) * 36),
        speed: (150 + Math.random() * 60) * (width / 600),
        kind,
      });
    }
    const wallX = width * 0.52;
    particles = particles.filter((p) => p.x < wallX - 2);
    for (const p of particles) p.x += p.speed * dt;
  }

  function paint(): void {
    if (!ctx) return;
    const agentX = width * 0.1;
    const wallX = width * 0.52;
    const centerY = height * 0.6;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    const glow = ctx.createRadialGradient(wallX, centerY, 0, wallX, centerY, height * 0.7);
    glow.addColorStop(
      0,
      `rgba(${Math.round(59 + 189 * score)},${Math.round(130 - 17 * score)},${Math.round(246 - 133 * score)},${0.1 + 0.12 * score})`,
    );
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 120; i += 1) {
      const angle = i * 2.399;
      const r = Math.sqrt(i / 120) * 20;
      ctx.fillStyle = "rgba(220,230,255,.55)";
      ctx.fillRect(agentX + Math.cos(angle + time * 0.3) * r, centerY + Math.sin(angle + time * 0.3) * r, 1.2, 1.2);
    }
    for (let i = 0; i < 260; i += 1) {
      const y = centerY - height * 0.32 + (((i * 37) % 260) / 260) * height * 0.64;
      const x = wallX + ((i * 13) % 9) - 4;
      ctx.fillStyle = score > 0.3 ? `rgba(248,${Math.round(180 - 80 * score)},113,.7)` : "rgba(147,197,253,.6)";
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    for (const p of particles) {
      const rgb = p.kind === "err" ? "248,113,113" : p.kind === "rep" ? "252,211,77" : "96,165,250";
      ctx.fillStyle = `rgba(${rgb},.9)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, 6.28);
      ctx.fill();
      ctx.fillStyle = `rgba(${rgb},.25)`;
      ctx.fillRect(p.x - 10, p.y - 0.6, 10, 1.2);
    }

    // The multiplier dial.
    const gx = wallX + (width - wallX) * 0.5;
    const gy = height * 0.82;
    const radius = Math.min((width - wallX) * 0.32, height * 0.4);
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.beginPath();
    ctx.arc(gx, gy, radius, Math.PI, 2 * Math.PI);
    ctx.stroke();
    const gradient = ctx.createLinearGradient(gx - radius, 0, gx + radius, 0);
    gradient.addColorStop(0, "#3B82F6");
    gradient.addColorStop(0.5, "#fcd34d");
    gradient.addColorStop(1, "#F87171");
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    ctx.arc(gx, gy, radius, Math.PI, Math.PI + Math.PI * score);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
    ctx.font = "500 10px JetBrains Mono, monospace";
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "center";
    ["1×", "2×", "3×"].forEach((label, i) => {
      const angle = Math.PI + (Math.PI * i) / 2;
      ctx.fillText(label, gx + Math.cos(angle) * (radius + 16), gy + Math.sin(angle) * (radius + 16) + 4);
    });
    const needle = Math.PI + Math.PI * score;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(needle) * (radius - 12), gy + Math.sin(needle) * (radius - 12));
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(gx, gy, 4, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "left";
    ctx.fillText("agente", agentX - 18, centerY + 38);
    ctx.textAlign = "center";
    ctx.fillText("awall", wallX, centerY + height * 0.32 + 14);

    // Text. The multiplier is applied to the integer prices, never to floats.
    const multiplier = abuseMultiplier(score);
    multiplierEl.textContent = `${decimal(multiplier)}×`;
    if (multiplierEl instanceof HTMLElement) {
      multiplierEl.style.color = score > 0.5 ? "#F87171" : score > 0.2 ? "#fcd34d" : "#fff";
    }
    const usdc = formatStellar(applyMultiplier(POLICY.priceUsdcAtomic, multiplier));
    const brl = formatBrl(applyMultiplier(POLICY.priceBrlCents, multiplier));
    priceEl.textContent = `${usdc} USDC · ${brl}`;
    burstBar.style.width = `${signals.burst * 100}%`;
    repeatsBar.style.width = `${signals.repeats * 100}%`;
    errorsBar.style.width = `${signals.errors * 100}%`;
    scoreBar.style.width = `${score * 100}%`;
    scoreValue.textContent = decimal(score);
    headers.innerHTML = `<span class="r">HTTP/1.1 402 Payment Required</span>\nX-AWall-Price-Multiplier: <span class="w">${multiplier.toFixed(2)}</span>`;
  }

  if (reduced) {
    paint();
    return;
  }
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
    if (!view.visible) return;
    advance(dt);
    paint();
  };
  requestAnimationFrame(loop);
}
