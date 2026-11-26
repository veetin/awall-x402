const SECRET_KEYS = new Set([
  "authorization",
  "apiKey",
  "api_key",
  "x-api-key",
  "body",
  "paymentSignature",
  "payment-signature",
  "secret",
  "webhookSecret",
  "token",
]);

/**
 * One JSON log line.
 *
 * Request bodies, API keys and payment signatures are dropped here even if a
 * caller puts them in the fields. Personal data does not belong in the log.
 *
 * @param fields - Event fields. `msg` should name what happened.
 */
export function log(fields: Record<string, unknown>): void {
  const safe: Record<string, unknown> = { time: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  console.log(JSON.stringify(safe));
}
