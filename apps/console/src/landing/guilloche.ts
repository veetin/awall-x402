export const GUILLOCHE_CURVES = 18;

/** Largest radius the formula reaches: 58 + 26 + 9. */
export const GUILLOCHE_MAX = 93;

function radius(angle: number, curve: number): number {
  return (
    58 +
    26 * Math.sin(12 * angle + 0.349 * curve) * Math.cos(5 * angle - 0.21 * curve) +
    9 * Math.sin(31 * angle + curve)
  );
}

/**
 * Points of every closed curve, normalised so the largest radius is 1.
 *
 * @param steps - Segments per curve.
 * @returns One array per curve, `[x0, y0, x1, y1, ...]`, closed on itself.
 */
export function guillocheCurves(steps: number): Float32Array[] {
  const curves: Float32Array[] = [];
  for (let curve = 0; curve < GUILLOCHE_CURVES; curve += 1) {
    const points = new Float32Array((steps + 1) * 2);
    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const r = radius(angle, curve) / GUILLOCHE_MAX;
      points[step * 2] = r * Math.cos(angle);
      points[step * 2 + 1] = r * Math.sin(angle);
    }
    curves.push(points);
  }
  return curves;
}

/** The same curves as one SVG path, in a `-100 -100 200 200` view box. */
export function guillochePath(steps: number): string {
  const parts: string[] = [];
  for (let curve = 0; curve < GUILLOCHE_CURVES; curve += 1) {
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const r = radius(angle, curve);
      const x = (r * Math.cos(angle)).toFixed(2);
      const y = (r * Math.sin(angle)).toFixed(2);
      parts.push(`${step === 0 ? "M" : "L"}${x} ${y}`);
    }
    parts.push("Z");
  }
  return parts.join("");
}
