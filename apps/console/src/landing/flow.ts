/**
 * The particle scene behind the hero simulation and the story: a client, the
 * AWall wall and the origin, with requests flowing left to right. Past the
 * quota the wall answers 402, and a payment travels one of two rails.
 *
 * It is an illustration, not a measurement: the numbers it shows are labelled
 * as an example in the page.
 */

import { fitCanvas } from "./dom";

type Rgb = readonly [number, number, number];
type Point = { x: number; y: number };

const COLOR = {
  white: [220, 230, 255],
  blue: [59, 130, 246],
  blueLight: [96, 165, 250],
  teal: [45, 212, 191],
  red: [248, 113, 113],
  green: [74, 222, 128],
  dust: [90, 95, 110],
} as const satisfies Record<string, Rgb>;

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.trunc(from[0] + (to[0] - from[0]) * amount),
    Math.trunc(from[1] + (to[1] - from[1]) * amount),
    Math.trunc(from[2] + (to[2] - from[2]) * amount),
  ];
}

export type Rail = "stellar" | "pix";
export type FlowMode = "auto" | "manual" | "pass" | "block" | "rails" | "blind";

type PacketKind = "req" | "pass" | "r402" | Rail;
type Packet = { kind: PacketKind; t: number; speed: number; jitter: number; decided: boolean; done: boolean };
type Dot = { ox: number; oy: number; phase: number; size: number; kind: "client" | "wall" | "origin" | "dust" };

const MODE_LABEL: Partial<Record<FlowMode, string>> = {
  pass: "COTA",
  block: "402",
  rails: "STELLAR + PIX",
  blind: "ORIGIN CEGA",
};

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

export class Flow {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly labels: HTMLElement[];
  private readonly limit = 8;
  private used = 0;
  private packets: Packet[] = [];
  private flash = 0;
  private ring = 0;
  private time = 0;
  private next = 0;
  private blocked = 0;
  private payTurn = 0;
  private width = 0;
  private height = 0;
  private client: Point = { x: 0, y: 0 };
  private wall: Point = { x: 0, y: 0 };
  private origin: Point = { x: 0, y: 0 };
  private dots: Dot[] = [];

  private constructor(
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    private readonly term: HTMLElement | null,
    private mode: FlowMode,
  ) {
    this.ctx = ctx;
    this.labels = (["CLIENTE", "AWALL", "ORIGIN"] as const).map((name, index) => {
      const label = document.createElement("div");
      label.className = "lbl";
      label.append(name);
      const sub = document.createElement("b");
      sub.textContent = ["agente / app", "gateway x402", "sua API"][index] ?? "";
      label.append(sub);
      stage.append(label);
      return label;
    });
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.updateMeter();
  }

  static create(
    stage: HTMLElement,
    term: HTMLElement | null,
    mode: FlowMode,
  ): Flow | null {
    const canvas = stage.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    return new Flow(stage, canvas, ctx, term, mode);
  }

  /** Send one request through the wall. */
  send(): void {
    this.packets.push({
      kind: "req",
      t: 0,
      speed: 0.75 + Math.random() * 0.2,
      jitter: (Math.random() - 0.5) * 10,
      decided: false,
      done: false,
    });
  }

  /** Send a payment down one rail. */
  pay(rail: Rail): void {
    this.packets.push({ kind: rail, t: 0, speed: 0.55, jitter: 0, decided: false, done: false });
  }

  /** Leave automatic play: only what the viewer sends moves. */
  manual(): void {
    this.mode = "manual";
  }

  /** Let the scene play on its own. */
  auto(): void {
    this.mode = "auto";
  }

  /** Fire a burst that overruns the quota. */
  burst(): void {
    this.mode = "manual";
    for (let i = 0; i < this.limit + 2; i += 1) window.setTimeout(() => this.send(), i * 110);
  }

