import { IDENTIFIER } from "@noenv/config/names";
import { deploymentAt, readAccounts, writeAccounts } from "../deployment.ts";
import { loadSession } from "../session.ts";

const USAGE = "usage: noenv account add NAME URL | list | default NAME | remove NAME";

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

async function addAccount([name, url, ...extra]: string[]): Promise<void> {
  if (!name || !url) throw new Error(USAGE);
  if (extra.length > 0) {
    throw new Error("repository prefixes are no longer used, `noenv init` saves the deployment in the .noenv file of each repository");
  }
  if (!IDENTIFIER.test(name)) throw new Error('the account name must contain only letters, digits, "_" or "-"');
  const deployment = deploymentAt(url);

  const accounts = await readAccounts();
  const clash = Object.entries(accounts.accounts).find(([other, account]) => other !== name && deploymentAt(account.url).url === deployment.url);
  if (clash) throw new Error(`the account "${clash[0]}" already uses ${deployment.url}`);

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
    console.log("No accounts. Add one with `noenv account add NAME URL`");
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
