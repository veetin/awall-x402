import "../theme.css";
import "./landing.css";
import { guillochePath } from "./guilloche";
import {
  POLICY,
  ROUTES,
  abuseMultiplier,
  applyMultiplier,
  formatBrl,
  formatInt,
  formatStellar,
  freshAccount,
  revenueBrl,
  revenueUsdc,
  runMinute,
  sharesOf,
  type Minute,
  type Rail,
} from "./sim";
import { PACKET_SECONDS, Streams, type Geometry, type Rgb } from "./streams";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const phone = window.matchMedia("(max-width: 700px)");

document.documentElement.classList.add("js");

function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

function $$<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/* ------------------------------------------------------------------------ */
/* Springs: a damped spring sampled into CSS linear().                      */
/* ------------------------------------------------------------------------ */

function spring(stiffness: number, damping: number): { easing: string; ms: number } {
  const dt = 1 / 240;
  const values: number[] = [];
  let x = 0;
  let v = 0;
  for (let step = 0; step < 240 * 3; step += 1) {
    v += (stiffness * (1 - x) - damping * v) * dt;
    x += v * dt;
    values.push(x);
    if (Math.abs(1 - x) < 0.0008 && Math.abs(v) < 0.01) break;
  }
  const points: string[] = [];
  const count = 48;
  for (let i = 0; i <= count; i += 1) {
    const value = i === count ? 1 : (values[Math.round((i / count) * (values.length - 1))] ?? 1);
    points.push(value.toFixed(4));
  }
  return { easing: `linear(0, ${points.slice(1).join(", ")})`, ms: Math.round(values.length * dt * 1000) };
}

const root = document.documentElement.style;
const snappy = spring(170, 16);
const settle = spring(90, 15);
root.setProperty("--spring", snappy.easing);
root.setProperty("--spring-ms", `${snappy.ms}ms`);
root.setProperty("--settle", settle.easing);
root.setProperty("--settle-ms", `${settle.ms}ms`);

/* ------------------------------------------------------------------------ */
/* Load and reveal                                                          */
/* ------------------------------------------------------------------------ */

for (const title of $$<HTMLElement>("[data-words]")) {
  const words = (title.textContent ?? "").trim().split(/\s+/);
  title.setAttribute("aria-label", words.join(" "));
  title.textContent = "";
  words.forEach((word, index) => {
    const clip = document.createElement("span");
    clip.className = "word";
    clip.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.textContent = word;
    inner.style.setProperty("--i", String(index));
    clip.append(inner);
    title.append(clip, " ");
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      revealObserver.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -8% 0px" },
);
$$<HTMLElement>(".reveal").forEach((element, index) => {
  if (element.closest(".hero")) element.style.setProperty("--delay", `${180 + index * 70}ms`);
  revealObserver.observe(element);
});
requestAnimationFrame(() => document.body.classList.add("loaded"));

/** Run `start` once, the first time `element` is on screen. */
function onceVisible(element: Element, start: () => void, threshold = 0.35): void {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    },
    { threshold },
  );
  observer.observe(element);
}

/* ------------------------------------------------------------------------ */
/* Lit panels: a pool of light under the pointer                            */
/* ------------------------------------------------------------------------ */

document.addEventListener("pointermove", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".lit") : null;
  if (!target) return;
  const box = target.getBoundingClientRect();
  target.style.setProperty("--mx", `${event.clientX - box.left}px`);
  target.style.setProperty("--my", `${event.clientY - box.top}px`);
});

/* ------------------------------------------------------------------------ */
/* Hero: one agent, one minute at a time                                    */
/* ------------------------------------------------------------------------ */

const hero = $<HTMLElement>(".hero");
const canvas = $<HTMLCanvasElement>(".streams");
const card = $<HTMLElement>("[data-flow-start]");
const pots = $$<HTMLElement>("[data-pot]");
const rateInput = $<HTMLInputElement>("#rate");
const rateOut = $<HTMLOutputElement>("[data-rate-out]");
const humanInput = $<HTMLInputElement>("[data-human]");
const sendButton = $<HTMLButtonElement>("[data-send]");
const wall = $<HTMLElement>("[data-wall]");

const HEX: Record<"free" | "stellar" | "pix", Rgb> = {
  free: [0x34 / 255, 0xd3 / 255, 0x99 / 255],
  stellar: [0xfb / 255, 0xbf / 255, 0x24 / 255],
  pix: [0x38 / 255, 0xbd / 255, 0xf8 / 255],
};

