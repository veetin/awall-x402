import { serve } from "@hono/node-server";
import { loadPolicy } from "@awall/policy";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const policy = loadPolicy(config.policyPath);

if (!config.payTo) {
  console.warn(
    JSON.stringify({
      msg: "STELLAR_PAY_TO is empty: the exact rail will advertise an empty payTo",
    }),
  );
}

serve({ fetch: createApp(config, policy).fetch, port: config.port });
console.log(
  JSON.stringify({
    msg: "gateway listening",
    port: config.port,
    origin: policy.origin,
    network: config.network,
  }),
);
