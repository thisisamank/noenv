import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./files.ts";

export type Deployment = {
  url: string;
  dir: string;
  fetch: typeof fetch;
  account?: string;
};

export type Account = {
  url: string;
  match: string[];
};

export type Accounts = {
  default?: string;
  accounts: Record<string, Account>;
};

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.NOENV_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "noenv");
}

export function deploymentAt(value: string, env: NodeJS.ProcessEnv = process.env, account?: string): Deployment {
  const url = URL.parse(value);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error(`${value} is not an http or https URL`);
  }
  return { url: url.origin, dir: join(configDir(env), url.host.replace(":", "_")), fetch: globalThis.fetch, account };
}

export async function readAccounts(env: NodeJS.ProcessEnv = process.env): Promise<Accounts> {
  return (await readJsonFile<Accounts>(accountsPath(env))) ?? { accounts: {} };
}

export async function writeAccounts(accounts: Accounts, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writeJsonFile(accountsPath(env), accounts);
}

export function matchAccount(accounts: Accounts, repo: string): string | undefined {
  let best: { name: string; length: number } | undefined;
  for (const [name, account] of Object.entries(accounts.accounts)) {
    for (const prefix of account.match) {
      const clean = prefix.toLowerCase().replace(/\/+$/, "");
      if ((repo === clean || repo.startsWith(`${clean}/`)) && clean.length > (best?.length ?? -1)) {
        best = { name, length: clean.length };
      }
    }
  }
  return best?.name;
}

export async function resolveDeployment(repo: string | null, env: NodeJS.ProcessEnv = process.env): Promise<Deployment | null> {
  const accounts = await readAccounts(env);
  const name = env.NOENV_ACCOUNT || (repo ? matchAccount(accounts, repo) : undefined) || accounts.default;
  if (name) {
    const account = accounts.accounts[name];
    if (!account) throw new Error(`there is no account named "${name}", run \`noenv account list\``);
    return deploymentAt(account.url, env, name);
  }
  return env.NOENV_URL ? deploymentAt(env.NOENV_URL, env) : null;
}

function accountsPath(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), "accounts.json");
}
