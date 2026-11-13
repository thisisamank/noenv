import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { CONFIG_FILE } from "@noenv/config";
import { exportPublicKey, generateKeyPair, importPublicKey, wrapPrivateKey } from "@noenv/crypto";
import { api, ApiError, environmentPath, repoPath } from "../api.ts";
import { fetchBundle } from "../bundle.ts";
import { inProject, requireDeployment, signedIn } from "../context.ts";
import { namedDeployment, readAccounts, type Deployment } from "../deployment.ts";
import { select } from "../prompt.ts";
import { requireTarget, type Target } from "../target.ts";

type User = { id: string; email: string; publicKey: string | null };

const ROLES = ["reader", "editor", "admin"];

export async function initCommand(args: string[]): Promise<void> {
  const target = await requireTarget();
  const { deployment, token, identity } = await signedIn(await chooseDeployment(target, accountFlag(args)));

  try {
    await api(deployment, "POST", "/v1/projects", { token, body: { name: basename(target.root), repo: target.repo } });
    console.log(`Created project ${target.repo}`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409)) throw error;
  }

  const environmentKeys = await generateKeyPair();
  const wrappedKey = await wrapPrivateKey(environmentKeys.privateKey, await importPublicKey(identity.publicKey));
  try {
    await api(deployment, "POST", `${repoPath(target.repo)}/environments/${target.environment}`, {
      token,
      body: { publicKey: await exportPublicKey(environmentKeys.publicKey), wrappedKey },
    });
    console.log(`Created environment ${target.environment}`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    console.log(`Environment ${target.environment} already exists`);
  }

  await writeConfig(target, deployment.url);
}

function accountFlag(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args[0] !== "--account" || !args[1] || args.length > 2) throw new Error("usage: noenv init [--account NAME]");
  return args[1];
}

async function chooseDeployment(target: Target, flag: string | undefined): Promise<Deployment> {
  if (target.deployment) {
    const deployment = await requireDeployment(target.deployment);
    if (flag && (await namedDeployment(flag)).url !== deployment.url) {
      throw new Error(`this repository uses the deployment ${target.deployment} in ${CONFIG_FILE}, edit the file to change it`);
    }
    return deployment;
  }
  if (flag) return namedDeployment(flag);
  if (process.env.NOENV_ACCOUNT) return namedDeployment(process.env.NOENV_ACCOUNT);

  const accounts = await readAccounts();
  const names = Object.keys(accounts.accounts).sort((a, b) => Number(b === accounts.default) - Number(a === accounts.default));
  if (names.length === 0) return requireDeployment();
  if (names.length === 1) return namedDeployment(names[0]!, process.env, accounts);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(`you have ${names.length} accounts (${names.join(", ")}), choose one with \`noenv init --account NAME\``);
  }

  const width = Math.max(...names.map((name) => name.length));
  const labels = names.map((name) => `${name.padEnd(width)}  ${accounts.accounts[name]!.url}`);
  const index = await select("Which account should this repository use?", labels);
  if (index === null) throw new Error("cancelled, nothing was created");
  return namedDeployment(names[index]!, process.env, accounts);
}

export async function writeConfig(target: Target, deploymentUrl: string): Promise<void> {
  const path = join(target.root, CONFIG_FILE);
  try {
    await writeFile(path, `version = 1\ndeployment = "${deploymentUrl}"\nenvironment = "${target.environment}"\n`, { flag: "wx" });
    console.log(`Created ${CONFIG_FILE} for ${deploymentUrl}, commit it so teammates load this project`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (target.deployment) return;
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(/^version\s*=.*$/m, (line) => `${line}\ndeployment = "${deploymentUrl}"`));
  console.log(`Saved the deployment ${deploymentUrl} in ${CONFIG_FILE}`);
}

export async function inviteCommand([email]: string[]): Promise<void> {
  if (!email) throw new Error("usage: noenv invite EMAIL");
  const { deployment, token } = await signedIn();

  const invite = await api<{ inviteUrl: string; emailed: boolean }>(deployment, "POST", "/v1/users", { token, body: { email } });
  console.log(invite.emailed ? `Invite emailed to ${email}. The link, in case they need it:` : `Invited ${email}. Send them this link:`);
  console.log(`  ${invite.inviteUrl}`);
}

export async function grantCommand([email, role]: string[]): Promise<void> {
  if (!email || !ROLES.includes(role ?? "")) {
    throw new Error("usage: noenv grant EMAIL reader|editor|admin");
  }
  const { deployment, token, identity, target } = await inProject();
  const user = await findUser(deployment, token, email);

  await api(deployment, "PUT", `${repoPath(target.repo)}/members/${user.id}`, { token, body: { role } });
  console.log(`${email} is now ${role} of ${target.repo}`);

  if (!user.publicKey) {
    console.log(`${email} has not signed in yet. Run this command again after they sign in to share the key.`);
    return;
  }

  const bundle = await fetchBundle(deployment, token, identity.privateKey, target.repo, target.environment);
  const wrappedKey = await wrapPrivateKey(bundle.environmentPrivateKey, await importPublicKey(user.publicKey));
  await api(deployment, "PUT", `${environmentPath(target.repo, target.environment)}/keys/${user.id}`, {
    token,
    body: { wrappedKey },
  });
  console.log(`Shared the ${target.environment} key with ${email}`);
}

export async function revokeCommand([email]: string[]): Promise<void> {
  if (!email) throw new Error("usage: noenv revoke EMAIL");
  const { deployment, token, target } = await inProject();
  const user = await findUser(deployment, token, email);

  await api(deployment, "DELETE", `${repoPath(target.repo)}/members/${user.id}`, { token });
  console.log(`Removed ${email} from ${target.repo}. Rotate secrets they could read.`);
}

async function findUser(deployment: Parameters<typeof api>[0], token: string, email: string): Promise<User> {
  return api<User>(deployment, "GET", `/v1/users/lookup?email=${encodeURIComponent(email)}`, { token });
}
