/** Small DOM helpers shared by the landing modules. */

export function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function $$<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Like `$`, but a missing element is a bug in the markup, so it throws. */
export function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`landing: missing element ${selector}`);
  return found;
}

/** Fit a canvas to its parent at the device pixel ratio and report CSS size. */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  parent: HTMLElement,
): { width: number; height: number } {
  const box = parent.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: box.width, height: box.height };
}

/** Run `fn` only while `element` is on screen, and report the current state. */
export function trackVisible(element: Element): { readonly visible: boolean } {
  const state = { visible: true };
  new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last !== undefined) state.visible = last.isIntersecting;
  }).observe(element);
  return state;
}
