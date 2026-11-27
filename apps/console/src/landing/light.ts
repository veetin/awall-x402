/** Light that follows the pointer: it reveals the page texture and pools
 *  under glass panels. Static (parked at the top) with reduced motion or touch. */
export function mountLight(reduced: MediaQueryList): void {
  const root = document.documentElement;
  let targetX = window.innerWidth * 0.5;
  let targetY = window.innerHeight * 0.3;
  let x = targetX;
  let y = targetY;
  let frame = 0;

  const apply = (): void => {
    root.style.setProperty("--lx", `${x.toFixed(1)}px`);
    root.style.setProperty("--ly", `${y.toFixed(1)}px`);
  };
  apply();
  if (reduced.matches) return;

  const tick = (): void => {
    x += (targetX - x) * 0.12;
    y += (targetY - y) * 0.12;
    apply();
    const settled = Math.abs(targetX - x) < 0.5 && Math.abs(targetY - y) < 0.5;
    frame = settled ? 0 : requestAnimationFrame(tick);
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      targetX = event.clientX;
      targetY = event.clientY;
      if (frame === 0) frame = requestAnimationFrame(tick);

      const panel = event.target instanceof Element ? event.target.closest<HTMLElement>(".lit") : null;
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      panel.style.setProperty("--mx", `${event.clientX - box.left}px`);
      panel.style.setProperty("--my", `${event.clientY - box.top}px`);
    },
    { passive: true },
  );
}