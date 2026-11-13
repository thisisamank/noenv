import { IDENTIFIER } from "@noenv/config/names";
import { api } from "../api.ts";
import { deploymentAt, readAccounts, writeAccounts, type Deployment } from "../deployment.ts";
import { loadSession } from "../session.ts";

const USAGE = "usage: noenv account add URL [NAME] | list | default NAME | remove NAME";

export async function accountCommand([action, ...args]: string[]): Promise<void> {
  const handlers: Record<string, (args: string[]) => Promise<void>> = {
    add: addAccount,
    list: listAccounts,
    default: setDefault,
    remove: removeAccount,
  };
  const handler = handlers[action ?? ""];
  if (!handler) throw new Error(USAGE);
  await handler(args);
}

async function addAccount(args: string[]): Promise<void> {
  if (args.length === 0 || args.length > 2) throw new Error(USAGE);
  const [url, chosen] = isUrl(args[0]!) ? [args[0]!, args[1]] : [args[1], args[0]];
  if (!url || !isUrl(url)) throw new Error(USAGE);
  const deployment = deploymentAt(url);
  const name = chosen ?? (await teamName(deployment));
  if (!IDENTIFIER.test(name)) throw new Error('the account name must contain only letters, digits, "_" or "-"');

  const accounts = await readAccounts();
  const same = Object.entries(accounts.accounts).find(([, account]) => deploymentAt(account.url).url === deployment.url);
  if (same && same[0] !== name) throw new Error(`${deployment.url} is already the account "${same[0]}"`);
  const taken = accounts.accounts[name];
  if (taken && deploymentAt(taken.url).url !== deployment.url) {
    throw new Error(`the name "${name}" is already used for ${taken.url}, choose another: \`noenv account add ${deployment.url} NAME\``);
  }

  accounts.accounts[name] = { url: deployment.url };
  accounts.default ??= name;
  await writeAccounts(accounts);
  console.log(`Saved account ${name} (${deployment.url})${accounts.default === name ? " as the default" : ""}`);
  if (!(await loadSession(deployment))) console.log(`Run \`noenv auth ${name}\` to sign in`);
}

async function listAccounts(): Promise<void> {
  const accounts = await readAccounts();
  const entries = Object.entries(accounts.accounts);
  if (entries.length === 0) {
    console.log("No accounts. Add one with `noenv account add URL`");
    return;
  }
  for (const [name, account] of entries) {
    const signedIn = (await loadSession(deploymentAt(account.url))) ? "signed in" : "signed out";
    const marker = accounts.default === name ? "*" : " ";
    console.log(`${marker} ${name}  ${account.url}  ${signedIn}`);
  }
}

async function setDefault([name]: string[]): Promise<void> {
  const accounts = await readAccounts();
  if (!name || !accounts.accounts[name]) throw new Error(`there is no account named "${name ?? ""}"`);
  accounts.default = name;
  await writeAccounts(accounts);
  console.log(`${name} is now the default account`);
}

async function removeAccount([name]: string[]): Promise<void> {
  const accounts = await readAccounts();
  if (!name || !accounts.accounts[name]) throw new Error(`there is no account named "${name ?? ""}"`);
  delete accounts.accounts[name];
  if (accounts.default === name) delete accounts.default;
  await writeAccounts(accounts);
  console.log(`Removed account ${name}. Its key stays on this machine, so adding it again keeps your access.`);
}

export function accountName(teamName: string): string {
  return teamName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function teamName(deployment: Deployment): Promise<string> {
  const reported = await api<{ name?: unknown }>(deployment, "GET", "/v1/deployment").catch(() => null);
  const name = typeof reported?.name === "string" ? accountName(reported.name) : "";
  if (!name) throw new Error(`${deployment.url} did not report a team name, choose one: \`noenv account add ${deployment.url} NAME\``);
  return name;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && URL.canParse(value);
}
