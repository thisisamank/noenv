import { IDENTIFIER } from "@noenv/config/names";
import { deploymentAt, readAccounts, writeAccounts } from "../deployment.ts";
import { loadSession } from "../session.ts";

const USAGE = "usage: noenv account add NAME URL [REPO_PREFIX...] | list | default NAME | remove NAME";
const PREFIX = /^[a-z0-9.-]+(\/[a-z0-9._~-]+)*\/?$/;

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

async function addAccount([name, url, ...match]: string[]): Promise<void> {
  if (!name || !url) throw new Error(USAGE);
  if (!IDENTIFIER.test(name)) throw new Error('the account name must contain only letters, digits, "_" or "-"');
  const deployment = deploymentAt(url);
  const prefixes = match.map((prefix) => prefix.toLowerCase());
  const invalid = prefixes.find((prefix) => !PREFIX.test(prefix));
  if (invalid) throw new Error(`${invalid} is not a repository prefix such as github.com/acme`);

  const accounts = await readAccounts();
  const clash = Object.entries(accounts.accounts).find(([other, account]) => other !== name && deploymentAt(account.url).url === deployment.url);
  if (clash) throw new Error(`the account "${clash[0]}" already uses ${deployment.url}`);

  accounts.accounts[name] = { url: deployment.url, match: prefixes };
  accounts.default ??= name;
  await writeAccounts(accounts);
  console.log(`Saved account ${name} (${deployment.url})${accounts.default === name ? " as the default" : ""}`);
  if (!(await loadSession(deployment))) console.log(`Run \`noenv auth ${name}\` to sign in`);
}

async function listAccounts(): Promise<void> {
  const accounts = await readAccounts();
  const entries = Object.entries(accounts.accounts);
  if (entries.length === 0) {
    console.log("No accounts. Add one with `noenv account add NAME URL [REPO_PREFIX...]`");
    return;
  }
  for (const [name, account] of entries) {
    const signedIn = (await loadSession(deploymentAt(account.url))) ? "signed in" : "signed out";
    const marker = accounts.default === name ? "*" : " ";
    const match = account.match.length > 0 ? `  ${account.match.join(", ")}` : "";
    console.log(`${marker} ${name}  ${account.url}  ${signedIn}${match}`);
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