const state = {
  account: freshAccount(),
  route: 0,
  rate: Number(rateInput?.value ?? 300),
  rail: "stellar" as Rail,
  inFlight: false,
};

/** What the visitor sees, eased toward the account after each minute. */
const shown = {
  free: 0,
  balance: 0,
  paidStellar: 0,
  paidPix: 0,
  usdc: 0n,
  brl: 0n,
};

function currentRoute(): (typeof ROUTES)[number] {
  return ROUTES[state.route % ROUTES.length] ?? { path: "GET /v1/search?q=camera", credits: 1 };
}

function preview(): Minute {
  return runMinute(state.account, state.rate, currentRoute().credits, state.rail);
}

let streams: Streams | null = null;

function measure(): Geometry | null {
  if (!hero || !card || pots.length < 3) return null;
  const base = hero.getBoundingClientRect();
  const from = card.getBoundingClientRect();
  const vertical = phone.matches;
  const ends = pots.map((pot) => {
    const box = pot.getBoundingClientRect();
    return vertical
      ? { x: box.left - base.left + box.width / 2, y: box.top - base.top + 2 }
      : { x: box.left - base.left + 2, y: box.top - base.top + box.height / 2 };
  });
  const [a, b, c] = ends;
  if (!a || !b || !c) return null;
  if (vertical) {
    const start = { x: from.left - base.left + from.width / 2, y: from.bottom - base.top - 2 };
    return {
      start,
      ends: [a, b, c],
      vertical,
      center: { x: start.x, y: (start.y + a.y) / 2 },
      radius: Math.min(base.width * 0.6, (c.x - a.x) * 0.9),
    };
  }
  const start = { x: from.right - base.left - 2, y: from.top - base.top + from.height / 2 };
  return {
    start,
    ends: [a, b, c],
    vertical,
    center: { x: (start.x + a.x) / 2, y: (a.y + c.y) / 2 },
    radius: Math.min(base.width * 0.48, Math.max(c.y - a.y, a.x - start.x) * 1.05),
  };
}

function updateCard(): void {
  const route = currentRoute();
  const routeText = $<HTMLElement>("[data-route]");
  const cost = $<HTMLElement>("[data-cost]");
  const echo = $<HTMLElement>("[data-rate-echo]");
  if (routeText) routeText.textContent = route.path;
  if (cost) cost.textContent = route.credits === 1 ? "1 crédito" : `${route.credits} créditos`;
  if (echo) echo.textContent = formatInt(state.rate);
  if (rateOut) rateOut.textContent = `${formatInt(state.rate)} req/min`;
  if (rateInput) {
    const min = Number(rateInput.min);
    const max = Number(rateInput.max);
    rateInput.style.setProperty("--p", `${((state.rate - min) / (max - min)) * 100}%`);
  }
}

function applyPreview(): void {
  const shares = sharesOf(preview(), state.rail);
  streams?.setShares(shares, reduced.matches);
  if (reduced.matches) drawStill();
}

function setText(selector: string, text: string): void {
  const element = $<HTMLElement>(selector);
  if (element) element.textContent = text;
}

function packsText(packs: number, paid: number): string {
  return `${formatInt(packs)} ${packs === 1 ? "pacote" : "pacotes"} · ${formatInt(Math.round(paid))} req. pagas`;
}

function paint(): void {
  setText('[data-total="free"]', formatInt(Math.round(shown.free)));
  setText('[data-total="stellar"]', formatStellar(shown.usdc));
  setText('[data-total="pix"]', formatBrl(shown.brl));
  setText("[data-balance]", formatInt(Math.round(shown.balance)));
  const { packs } = state.account;
  setText('[data-sub="stellar"]', packsText(packs.stellar, shown.paidStellar));
  setText('[data-sub="pix"]', packsText(packs.pix, shown.paidPix));
}

function approach(current: number, target: number): number {
  const step = (target - current) * 0.14;
  return Math.abs(step) < 0.5 ? target : current + step;
}

function approachBig(current: bigint, target: bigint): bigint {
  const step = ((target - current) * 14n) / 100n;
  return step === 0n ? target : current + step;
}

let rolling = 0;

