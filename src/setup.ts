import axios from "axios";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  getHomeConfigPath,
  normalizeBaseUrl,
  readConfigValues,
  writeHomeConfig,
  writeKeychainToken,
} from "./config.js";

interface SetupArgs {
  host?: string;
  apiBasePath?: string;
  token?: string;
  defaultPageSize?: string;
  nonInteractive: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = { nonInteractive: false, help: false };
  const valueFor = (index: number, flag: string): [string, number] => {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
    return [value, index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--non-interactive" || arg === "-n") args.nonInteractive = true;
    else if (arg === "--host" || arg === "-H") [args.host, index] = valueFor(index, arg);
    else if (arg === "--api-base-path" || arg === "-b") [args.apiBasePath, index] = valueFor(index, arg);
    else if (arg === "--token" || arg === "-t") [args.token, index] = valueFor(index, arg);
    else if (arg === "--default-page-size" || arg === "-s") [args.defaultPageSize, index] = valueFor(index, arg);
    else throw new Error(`Unknown setup option: ${arg}`);
  }
  return args;
}

function printHelp(): void {
  output.write("Usage: confluence-data-center-mcp setup [options]\n\n");
  output.write("Options:\n");
  output.write("  -H, --host <value>              Confluence host or full URL\n");
  output.write("  -b, --api-base-path <value>     Confluence API base path or full URL\n");
  output.write("  -t, --token <value>              Confluence personal access token\n");
  output.write("  -s, --default-page-size <n>      Default page size (default: 25)\n");
  output.write("  -n, --non-interactive            Do not prompt\n");
  output.write("  -h, --help                       Show this help\n");
}

function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1) throw new Error("Default page size must be a positive integer");
  return parsed;
}

async function validateCredentials(baseUrl: string, token: string, timeout: number): Promise<void> {
  await axios.get(`${baseUrl}/rest/api/user/current`, {
    timeout: Math.min(timeout, 10_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
}

export async function runSetup(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const current = readConfigValues();
  const readline = args.nonInteractive ? undefined : createInterface({ input, output });
  try {
    const ask = async (message: string, fallback: string): Promise<string> => {
      if (!readline) return fallback;
      const answer = await readline.question(`${message}${fallback ? ` [${fallback}]` : ""}: `);
      return answer.trim() || fallback;
    };

    const host = await ask("Confluence host", args.host ?? current.baseUrl ?? "");
    const apiBasePath = await ask("API base path", args.apiBasePath ?? "");
    const token = args.token ?? current.token ?? await ask("API token", "");
    const pageSize = positiveInteger(await ask("Default page size", args.defaultPageSize ?? String(current.defaultPageSize)));
    const baseUrl = normalizeBaseUrl(host, apiBasePath || undefined);
    if (!baseUrl) throw new Error("A Confluence host or API base path is required");
    if (!token) throw new Error("A Confluence API token is required");

    try {
      await validateCredentials(baseUrl, token, current.requestTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (args.nonInteractive || !readline) throw new Error(`Credential validation failed: ${message}`);
      const saveAnyway = await readline.question(`Credential validation failed (${message}). Save anyway? [y/N]: `);
      if (!/^y(es)?$/i.test(saveAnyway.trim())) throw new Error("Setup cancelled");
    }

    const keychainStored = writeKeychainToken(token);
    writeHomeConfig({ baseUrl, token: keychainStored ? undefined : token, defaultPageSize: pageSize }, { clearToken: keychainStored });
    output.write(keychainStored
      ? `Saved Confluence configuration to ${getHomeConfigPath()} and the macOS Keychain\n`
      : `Saved Confluence configuration to ${getHomeConfigPath()}\n`);
  } finally {
    readline?.close();
  }
}
