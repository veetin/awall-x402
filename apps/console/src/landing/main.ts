import { mountAbuse } from "./abuse";
import { $, $$, trackVisible } from "./dom";
import { Flow } from "./flow";
import { mountRefund } from "./refund";
import { mountStars } from "./stars";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ------------------------------------------------------------------------ */
/* Reveal on scroll                                                         */
/* ------------------------------------------------------------------------ */

const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      reveal.unobserve(entry.target);
    }
  },
  { threshold: 0.15 },
);
$$(".rv").forEach((element) => reveal.observe(element));

/* ------------------------------------------------------------------------ */
/* Tabs                                                                     */
/* ------------------------------------------------------------------------ */

/** Show the pane at the same index as the clicked button. */
function bindTabs(root: Element, buttons: string, panes: string): void {
  const triggers = $$<HTMLButtonElement>(buttons, root);
  const targets = $$<HTMLElement>(panes, root);
  triggers.forEach((trigger, index) => {
    trigger.addEventListener("click", () => {
      triggers.forEach((other) => other.classList.remove("on"));
      targets.forEach((pane) => pane.classList.remove("on"));
      trigger.classList.add("on");
      targets[index]?.classList.add("on");
    });
  });
}

$$("[data-tabs]").forEach((root) => bindTabs(root, ".tabs button", ".tab"));
$$("[data-cardtabs]").forEach((root) => bindTabs(root, ".cardtabs button", ".cardpane"));

/* ------------------------------------------------------------------------ */
/* Hero simulation                                                          */
/* ------------------------------------------------------------------------ */

// The simulation the viewer can drive. Under reduced motion it starts still
// and only moves when asked.
const heroStage = $<HTMLElement>("#sim .stage");
const hero = heroStage ? Flow.create(heroStage, $<HTMLElement>("#sim .term"), reduced.matches ? "manual" : "auto") : null;
const heroVisible = heroStage ? trackVisible(heroStage) : null;
if (hero) {
  for (const button of $$<HTMLButtonElement>("#sim .ctrl button")) {
    button.addEventListener("click", () => {
      const action = button.dataset["a"];
      if (action === "req") {
        hero.manual();
        hero.send();
      } else if (action === "burst") {
        hero.burst();
      } else if (action === "stellar" || action === "pix") {
        hero.manual();
        hero.pay(action);
      } else if (action === "auto") {
        hero.auto();
      }
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Story: the active step, and the step indicator                           */
/* ------------------------------------------------------------------------ */

const storySection = $<HTMLElement>(".story3");
const steps = $$<HTMLElement>(".story .step");
const indicator = $<HTMLElement>("[data-storyprog]");
const indicatorLinks = indicator ? $$<HTMLAnchorElement>("a", indicator) : [];

if (steps.length > 0) {
  const follow = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
        const index = steps.indexOf(entry.target);
        steps.forEach((step) => step.classList.remove("on"));
        entry.target.classList.add("on");
        indicatorLinks.forEach((link, k) => link.classList.toggle("on", k === index));
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  steps.forEach((step) => follow.observe(step));

  indicatorLinks.forEach((link, index) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      steps[index]?.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
    });
  });

  // The indicator only shows while the reader is inside the story.
  const first = steps[0];
  const lastStep = steps[steps.length - 1];
  if (indicator && first && lastStep) {
    addEventListener(
      "scroll",
      () => {
        const a = first.getBoundingClientRect();
        const b = lastStep.getBoundingClientRect();
        const mid = innerHeight * 0.5;
        indicator.classList.toggle("show", a.top < mid && b.bottom > mid * 0.9);
      },
      { passive: true },
    );
  }
}

const starCanvas = $<HTMLCanvasElement>(".bg-particles");
if (starCanvas && storySection) mountStars(starCanvas, storySection, reduced);

/* ------------------------------------------------------------------------ */
/* Recursos                                                                 */
/* ------------------------------------------------------------------------ */

const abuse = $<HTMLElement>("[data-abuse]");
if (abuse) mountAbuse(abuse, reduced.matches);

const refund = $<HTMLElement>("[data-refund]");
if (refund) mountRefund(refund, reduced.matches);

// The hero is the only Flow on the page, so one loop drives it while it is
// on screen.
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (hero && heroVisible?.visible) {
    hero.step(dt);
    hero.draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ------------------------------------------------------------------------ */
/* Closing banner                                                           */
/* ------------------------------------------------------------------------ */

const banner = $<HTMLElement>("[data-scramble]");
if (banner && !reduced.matches) {
  const text = banner.textContent ?? "";
  const glyphs = "#%@*+=-:.░▒▓";
  const seen = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      const started = performance.now();
      const frame = (now: number): void => {
        const progress = Math.min(1, (now - started) / 1400);
        let out = "";
        for (let i = 0; i < text.length; i += 1) {
          const char = text[i] ?? "";
          const settled = char === " " || char === "\n" || i / text.length < progress;
          out += settled ? char : (glyphs[Math.floor(Math.random() * glyphs.length)] ?? char);
        }
        banner.textContent = out;
        if (progress < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { threshold: 0.3 },
  );
  seen.observe(banner);
}