function roll(): void {
  const account = state.account;
  const target = {
    free: account.served.free,
    balance: account.balance,
    paidStellar: account.served.stellar,
    paidPix: account.served.pix,
    usdc: revenueUsdc(account),
    brl: revenueBrl(account),
  };
  if (reduced.matches) {
    Object.assign(shown, target);
    paint();
    return;
  }
  cancelAnimationFrame(rolling);
  const tick = () => {
    shown.free = approach(shown.free, target.free);
    shown.balance = approach(shown.balance, target.balance);
    shown.paidStellar = approach(shown.paidStellar, target.paidStellar);
    shown.paidPix = approach(shown.paidPix, target.paidPix);
    shown.usdc = approachBig(shown.usdc, target.usdc);
    shown.brl = approachBig(shown.brl, target.brl);
    paint();
    const done =
      shown.free === target.free &&
      shown.balance === target.balance &&
      shown.paidStellar === target.paidStellar &&
      shown.paidPix === target.paidPix &&
      shown.usdc === target.usdc &&
      shown.brl === target.brl;
    if (!done) rolling = requestAnimationFrame(tick);
  };
  rolling = requestAnimationFrame(tick);
}

function describe(minute: Minute, rail: Rail): void {
  setText('[data-line="free"]', minute.free > 0 ? `+${formatInt(minute.free)} grátis neste minuto` : "cota vazia neste minuto");
  for (const name of ["stellar", "pix"] as const) {
    if (name !== rail || minute.paid === 0) {
      setText(`[data-line="${name}"]`, "sem uso neste minuto");
      continue;
    }
    if (minute.packs > 0) {
      const price =
        name === "stellar"
          ? `+${formatStellar(POLICY.priceUsdcAtomic * BigInt(minute.packs))} USDC`
          : `+${formatBrl(POLICY.priceBrlCents * BigInt(minute.packs))}`;
      setText(`[data-line="${name}"]`, `${price} · ${minute.packs} × 402 liquidado`);
    } else {
      setText(`[data-line="${name}"]`, `+${formatInt(minute.paid)} req. pagas com o saldo`);
    }
  }
}

function bump(minute: Minute): void {
  const touched = [minute.free > 0, state.rail === "stellar" && minute.paid > 0, state.rail === "pix" && minute.paid > 0];
  pots.forEach((pot, index) => {
    if (!touched[index]) return;
    window.setTimeout(() => {
      pot.classList.remove("bump");
      void pot.offsetWidth;
      pot.classList.add("bump");
    }, reduced.matches ? 0 : index * 110);
  });
}

function send(advance: boolean): void {
  if (state.inFlight) return;
  if (advance) {
    state.route = (state.route + 1) % ROUTES.length;
    updateCard();
    card?.classList.remove("flash");
    void card?.offsetWidth;
    card?.classList.add("flash");
  }
  const minute = preview();
  const rail = state.rail;
  const arrive = () => {
    state.account = minute.account;
    state.inFlight = false;
    if (sendButton) sendButton.disabled = false;
    describe(minute, rail);
    bump(minute);
    roll();
    applyPreview();
  };
  if (reduced.matches || !streams) {
    arrive();
    return;
  }
  state.inFlight = true;
  if (sendButton) sendButton.disabled = true;
  streams.firePacket(performance.now());
  window.setTimeout(arrive, PACKET_SECONDS * 1000);
}

/** Bricks of one row, `width` characters long, offset on odd rows. */
function bricks(row: number, from: number, width: number): string {
  const pattern = row % 2 === 0 ? "|__" : "_|_";
  let out = "";
  for (let i = from; i < from + width; i += 1) out += pattern[i % 3] ?? "_";
  return out;
}

function buildWall(): void {
  if (!wall || !hero || !card) return;
  const style = getComputedStyle(wall);
  const lineHeight = parseFloat(style.lineHeight) || 12;
  const box = wall.getBoundingClientRect();
  const from = card.getBoundingClientRect();
  const lines: string[] = [];
  if (phone.matches) {
    // JetBrains Mono advances 0.6em per character.
    const charWidth = (parseFloat(style.fontSize) || 8) * 0.6;
    const cols = Math.max(12, Math.floor(box.width / charWidth));
    const rows = Math.max(3, Math.floor(box.height / lineHeight));
    const center = Math.round((from.left + from.width / 2 - box.left) / charWidth);
    const half = 8;
    const left = Math.max(0, center - half);
    const right = Math.min(cols, center + half);
    const label = "402";
    for (let row = 0; row < rows; row += 1) {
      const middle = row === Math.floor(rows / 2);
      const width = right - left;
      const gate = middle
        ? `${" ".repeat(Math.floor((width - label.length) / 2))}${label}`.padEnd(width, " ")
        : " ".repeat(width);
      lines.push(
        `<span><span>${bricks(row, 0, left)}</span><span class="open${middle ? " gate" : ""}">${gate}</span><span>${bricks(row, right, cols - right)}</span></span>`,
      );
    }
  } else {
    const rows = Math.max(8, Math.floor(box.height / lineHeight));
    const gate = Math.round((from.top + from.height / 2 - box.top) / lineHeight - 0.5);
    for (let row = 0; row < rows; row += 1) {
      const d = row - gate;
      if (d === 0) lines.push('<span class="open gate">  402  </span>');
      else if (Math.abs(d) <= 3) lines.push('<span class="open">       </span>');
      else if (Math.abs(d) === 4) lines.push("<span>+-----+</span>");
      else lines.push(`<span>${bricks(row, 0, 7)}</span>`);
    }
  }
  wall.innerHTML = lines.join("");
}

