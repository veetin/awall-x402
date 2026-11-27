/** Lit panels: a pool of light and a bright edge under the pointer.
 *  The page background lights are fixed and do not follow the mouse. */
export function mountLit(): void {
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      const panel = event.target instanceof Element ? event.target.closest<HTMLElement>(".lit") : null;
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      panel.style.setProperty("--mx", `${event.clientX - box.left}px`);
      panel.style.setProperty("--my", `${event.clientY - box.top}px`);
    },
    { passive: true },
  );
}