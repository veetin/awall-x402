import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  countActiveConsoleUsers,
  createConsoleUser,
  createLedgerDatabase,
  runMigrations,
} from "@awall/ledger";
import { MAX_PASSWORD_BYTES, MAX_USERNAME_LENGTH, hashPassword } from "../src/auth.js";

/**
 * Create the first console user.
 *
 * Without a user nobody can sign in, so this is the bootstrap. The password is
 * read from standard input and never from an argument: an argument lands in the
 * shell history and shows up in the process list for every other user on the
 * machine.
 *
 * Usage:
 *   pnpm --filter @awall/gateway create-user            # prompts for both
 *   pnpm --filter @awall/gateway create-user ada        # prompts for the password
 *   printf 'secret\n' | pnpm --filter @awall/gateway create-user ada
 */

/** Shortest password this script will store. */
const MIN_PASSWORD_LENGTH = 12;

/** Arguments that would put a password on the command line. */
const REFUSED_FLAGS = ["--password", "-p", "--pass"];

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

/**
 * A stdout that can be silenced, so a typed password is not echoed.
 *
 * readline needs an output stream to drive the terminal. Giving it this one
 * keeps the line editing and drops the characters.
 */
class Mutable extends Writable {
  muted = false;

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) process.stdout.write(chunk);
    callback();
  }
}

/**
 * Ask one question on standard input.
 *
 * @param prompt - Text to show before reading. Written straight to stdout, so
 *   it is visible even while the answer is not.
 * @param secret - Whether to hide what is typed.
 * @returns The answer, without the trailing newline.
 */
async function ask(prompt: string, secret: boolean): Promise<string> {
  const output = new Mutable();
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  try {
    process.stdout.write(prompt);
    output.muted = secret;
    const answer = await new Promise<string>((resolve) => rl.question("", resolve));
    if (secret) process.stdout.write("\n");
    return answer;
  } finally {
    output.muted = false;
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  for (const flag of REFUSED_FLAGS) {
    if (args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) {
      fail(
        `create-user: ${flag} is not accepted. A password on the command line ` +
          "lands in the shell history and in the process list. Type it at the " +
          "prompt, or pipe it on standard input.",
      );
    }
  }

  const url = process.env["DATABASE_URL"] ?? "";
  if (!url) {
    fail(
      "create-user: DATABASE_URL is required. Without it the gateway runs on " +
        "an in-memory PGlite that disappears with the process, so a user " +
        "created there could never sign in.",
    );
  }

  const username = (args[0] ?? (await ask("Username: ", false))).trim();
  if (!username) fail("create-user: the username is empty.");
  if (username.length > MAX_USERNAME_LENGTH) {
    fail(`create-user: the username is longer than ${MAX_USERNAME_LENGTH} characters.`);
  }

  const password = await ask("Password: ", true);
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`create-user: the password is shorter than ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    fail(`create-user: the password is longer than ${MAX_PASSWORD_BYTES} bytes.`);
  }
  // Only a terminal can confirm: a pipe has one password in it, not two.
  if (process.stdin.isTTY) {
    const again = await ask("Password again: ", true);
    if (again !== password) fail("create-user: the two passwords do not match.");
  }

  const db = createLedgerDatabase(url, 1);
  try {
    await runMigrations(db);
    const before = await countActiveConsoleUsers(db);
    // The hash is what is stored. The password is not kept, logged or printed.
    const created = await createConsoleUser(db, {
      username,
      passwordHash: await hashPassword(password),
    });
    if (!created.ok) fail(`create-user: the username ${username} is already taken.`);
    out(`created ${created.user.id} (${created.user.username})`);
    if (before === 0) out("This is the first user. Sign in at /login on the console.");
  } finally {
    await db.$client.end();
  }
}

await main();
