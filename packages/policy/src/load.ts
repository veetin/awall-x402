import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { policySchema, type Policy } from "./types.js";

/**
 * Read and validate a policy file.
 *
 * @param path - Path to the YAML policy file.
 * @returns The parsed policy.
 * @throws If the file is unreadable or the contents do not match the schema.
 */
export function loadPolicy(path: string): Policy {
  const raw = parse(readFileSync(path, "utf8")) as unknown;
  const result = policySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid policy at ${path}: ${result.error.message}`);
  }
  return result.data;
}