function drawStill(): void {
  const geometry = measure();
  if (streams && geometry) streams.frame(performance.now(), geometry, true);
}

function sizeCanvas(): void {
  if (!hero || !streams) return;
  const box = hero.getBoundingClientRect();
  streams.resize(box.width, box.height);
}

if (canvas && hero) {
  const small = phone.matches;
  streams = Streams.create(canvas, {
    grains: small ? 9_000 : 26_000,
    colors: [HEX.free, HEX.stellar, HEX.pix],
    guilloche: [0.034, 0.04, 0.048],
    ramp: " .·:-=+*#%@",
    cell: small ? { width: 6, height: 11 } : { width: 7, height: 13 },
  });
  if (!streams) canvas.remove();
}

let heroVisible = true;
let loop = 0;

function frame(now: number): void {
  loop = 0;
  if (!heroVisible || reduced.matches || document.hidden) return;
  const geometry = measure();
  if (streams && geometry) streams.frame(now, geometry);
  loop = requestAnimationFrame(frame);
}

function startLoop(): void {
  if (loop === 0 && !reduced.matches && streams) loop = requestAnimationFrame(frame);
}

if (hero) {
  new IntersectionObserver((entries) => {
    heroVisible = entries.some((entry) => entry.isIntersecting);
    if (heroVisible) startLoop();
  }).observe(hero);
  new ResizeObserver(() => {
    sizeCanvas();
    buildWall();
    if (reduced.matches) drawStill();
  }).observe(hero);
}
document.addEventListener("visibilitychange", startLoop);
reduced.addEventListener("change", () => {
  applyPreview();
  startLoop();
});
void document.fonts.ready.then(() => {
  streams?.refreshGlyphs();
  buildWall();
  if (reduced.matches) drawStill();
});

rateInput?.addEventListener("input", () => {
  state.rate = Number(rateInput.value);
  updateCard();
  applyPreview();
});
humanInput?.addEventListener("change", () => {
  state.rail = humanInput.checked ? "pix" : "stellar";
  applyPreview();
});
sendButton?.addEventListener("click", () => send(true));

/* ------------------------------------------------------------------------ */
/* Tiles                                                                    */
/* ------------------------------------------------------------------------ */

function stepLoop(container: Element | null, interval: number): void {
  if (!container) return;
  const steps = $$<HTMLElement>("[data-step]", container);
  if (reduced.matches) {
    steps.forEach((step) => step.classList.add("on"));
    return;
  }
  onceVisible(container, () => {
    let lit = 0;
    window.setInterval(() => {
      if (lit === steps.length + 2) {
        steps.forEach((step) => step.classList.remove("on"));
        lit = 0;
        return;
      }
      steps[lit]?.classList.add("on");
      lit += 1;
    }, interval);
  });
}

stepLoop($("[data-accepts]"), 850);
stepLoop($("[data-ledger]"), 1100);

const gauge = $<HTMLElement>("[data-gauge]");

function drawGauge(score: number): void {
  if (!gauge) return;
  const multiplier = abuseMultiplier(score);
  const filled = Math.round(score * 20);
  const price = applyMultiplier(POLICY.priceUsdcAtomic, multiplier);
  gauge.textContent =
    `escore ${score.toFixed(2).replace(".", ",")} [${"█".repeat(filled)}${"·".repeat(20 - filled)}]\n` +
    `preço  ${multiplier.toFixed(2).replace(".", ",")}× → ${formatStellar(price)} USDC`;
}

