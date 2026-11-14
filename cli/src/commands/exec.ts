import { spawn } from "node:child_process";
import { constants } from "node:os";
import { describeSkipped, openBundle } from "../bundle.ts";
import { resolveDeployment } from "../deployment.ts";
import { decodeState } from "../hook-env.ts";
import { ensureIdentity, loadIdentity } from "../identity.ts";
import { readCache, refresh } from "../refresh.ts";
import { requireSession } from "../session.ts";
import { findTarget } from "../target.ts";

const SHELL_STATE = ["_NOENV_STATE", "_NOENV_RETRY", "_NOENV_REV_FILE", "_NOENV_REV", "_NOENV_ROOT"];

export async function execCommand(args: string[]): Promise<void> {
  const command = args[0] === "--" ? args.slice(1) : args;
  if (command.length === 0) throw new Error("usage: noenv exec -- COMMAND [ARGS...]");

  const env = withoutLoadedSecrets(process.env);
  const secrets = await projectSecrets(env);
  const child = spawn(command[0]!, command.slice(1), { stdio: "inherit", env: { ...env, ...secrets } });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => resolve(exitCode ?? 128 + (signal ? constants.signals[signal] : 0)));
  });
  process.exit(code);
}

export function withoutLoadedSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const state = decodeState(env._NOENV_STATE);
  const clean = { ...env };
  for (const name of SHELL_STATE) delete clean[name];
  for (const [name, value] of Object.entries(state?.previous ?? {})) {
    if (value === null) delete clean[name];
    else clean[name] = value;
  }
  return clean;
}

async function projectSecrets(env: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  const target = await findTarget(process.cwd(), env);
  if (!target) return note("not in a git repository with an origin, running without secrets");
  const deployment = await resolveDeployment(target.deployment, env);
  if (!deployment) return note("no account is set up, running without secrets");

  const token = await requireSession(deployment);
  const identity = (await loadIdentity(deployment)) ?? (await ensureIdentity(deployment, token));
  const label = `${target.repo} (${target.environment})`;

  let entry = await refresh(deployment, target);
  if (!entry) {
    entry = await readCache(deployment, target);
    if (!entry) throw new Error(`could not reach ${deployment.url} and there are no cached secrets for ${label}`);
    note(`could not reach ${deployment.url}, using cached secrets`);
  }

  if ("error" in entry) {
    if ((entry.status === 403 || entry.status === 404) && !target.hasConfig) {
      return note(`you have no noenv project for ${target.repo} on ${deployment.account ?? deployment.url}, running without secrets`);
    }
    throw new Error(`could not load secrets for ${label}: ${entry.error}`);
  }
  for (const line of entry.notes) note(line);
  if (entry.blocked) throw new Error(`secrets for ${label} were not loaded because of the .env policy`);

  const bundle = await openBundle(entry.raw, identity.privateKey, target.environment);
  for (const line of describeSkipped(bundle)) note(line);
  const { secrets } = bundle;
  note(`loaded ${Object.keys(secrets).length} secrets for ${label}${deployment.account ? ` from ${deployment.account}` : ""}`);
  const missing = target.requiredSecrets.filter((name) => !(name in secrets));
  if (missing.length > 0) note(`missing required secrets: ${missing.join(", ")}`);
  return secrets;
}

function note(message: string): Record<string, string> {
  process.stderr.write(`noenv: ${message}\n`);
  return {};
}
