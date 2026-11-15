import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Stand-in for a protected API. It knows nothing about payments: AWall sits in
 * front of it. Used by the demo and by the end-to-end script.
 */
const app = new Hono();

type Item = { id: string; name: string; priceCents: number; tags: string[] };

const items: Item[] = [
  { id: "1", name: "Camera DSLR", priceCents: 429900, tags: ["photo", "camera"] },
  { id: "2", name: "Tripod", priceCents: 18900, tags: ["photo", "support"] },
  { id: "3", name: "Lens 50mm", priceCents: 99900, tags: ["photo", "lens"] },
  { id: "4", name: "Microphone", priceCents: 54900, tags: ["audio"] },
];

app.get("/healthz", c => c.json({ ok: true }));

/** Free route in the policy: must keep working without payment. */
app.get("/v1/health", c => c.json({ ok: true, items: items.length }));

/** Expensive route: the policy gives it a quota of its own. */
app.get("/v1/reports/:period", c => {
  const period = c.req.param("period");
  const total = items.reduce((sum, item) => sum + item.priceCents, 0);
  return c.json({ period, items: items.length, totalCents: total });
});

app.get("/v1/search", c => {
  const query = (c.req.query("q") ?? "").toLowerCase();
  const hits = query
    ? items.filter(
        item =>
          item.name.toLowerCase().includes(query) ||
          item.tags.some(tag => tag.includes(query)),
      )
    : items;
  return c.json({ query, count: hits.length, items: hits });
});

app.get("/v1/items/:id", c => {
  const item = items.find(entry => entry.id === c.req.param("id"));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

/** Metered route: reports usage so the gateway can charge actual consumption. */
app.post("/v1/completions", async c => {
  const body = await c.req.json<{ prompt?: string }>().catch(() => ({}) as { prompt?: string });
  const prompt = body.prompt ?? "";
  const outputTokens = Math.max(8, Math.min(512, Math.ceil(prompt.length / 3) + 16));
  return c.json({
    completion: `resposta sintetica para: ${prompt.slice(0, 40)}`,
    usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens },
  });
});

/** Fails on demand, so the gateway's refund path can be exercised. */
app.get("/v1/flaky", c => {
  if (c.req.query("fail") === "1") return c.json({ error: "upstream_boom" }, 500);
  return c.json({ ok: true });
});

const port = Number(process.env["ORIGIN_PORT"] ?? 8787);
serve({ fetch: app.fetch, port });
console.log(JSON.stringify({ msg: "origin-demo listening", port }));