if (gauge) {
  if (reduced.matches) {
    drawGauge(0.18);
  } else {
    onceVisible(gauge, () => {
      const begin = performance.now();
      const tick = (now: number) => {
        const phase = ((now - begin) / 7000) % 1;
        drawGauge(Math.round((0.5 - 0.5 * Math.cos(phase * Math.PI * 2)) * 100) / 100);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Receipt: leans toward the pointer on a spring, flips on press            */
/* ------------------------------------------------------------------------ */

const path = guillochePath(360);
for (const element of $$<SVGPathElement>("[data-guilloche]")) element.setAttribute("d", path);

const receipt = $<HTMLButtonElement>("[data-receipt]");
if (receipt) {
  const rest = { x: 8, y: -16 };
  const tilt = { x: rest.x, y: rest.y, vx: 0, vy: 0 };
  let target = { ...rest };
  let raf = 0;
  const apply = () => {
    receipt.style.setProperty("--rx", `${tilt.x.toFixed(2)}deg`);
    receipt.style.setProperty("--ry", `${tilt.y.toFixed(2)}deg`);
    receipt.style.setProperty("--gx", `${(50 - tilt.y * 2.2).toFixed(1)}%`);
    receipt.style.setProperty("--gy", `${(50 + tilt.x * 2.2).toFixed(1)}%`);
    receipt.style.setProperty("--foil", `${(115 + tilt.y * 2).toFixed(1)}deg`);
  };
  let last = 0;
  const step = (now: number) => {
    const dt = last === 0 ? 1 / 60 : Math.min(1 / 30, (now - last) / 1000);
    last = now;
    for (const axis of ["x", "y"] as const) {
      const velocity = axis === "x" ? "vx" : "vy";
      const accel = 120 * (target[axis] - tilt[axis]) - 14 * tilt[velocity];
      tilt[velocity] += accel * dt;
      tilt[axis] += tilt[velocity] * dt;
    }
    apply();
    const settled =
      Math.abs(target.x - tilt.x) < 0.01 && Math.abs(target.y - tilt.y) < 0.01 && Math.abs(tilt.vx) + Math.abs(tilt.vy) < 0.01;
    raf = settled ? 0 : requestAnimationFrame(step);
    if (settled) last = 0;
  };
  const kick = () => {
    if (raf === 0 && !reduced.matches) raf = requestAnimationFrame(step);
  };
  apply();
  receipt.addEventListener("pointermove", (event) => {
    const box = receipt.getBoundingClientRect();
    const nx = (event.clientX - box.left) / box.width - 0.5;
    const ny = (event.clientY - box.top) / box.height - 0.5;
    target = { x: -ny * 22, y: nx * 28 };
    kick();
  });
  receipt.addEventListener("pointerleave", () => {
    target = { ...rest };
    kick();
  });
  receipt.addEventListener("click", () => {
    const pressed = receipt.getAttribute("aria-pressed") === "true";
    receipt.setAttribute("aria-pressed", String(!pressed));
  });
}

const meter = $<HTMLElement>("[data-meter]");
if (meter) onceVisible(meter, () => meter.classList.add("filled"));

/* ------------------------------------------------------------------------ */
/* Close                                                                    */
/* ------------------------------------------------------------------------ */

const scramble = $<HTMLElement>("[data-scramble]");
if (scramble && !reduced.matches) {
  const final = scramble.textContent ?? "";
  const noise = "#%@*+=-:.░▒▓";
  onceVisible(scramble, () => {
    const begin = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - begin) / 1400);
      let out = "";
      for (let i = 0; i < final.length; i += 1) {
        const char = final[i] ?? "";
        if (char === " " || char === "\n" || i / final.length < progress) out += char;
        else out += noise[Math.floor(Math.random() * noise.length)] ?? char;
      }
      scramble.textContent = out;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

for (const pill of $$<HTMLElement>(".magnetic")) {
  pill.addEventListener("pointermove", (event) => {
    if (reduced.matches) return;
    const box = pill.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    pill.style.setProperty("--tx", `${(dx * 0.28).toFixed(1)}px`);
    pill.style.setProperty("--ty", `${(dy * 0.4).toFixed(1)}px`);
  });
  pill.addEventListener("pointerleave", () => {
    pill.style.setProperty("--tx", "0px");
    pill.style.setProperty("--ty", "0px");
  });
}

/* ------------------------------------------------------------------------ */
/* Slides: the side rail follows the section on screen                   */
/* ------------------------------------------------------------------------ */

const slides = $$<HTMLElement>("main > .slide");
const railLinks = $$<HTMLAnchorElement>(".rail a");

if (slides.length > 0 && slides.length === railLinks.length) {
  const follow = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = slides.findIndex((slide) => slide === entry.target);
        railLinks.forEach((link, i) => {
          if (i === index) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  slides.forEach((slide) => follow.observe(slide));
}

/* ------------------------------------------------------------------------ */
/* Start                                                                    */
/* ------------------------------------------------------------------------ */

updateCard();
paint();
applyPreview();
startLoop();
window.setTimeout(() => send(false), reduced.matches ? 0 : 900);
