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

export async function resolveDeployment(projectUrl: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<Deployment | null> {
  const accounts = await readAccounts(env);
  if (projectUrl) return projectDeployment(accounts, projectUrl, env);

  const name = env.NOENV_ACCOUNT || accounts.default;
  if (name) return namedDeployment(name, env, accounts);
  return env.NOENV_URL ? deploymentAt(env.NOENV_URL, env) : null;
}

export async function namedDeployment(name: string, env: NodeJS.ProcessEnv = process.env, accounts?: Accounts): Promise<Deployment> {
  const found = (accounts ?? (await readAccounts(env))).accounts[name];
  if (!found) throw new Error(`there is no account named "${name}", run \`noenv account list\``);
  return deploymentAt(found.url, env, name);
}

function projectDeployment(accounts: Accounts, projectUrl: string, env: NodeJS.ProcessEnv): Deployment {
  for (const [name, account] of Object.entries(accounts.accounts)) {
    const deployment = deploymentAt(account.url, env, name);
    if (deployment.url === projectUrl) return deployment;
  }
  if (env.NOENV_URL && deploymentAt(env.NOENV_URL, env).url === projectUrl) return deploymentAt(env.NOENV_URL, env);
  throw new Error(`this repository uses the deployment ${projectUrl}, add it with \`noenv account add ${projectUrl}\``);
}

function accountsPath(env: NodeJS.ProcessEnv): string {
  return join(configDir(env), "accounts.json");
}
