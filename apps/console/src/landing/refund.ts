/**
 * "Origin caiu, crédito volta": one request is charged, forwarded, and either
 * answered (the charge stays) or answered 5xx (the credits come back as a
 * separate ledger line). The cycle alternates between the two.
 *
 * The balance and the route cost are an example, not captured traffic.
 */

import { fitCanvas, must, trackVisible } from "./dom";
import { formatInt } from "./sim";

type Point = { x: number; y: number };

/** Charge, forward, answer, refund or settle, pause. */
const DURATIONS = [1.4, 1.2, 0.9, 1.6, 1.4];
const TOTAL = DURATIONS.reduce((sum, d) => sum + d, 0);
const COST = 2;

function locate(t: number): { phase: number; progress: number } {
  let start = 0;
  for (const [phase, duration] of DURATIONS.entries()) {
    if (t < start + duration) return { phase, progress: (t - start) / duration };
    start += duration;
  }
  return { phase: DURATIONS.length - 1, progress: 1 };
}

function lerp(a: Point, b: Point, k: number): Point {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export function mountRefund(root: HTMLElement, reduced: boolean): void {
  const canvas = must<HTMLCanvasElement>("canvas", root);
  const ctx = canvas.getContext("2d");
  const stage = canvas.parentElement;
  if (!ctx || !stage) return;

  const balanceEl = must("[data-bal]", root);
  const deltaEl = must("[data-delta]", root);
  const statusEl = must("[data-ostat]", root);
  const ledgerEl = must("[data-ledger]", root);

  let width = 0;
  let height = 0;
  const refit = (): void => {
    ({ width, height } = fitCanvas(canvas, ctx, stage));
  };
  new ResizeObserver(() => {
    refit();
    if (reduced) paint(4, 0);
  }).observe(stage);
  refit();

  const view = trackVisible(root);
  let balance = 10_000;
  let cycle = 0;
  let phase = -1;
  let time = 0;
  const fails = (): boolean => cycle % 2 === 0;

  /** `html` is built from constants and numbers in this file, never from input. */
  function log(html: string): void {
    const line = document.createElement("div");
    line.innerHTML = html;
    ledgerEl.append(line);
    while (ledgerEl.children.length > 6) ledgerEl.firstElementChild?.remove();
  }

  function setBalance(value: number, delta: string, color: string): void {
    balance = value;
    balanceEl.textContent = formatInt(value);
    deltaEl.textContent = delta;
    deltaEl.className = "show";
    if (deltaEl instanceof HTMLElement) deltaEl.style.color = color;
  }

  function enter(next: number): void {
    if (next === 0) {
      statusEl.className = "rf-stat";
      setBalance(balance - COST, `−${COST}`, "#F87171");
      log(`<span class="r">-${COST}</span>  consumo   GET /v1/items/42`);
    }
    if (next === 2) {
      if (fails()) {
        statusEl.textContent = "503";
        statusEl.className = "rf-stat show bad";
        log(`    origin    <span class="r">503 Service Unavailable</span>`);
      } else {
        statusEl.textContent = "200";
        statusEl.className = "rf-stat show ok";
        log(`    origin    <span class="g">200 OK</span>  <span class="c">cobrança mantida</span>`);
      }
    }
    if (next === 3 && fails()) log(`<span class="g">+${COST}</span>  estorno   a falha foi nossa`);
    if (next === 4) {
      if (fails()) {
        setBalance(balance + COST, `+${COST}`, "#4ade80");
        log(`──  saldo     ${formatInt(balance - COST)} → <span class="w">${formatInt(balance)}</span>`);
      } else {
        deltaEl.className = "";
      }
    }
  }

  function paint(current: number, progress: number): void {
    if (!ctx) return;
    const client = { x: width * 0.14, y: height * 0.62 };
    const wall = { x: width * 0.5, y: height * 0.62 };
    const origin = { x: width * 0.86, y: height * 0.62 };
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    const bad = fails() && current >= 2 && current <= 3;

    const glow = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, height * 0.5);
    glow.addColorStop(0, bad ? "rgba(248,113,113,.22)" : "rgba(59,130,246,.08)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(client.x, client.y);
    ctx.lineTo(origin.x, origin.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(74,222,128,.25)";
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.quadraticCurveTo(wall.x, height * 1.02, client.x, client.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const cloud = (at: Point, count: number, radius: number, fill: string): void => {
      for (let i = 0; i < count; i += 1) {
        const angle = i * 2.399 + time * 0.2;
        const r = Math.sqrt(i / count) * radius;
        ctx.fillStyle = fill;
        ctx.fillRect(at.x + Math.cos(angle) * r, at.y + Math.sin(angle) * r, 1.2, 1.2);
      }
    };
    cloud(client, 140, 20, "rgba(220,230,255,.55)");
    for (let i = 0; i < 200; i += 1) {
      const y = wall.y - height * 0.2 + (((i * 37) % 200) / 200) * height * 0.4;
      const x = wall.x + ((i * 11) % 9) - 4;
      ctx.fillStyle = "rgba(147,197,253,.6)";
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    cloud(
      origin,
      180,
      26,
      bad ? "rgba(248,113,113,.75)" : current >= 2 && !fails() ? "rgba(74,222,128,.7)" : "rgba(96,165,250,.55)",
    );

    let packet: Point | null = null;
    let rgb = "96,165,250";
    let label = "";
    if (current === 0) {
      packet = lerp(client, wall, progress);
      label = `−${COST}`;
    } else if (current === 1) {
      packet = lerp(wall, origin, progress);
      label = "req";
    } else if (current === 3 && fails()) {
      const u = 1 - progress;
      packet = {
        x: u * u * origin.x + 2 * u * progress * wall.x + progress * progress * client.x,
        y: u * u * origin.y + 2 * u * progress * height * 1.02 + progress * progress * client.y,
      };
      rgb = "74,222,128";
      label = `+${COST}`;
    }
    if (packet) {
      for (let k = 0; k < 12; k += 1) {
        ctx.fillStyle = `rgba(${rgb},${(1 - k / 12) * 0.9})`;
        ctx.beginPath();
        ctx.arc(packet.x - (current === 3 ? -k * 2 : k * 3), packet.y, k ? 1.6 : 3.4, 0, 6.28);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.font = "600 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillText(label, packet.x, packet.y - 12);
      ctx.globalCompositeOperation = "lighter";
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.font = "500 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#6b7280";
    ctx.fillText("cliente", client.x, client.y + 40);
    ctx.fillText("awall · ledger", wall.x, wall.y - height * 0.2 - 10);
    ctx.fillText("origin", origin.x, origin.y + 44);
    ctx.fillStyle = "rgba(74,222,128,.7)";
    ctx.fillText("estorno", wall.x, height * 0.95);
  }

  if (reduced) {
    // One still frame that tells the whole story: charged, 503, refunded.
    for (const step of [0, 2, 3, 4]) enter(step);
    paint(4, 0);
    return;
  }
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
    if (!view.visible) return;
    time += dt;
    if (time > TOTAL) {
      time = 0;
      cycle += 1;
      phase = -1;
    }
    const { phase: current, progress } = locate(time);
    if (current !== phase) {
      phase = current;
      enter(current);
    }
    paint(current, progress);
  };
  requestAnimationFrame(loop);
}