  setMode(mode: FlowMode): void {
    this.mode = mode;
    if (mode === "pass" || mode === "blind") this.used = 0;
    else if (mode === "block") this.used = this.limit;
    this.flash = 0;
    this.packets = [];
    this.blocked = 0;
    this.next = 0;
    this.updateMeter();
    const badge = this.stage.querySelector(".mode");
    const label = MODE_LABEL[mode];
    if (badge && label !== undefined) badge.textContent = label;
    this.draw();
  }

  step(dt: number): void {
    this.time += dt;
    this.next -= dt;
    const mode = this.mode;

    if (this.next <= 0) {
      if (mode === "auto" || mode === "pass" || mode === "block" || mode === "blind") {
        this.send();
        this.next = mode === "block" ? 0.55 : 0.42;
      }
      if (mode === "rails") {
        this.send();
        this.next = 0.5;
      }
      if ((mode === "pass" || mode === "blind") && this.used >= this.limit - 1) this.used = 0;
      if (mode === "block") this.used = this.limit;
      const idle = !this.packets.some((p) => p.kind !== "req" && p.kind !== "r402");
      if ((mode === "rails" || mode === "auto") && this.used >= this.limit && this.blocked >= 2 && idle) {
        this.pay(this.payTurn++ % 2 ? "pix" : "stellar");
        this.blocked = 0;
      }
      this.updateMeter();
    }

    for (const p of this.packets) {
      p.t += dt * p.speed;
      if (p.kind === "req" && p.t >= 1 && !p.decided) {
        p.decided = true;
        if (this.used < this.limit) {
          this.used += 1;
          p.kind = "pass";
          p.t = 1;
          this.updateMeter();
          this.log(
            `<span class="c">${clock()}</span> <span class="w">GET</span> /v1/cotacoes <span class="g">200</span> <span class="c">cota ${this.used}/${this.limit}</span>`,
          );
        } else {
          p.kind = "r402";
          p.t = 0;
          this.blocked += 1;
          this.flash = 1;
          this.log(
            `<span class="c">${clock()}</span> <span class="w">GET</span> /v1/cotacoes <span class="r">402 Payment Required</span> <span class="c">accepts=[</span><span class="b">exact/stellar</span><span class="c">,</span><span class="t">pix</span><span class="c">]</span>`,
          );
        }
      }
      if ((p.kind === "stellar" || p.kind === "pix") && p.t >= 1 && !p.done) {
        p.done = true;
        this.used = 0;
        this.updateMeter();
        this.log(
          p.kind === "stellar"
            ? `<span class="c">${clock()}</span> <span class="b">✓ stellar</span> exact 0,50 USDC liquidado <span class="y">+10.000 créditos</span>`
            : `<span class="c">${clock()}</span> <span class="t">✓ pix</span> R$ 2,90 confirmado <span class="c">pix:bcb</span> <span class="y">+10.000 créditos</span>`,
        );
        this.ring = 1;
      }
    }
    this.packets = this.packets.filter(
      (p) => !(p.kind === "pass" && p.t > 2.05) && !(p.kind === "r402" && p.t > 1) && !p.done,
    );
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.ring = Math.max(0, this.ring - dt * 0.7);
  }

