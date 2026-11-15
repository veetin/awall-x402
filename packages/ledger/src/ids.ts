import { randomBytes } from "node:crypto";

/** URL-safe alphabet, same shape nanoid uses. */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const DEFAULT_SIZE = 21;

/**
 * Generate a random id with a table prefix.
 *
 * @param prefix - Table prefix, e.g. `idt`, `ofr`, `pay`.
 * @param size - Number of random characters after the prefix.
 * @returns `<prefix>_<random>`.
 */
export function newId(prefix: string, size: number = DEFAULT_SIZE): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i += 1) {
    // 64-character alphabet: 6 bits per character, no modulo bias.
    id += ALPHABET[(bytes[i] ?? 0) & 63];
  }
  return `${prefix}_${id}`;
}

export const newIdentityId = (): string => newId("idt");
export const newOfferId = (): string => newId("ofr");
export const newPaymentId = (): string => newId("pay");
