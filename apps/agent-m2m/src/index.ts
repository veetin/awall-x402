import { readAgentConfig, readSecret } from "./config.js";
import { createPaymentClient, createStellarScheme } from "./payment.js";
import { runAgent, type AgentOptions } from "./agent.js";

/** Command line overrides on top of the environment. */
type CliOptions = {
  dryRun: boolean;
  requests?: number;
  intervalMs?: number;
  url?: string;
  path?: string;
};

/**
 * Parse the agent's command line.
 *
 * @param argv - Arguments after the script name.
 * @returns The overrides the caller asked for.
 * @throws On an unknown flag or a missing value.
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      index += 1;
      return value;
    };
    switch (flag) {
      // `pnpm run <script> -- --flag` forwards the separator as an argument.
      case "--":
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--requests":
        options.requests = Number(next());
        break;
      case "--interval":
        options.intervalMs = Number(next());
        break;
      case "--url":
        options.url = next();
        break;
      case "--path":
        options.path = next();
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

/**
 * Wire the agent from the environment and run it.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));
  const config = readAgentConfig();
  const secret = readSecret();
  const { scheme, address } = createStellarScheme({
    secret,
    network: config.network,
    rpcUrl: config.rpcUrl,
  });
  const payments = createPaymentClient({
    network: config.network,
    scheme,
    maxPaymentUsd: config.maxPaymentUsd,
  });

  const options: AgentOptions = {
    url: cli.url ?? `${config.gatewayUrl}${cli.path ?? config.targetPath}`,
    requests: cli.requests ?? config.requests,
    intervalMs: cli.intervalMs ?? config.intervalMs,
    dryRun: cli.dryRun,
  };

  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  log(`agent    ${address}`);
  log(`network  ${config.network}  rpc ${config.rpcUrl}`);
  log(`target   ${options.url}`);
  log(`mode     ${options.dryRun ? "dry run (no paid request)" : "autonomous"}`);
  log("");

  const summary = await runAgent(options, { fetch, payments, log });

  log("");
  log(
    `done     ${summary.requests} requests  ` +
      `${summary.payments.length} payment(s)  ` +
      `statuses ${JSON.stringify(summary.responses)}`,
  );
  if (summary.stoppedBecause) log(`stopped  ${summary.stoppedBecause}`);

  const failed =
    summary.stoppedBecause !== undefined && summary.stoppedBecause !== "dry run";
  return failed ? 1 : 0;
}

main()
  .then(code => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