  draw(): void {
    const ctx = this.ctx;
    const { width: W, height: H, time: t, mode } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    const glow = ctx.createRadialGradient(this.wall.x, this.wall.y, 0, this.wall.x, this.wall.y, H * 0.6);
    glow.addColorStop(0, this.flash > 0 ? rgba(COLOR.red, 0.18 * this.flash + 0.05) : "rgba(59,130,246,.12)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(this.client.x, this.client.y);
    ctx.lineTo(this.origin.x, this.origin.y);
    ctx.stroke();

    const railsOn = mode === "rails" || mode === "blind" || mode === "auto";
    for (const rail of ["stellar", "pix"] as const) {
      ctx.strokeStyle = rgba(rail === "stellar" ? COLOR.blue : COLOR.teal, railsOn ? 0.45 : 0.12);
      ctx.beginPath();
      for (let i = 0; i <= 40; i += 1) {
        const q = this.railPoint(rail, i / 40);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (railsOn) {
      ctx.font = "500 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      const a = this.railPoint("stellar", 0.5);
      const b = this.railPoint("pix", 0.5);
      ctx.fillStyle = rgba(COLOR.blueLight, 0.9);
      ctx.fillText("exact · stellar:testnet", a.x, a.y - 10);
      ctx.fillStyle = rgba(COLOR.teal, 0.9);
      ctx.fillText("pix · pix:bcb", b.x, b.y + 18);
    }

    for (const dot of this.dots) {
      const nx = Math.sin(t * 0.8 + dot.phase) * 1.2;
      const ny = Math.cos(t * 0.7 + dot.phase * 1.3) * 1.2;
      let color: Rgb = COLOR.white;
      let alpha = 0.55;
      if (dot.kind === "wall") {
        color = this.flash > 0 ? mix(COLOR.white, COLOR.red, this.flash) : dot.size > 1 ? COLOR.blueLight : COLOR.white;
        alpha = 0.7;
      } else if (dot.kind === "origin") {
        color = mode === "blind" ? COLOR.white : COLOR.blueLight;
        alpha = mode === "blind" ? 0.75 : 0.5;
      } else if (dot.kind === "dust") {
        color = COLOR.dust;
        alpha = 0.35;
      }
      const px = dot.kind === "dust" ? (dot.ox + t * 6) % W : dot.ox + nx;
      const py = dot.oy + ny;
      ctx.fillStyle = rgba(color, alpha);
      ctx.fillRect(px, py, dot.size, dot.size);
    }

    if (mode === "blind" || this.ring > 0) {
      const radius = H * 0.33;
      const count = 160;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * 6.28 + t * 0.9;
        ctx.fillStyle = rgba(i % 2 ? COLOR.blue : COLOR.teal, mode === "blind" ? 0.8 : this.ring);
        ctx.fillRect(this.wall.x + Math.cos(angle) * radius * 0.42, this.wall.y + Math.sin(angle) * radius, 1.6, 1.6);
      }
    }

    for (const p of this.packets) {
      const trail: Point[] = [];
      let color: Rgb = COLOR.blueLight;
      for (let k = 0; k < 14; k += 1) {
        const tt = p.t - k * 0.012;
        if (tt < 0) break;
        let q: Point;
        if (p.kind === "req" || p.kind === "pass") {
          const u = Math.min(tt, 2.05);
          q =
            u <= 1
              ? { x: this.client.x + (this.wall.x - this.client.x) * u, y: this.client.y + p.jitter * (1 - u) }
              : { x: this.wall.x + (this.origin.x - this.wall.x) * (u - 1), y: this.wall.y };
          color = p.kind === "pass" && tt > 1 ? COLOR.green : COLOR.blueLight;
        } else if (p.kind === "r402") {
          q = {
            x: this.wall.x - (this.wall.x - this.client.x) * tt,
            y: this.wall.y - Math.sin(tt * Math.PI) * H * 0.1,
          };
          color = COLOR.red;
        } else {
          q = this.railPoint(p.kind, Math.min(tt, 1));
          color = p.kind === "stellar" ? COLOR.blue : COLOR.teal;
        }
        trail.push(q);
      }
      trail.forEach((q, k) => {
        ctx.fillStyle = rgba(color, 1 - k / 14);
        ctx.beginPath();
        ctx.arc(q.x, q.y, k ? 1.8 : 3.2, 0, 6.28);
        ctx.fill();
      });
    }

    if (mode === "block" || this.flash > 0.05) {
      const alpha = mode === "block" ? 0.55 + 0.45 * this.flash : this.flash;
      ctx.font = `800 ${Math.round(H * 0.16)}px Inter, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = rgba(COLOR.red, alpha * 0.85);
      ctx.fillText("402", this.wall.x, this.wall.y - H * 0.34 + H * 0.08);
    }
    if (mode === "blind") {
      ctx.font = "500 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.fillText("só vê 200 OK", this.origin.x, this.origin.y - H * 0.2);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private resize(): void {
    const size = fitCanvas(this.canvas, this.ctx, this.stage);
    this.width = size.width;
    this.height = size.height;
    const y = this.height * 0.56;
    const edge = this.width < 500 ? 0.15 : 0.12;
    this.client = { x: this.width * edge, y };
    this.wall = { x: this.width * 0.5, y };
    this.origin = { x: this.width * (1 - edge), y };
    this.build();
    const positions = [this.client, this.wall, this.origin];
    this.labels.forEach((label, index) => {
      const at = positions[index];
      if (at === undefined) return;
      label.style.left = `${at.x}px`;
      label.style.top = `${this.height - 44}px`;
    });
    this.draw();
  }

  /** Point clouds for the three nodes plus drifting dust. */
  private build(): void {
    const dots: Dot[] = [];
    const H = this.height;
    const scale = Math.min(1, this.width / 640);
    const add = (x: number, y: number, kind: Dot["kind"]): void => {
      dots.push({ ox: x, oy: y, phase: Math.random() * 6.28, size: Math.random() < 0.1 ? 1.6 : 0.9, kind });
    };

    const clientRadius = 26 * scale + 6;
    for (let i = 0; i < 380; i += 1) {
      const angle = Math.random() * 6.28;
      const r = clientRadius * Math.sqrt(Math.random());
      add(this.client.x + Math.cos(angle) * r, this.client.y + Math.sin(angle) * r, "client");
    }

    const halfHeight = H * 0.27;
    const halfWidth = 10 + 6 * scale;
    for (let i = 0; i < 1100; i += 1) {
      let x = 0;
      let y = 0;
      for (;;) {
        y = (Math.random() * 2 - 1) * halfHeight;
        x = (Math.random() * 2 - 1) * halfWidth;
        const row = Math.floor((y + halfHeight) / 14);
        const fy = ((y + halfHeight) / 14) % 1;
        const fx = ((x + halfWidth + (row % 2 ? 7 : 0)) / 14) % 1;
        if ((fy < 0.15 || fx < 0.12) && Math.random() > 0.2) continue;
        break;
      }
      add(this.wall.x + x, this.wall.y + y, "wall");
    }

    const originRadius = 34 * scale + 8;
    for (let i = 0; i < 620; i += 1) {
      const angle = Math.random() * 6.28;
      const r = originRadius * (0.86 + 0.14 * Math.random());
      add(
        this.origin.x + Math.cos(angle) * r * (0.35 + 0.65 * Math.abs(Math.sin(angle + i))),
        this.origin.y + Math.sin(angle) * r,
        "origin",
      );
    }
    for (let i = 0; i < 220; i += 1) add(Math.random() * this.width, Math.random() * H, "dust");
    this.dots = dots;
  }

  /** Position on a payment rail, client to wall. Stellar arcs up, Pix down. */
  private railPoint(rail: Rail, t: number): Point {
    const direction = rail === "stellar" ? -1 : 1;
    const from = this.client;
    const to = this.wall;
    const cx = (from.x + to.x) / 2;
    const cy = from.y + direction * this.height * 0.36;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    };
  }

  private updateMeter(): void {
    const label = this.stage.querySelector(".q");
    const bar = this.stage.querySelector<HTMLElement>(".bar i");
    const meter = this.stage.querySelector(".meter");
    if (!label || !bar || !meter) return;
    label.textContent = `${this.used}/${this.limit}`;
    bar.style.width = `${(this.used / this.limit) * 100}%`;
    meter.classList.toggle("full", this.used >= this.limit);
  }

  /** `html` is built from constants and numbers in this file, never from input. */
  private log(html: string): void {
    if (!this.term) return;
    const line = document.createElement("div");
    line.innerHTML = html;
    this.term.append(line);
    while (this.term.children.length > 8) this.term.firstElementChild?.remove();
  }
}
