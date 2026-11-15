import { expect } from "vitest";
import type { FetchLike } from "../src/client.js";
import type { Result } from "../src/result.js";

export interface StubCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export interface FetchStub {
  readonly fetch: FetchLike;
  readonly calls: StubCall[];
}

/** A `fetch` that answers from a queue of canned responses. No network. */
export function stubFetch(
  responses: readonly (() => Response | Promise<Response>)[],
): FetchStub {
  const calls: StubCall[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses[index];
    index += 1;
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    return next();
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    expect.fail(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    expect.fail(`expected error, got value: ${JSON.stringify(result.value, bigintSafe)}`);
  }
  return result.error;
}

function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
