/**
 * The full-page ASCII background: three rivers of grains, drawn by WebGL2.
 * The shares of the rivers follow the hero simulation, so a 402 and the
 * payment that answers it are visible behind the whole page.
 *
 * Without WebGL2 the canvas is removed and the page works without it.
 */

import type { FlowEvent } from "./flow";
import { Streams, type Geometry, type Point, type Rgb } from "./streams";

const RIVERS = {
  free: [52 / 255, 211 / 255, 153 / 255],
  stellar: [251 / 255, 191 / 255, 36 / 255],
  pix: [56 / 255, 189 / 255, 248 / 255],
} as const satisfies Record<string, Rgb>;

type Shares = [number, number, number];

function geometry(phone: boolean): Geometry {
  // The usable viewport: `innerWidth` includes the scrollbar, which would
  // stretch the canvas a little.
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  if (phone) {
    const start: Point = { x: w / 2, y: h * 0.06 };
    const ends: Geometry["ends"] = [
      { x: w * 0.18, y: h * 0.94 },
      { x: w * 0.5, y: h * 0.94 },
      { x: w * 0.82, y: h * 0.94 },
    ];
    return {
      start,
      ends,
      vertical: true,
      center: { x: start.x, y: (start.y + ends[0].y) / 2 },
      radius: Math.min(w * 0.6, (ends[2].x - ends[0].x) * 0.9),
    };
  }
  const start: Point = { x: w * 0.06, y: h * 0.5 };
  const ends: Geometry["ends"] = [
    { x: w * 0.94, y: h * 0.24 },
    { x: w * 0.94, y: h * 0.5 },
    { x: w * 0.94, y: h * 0.76 },
  ];
  return {
    start,
    ends,
    vertical: false,
    center: { x: (start.x + ends[0].x) / 2, y: (ends[0].y + ends[2].y) / 2 },
    radius: Math.min(w * 0.48, Math.max(ends[2].y - ends[0].y, ends[0].x - start.x) * 1.05),
  };
}

/**
 * Start the background on `canvas`.
 *
 * @returns A callback for hero events, or null when WebGL2 is unavailable.
 */
export function mountBackground(
  canvas: HTMLCanvasElement,
  reduced: MediaQueryList,
  phoneQuery: MediaQueryList,
): ((event: FlowEvent) => void) | null {
  const phone = phoneQuery.matches;
  const streams = Streams.create(canvas, {
    grains: phone ? 9_000 : 26_000,
    colors: [RIVERS.free, RIVERS.stellar, RIVERS.pix],
    guilloche: [0.034, 0.04, 0.048],
    ramp: " .·:-=+*#%@",
    cell: phone ? { width: 6, height: 11 } : { width: 7, height: 13 },
  });
  if (!streams) {
    canvas.remove();
    return null;
  }

  const still = (): void => streams.frame(performance.now(), geometry(phoneQuery.matches), true);
  const resize = (): void => {
    streams.resize(document.documentElement.clientWidth, document.documentElement.clientHeight);
    if (reduced.matches) still();
  };
  resize();
  window.addEventListener("resize", resize);

  // Shares of the rivers: the first default minute, then the hero's last 14 results.
  let rail: "stellar" | "pix" = "stellar";
  const history: boolean[] = [];
  const apply = (): void => {
    if (history.length === 0) {
      streams.setShares([0.77, 0.23, 0], reduced.matches);
      return;
    }
    const free = history.filter(Boolean).length / history.length;
    const paid = 1 - free;
    const shares: Shares = rail === "stellar" ? [free, paid, 0] : [free, 0, paid];
    streams.setShares(shares, reduced.matches);
  };
  apply();

  let raf = 0;
  const tick = (now: number): void => {
    raf = 0;
    if (reduced.matches || document.hidden) return;
    streams.frame(now, geometry(phoneQuery.matches));
    raf = requestAnimationFrame(tick);
  };
  const start = (): void => {
    if (raf === 0 && !reduced.matches) raf = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", start);
  reduced.addEventListener("change", () => (reduced.matches ? still() : start()));
  void document.fonts.ready.then(() => {
    streams.refreshGlyphs();
    if (reduced.matches) still();
  });
  if (reduced.matches) still();
  else start();

  return (event) => {
    if (event === "stellar" || event === "pix") {
      rail = event;
      streams.firePacket(performance.now());
    } else {
      history.push(event === "free");
      while (history.length > 14) history.shift();
    }
    apply();
  };
}
