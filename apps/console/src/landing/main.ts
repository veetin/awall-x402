import "./landing.css";
import { mountAbuse } from "./abuse";
import { $, $$, trackVisible } from "./dom";
import { Flow, type FlowMode } from "./flow";
import { mountLit } from "./lit";
import { mountRefund } from "./refund";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// The reveal styles only apply once this class is set, so the page stays
// readable if the script never runs.
document.documentElement.classList.add("js");

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
    trigger.setAttribute("aria-pressed", String(trigger.classList.contains("on")));
    trigger.addEventListener("click", () => {
      triggers.forEach((other) => {
        other.classList.remove("on");
        other.setAttribute("aria-pressed", "false");
      });
      targets.forEach((pane) => pane.classList.remove("on"));
      trigger.classList.add("on");
      trigger.setAttribute("aria-pressed", "true");
      targets[index]?.classList.add("on");
    });
  });
}

$$("[data-tabs]").forEach((root) => bindTabs(root, ".tabs button", ".tab"));
$$("[data-cardtabs]").forEach((root) => bindTabs(root, ".cardtabs button", ".cardpane"));

/* ------------------------------------------------------------------------ */
/* Scenes                                                                   */
/* ------------------------------------------------------------------------ */

mountLit();

type Scene = { flow: Flow; visible: { readonly visible: boolean } };
const scenes: Scene[] = [];

// Hero: the simulation the viewer can drive. Under reduced motion it starts
// still and only moves when asked.
const heroStage = $<HTMLElement>("#sim .stage");
const hero = heroStage
  ? Flow.create(heroStage, $<HTMLElement>("#sim .term"), reduced.matches ? "manual" : "auto")
  : null;
if (heroStage && hero) {
  scenes.push({ flow: hero, visible: trackVisible(heroStage) });
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

// Story: the sticky scene follows the step in the middle of the screen.
const STORY_MODES = ["pass", "block", "rails", "blind"] as const;
function isStoryMode(value: string | undefined): value is (typeof STORY_MODES)[number] {
  return STORY_MODES.some((mode) => mode === value);
}

const storyStage = $<HTMLElement>(".story .sticky .stage");
const story = storyStage ? Flow.create(storyStage, null, "pass") : null;
if (storyStage && story) {
  scenes.push({ flow: story, visible: trackVisible(storyStage) });
  const steps = $$<HTMLElement>(".story .step");
  const follow = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
        const mode = entry.target.dataset["mode"];
        if (!isStoryMode(mode)) continue;
        steps.forEach((step) => step.classList.remove("on"));
        entry.target.classList.add("on");
        const next: FlowMode = mode;
        story.setMode(next);
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  steps.forEach((step) => follow.observe(step));
}

const abuse = $<HTMLElement>("[data-abuse]");
if (abuse) mountAbuse(abuse, reduced.matches);

const refund = $<HTMLElement>("[data-refund]");
if (refund) mountRefund(refund, reduced.matches);

// One loop drives every Flow that is on screen. Under reduced motion only the
// hero keeps stepping, and only for what the viewer sends.
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const { flow, visible } of scenes) {
    if (!visible.visible) continue;
    if (reduced.matches && flow !== hero) continue;
    flow.step(dt);
    flow.draw();
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
