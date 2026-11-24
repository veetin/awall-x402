import { serve } from "@hono/node-server";
import { AbacatePayClient } from "@awall/pix";
import { loadPolicy, policySchema } from "@awall/policy";
import { FacilitatorClient } from "@awall/settlement";
import { activePolicyVersion } from "@awall/ledger";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { log } from "./log.js";
import { SharedQuota } from "./quota.js";
import { RedisBucketBackend } from "./redis.js";

const config = readConfig();
const yaml = loadPolicy(config.policyPath);
const db = await openDatabase(config.databaseUrl);

const active = await activePolicyVersion(db);
let policy = yaml;
if (active) {
  const parsed = policySchema.safeParse(active.content);
  if (parsed.success) policy = parsed.data;
  else log({ msg: "active policy failed validation, keeping yaml", versionId: active.id });
}

if (!config.payTo) {
  log({ msg: "STELLAR_PAY_TO is empty: the exact rail will advertise an empty payTo" });
}

const facilitator = new FacilitatorClient({
  baseUrl: config.facilitatorUrl,
  timeoutMs: config.facilitatorTimeoutMs,
});
const pix = config.abacatePayApiKey
  ? new AbacatePayClient({ apiKey: config.abacatePayApiKey, timeoutMs: config.facilitatorTimeoutMs })
  : null;
const quota = config.redisUrl ? new SharedQuota(new RedisBucketBackend(config.redisUrl)) : undefined;

const app = createApp(config, policy, { db, facilitator, pix, ...(quota ? { quota } : {}) });

serve({ fetch: app.fetch, port: config.port });
log({
  msg: "gateway listening",
  port: config.port,
  origin: policy.origin,
  network: config.network,
  database: config.databaseUrl ? "postgres" : "pglite",
});

if (config.adminPort && config.adminPort !== config.port) {
  serve({ fetch: app.fetch, port: config.adminPort });
  log({ msg: "control plane listening", port: config.adminPort });
}

const retention = config.usageRetentionMs;
setInterval(() => {
  void import("@awall/ledger")
    .then(({ purgeUsageEvents }) => purgeUsageEvents(db, new Date(Date.now() - retention)))
    .then((deleted) => {
      if (deleted > 0) log({ msg: "purged usage events", deleted });
    })
    .catch((error: unknown) => {
      log({ msg: "usage purge failed", error: error instanceof Error ? error.message : "error" });
    });
}, 60 * 60 * 1000).unref();
