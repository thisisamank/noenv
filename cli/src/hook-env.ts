import { enforceDotenvPolicy } from "@noenv/dotenv";
import { ApiError } from "./api.ts";
import { fetchBundle, type Bundle } from "./bundle.ts";
import { describeOutcome, reportCompliance } from "./compliance.ts";
import type { Deployment } from "./deployment.ts";
import { ensureIdentity, loadIdentity, type Identity } from "./identity.ts";
import { remoteSecretStore } from "./secret-store.ts";
import { clearSession, loadSession, readPendingSignIn, startSignIn } from "./session.ts";
import { exportLine, setLine, unsetLine } from "./shell.ts";
import { findTarget, type Target } from "./target.ts";
import { markerPath, readMarker, watchEnvironment, writeMarker } from "./watch.ts";

type LoadedState = {
  url?: string;
  repo: string;
  environment: string;
  previous: Record<string, string | null>;
  retry: boolean;
  notified?: string;
  revision?: number;
};

export type HookInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  state: string;
  resolveDeployment: (repo: string) => Promise<Deployment | null>;
  startPoller: (deployment: Deployment) => void;
  startWatcher: (deployment: Deployment) => void;
  openBrowser: (url: string) => void;
};

type Resolved = {
  target: Target;
  deployment: Deployment;
};

export type HookOutput = {
  lines: string[];
  messages: string[];
};

export async function hookEnv(input: HookInput): Promise<HookOutput> {
  const state = decodeState(input.state);
  const messages: string[] = [];
  const resolved = await resolve(input, messages);

  if (state && resolved && !state.retry && sameTarget(state, resolved) && (await isCurrent(resolved.deployment, state))) {
    return { lines: [], messages };
  }

  const lines = state ? restoreLines(state) : [];
  if (!resolved) {
    if (state) lines.push(...["_NOENV_STATE", "_NOENV_RETRY", "_NOENV_REV_FILE", "_NOENV_REV"].map(unsetLine));
    return { lines, messages };
  }

  const loaded = await load(input, resolved, state, messages);
  lines.push(
    ...loaded.lines,
    setLine("_NOENV_STATE", encodeState(loaded.state)),
    loaded.state.retry ? setLine("_NOENV_RETRY", "1") : unsetLine("_NOENV_RETRY"),
    ...revisionLines(resolved, loaded.state.revision),
  );
  return { lines, messages };
}

function sameTarget(state: LoadedState, { target, deployment }: Resolved): boolean {
  return state.url === deployment.url && state.repo === target.repo && state.environment === target.environment;
}

async function isCurrent(deployment: Deployment, state: LoadedState): Promise<boolean> {
  if (state.revision === undefined) return true;
  return (await readMarker(markerPath(deployment, state.repo, state.environment))) === String(state.revision);
}

function revisionLines({ target, deployment }: Resolved, revision: number | undefined): string[] {
  if (revision === undefined) return [unsetLine("_NOENV_REV_FILE"), unsetLine("_NOENV_REV")];
  return [setLine("_NOENV_REV_FILE", markerPath(deployment, target.repo, target.environment)), setLine("_NOENV_REV", String(revision))];
}

async function load(
  input: HookInput,
  resolved: Resolved,
  state: LoadedState | null,
  messages: string[],
): Promise<{ lines: string[]; state: LoadedState }> {
  const { target, deployment } = resolved;
  const empty: LoadedState = { url: deployment.url, repo: target.repo, environment: target.environment, previous: {}, retry: false };

  try {
    const token = await loadSession(deployment);
    if (!token) {
      return { lines: [], state: await signIn(input, deployment, empty, state, messages) };
    }

    const identity = (await loadIdentity(deployment)) ?? (await ensureIdentity(deployment, token));
    let bundle = await fetchBundle(deployment, token, identity.privateKey, target.repo, target.environment);

    const dotenv = await enforceDotenv({ deployment, token, identity, target, bundle }, messages);
    if (dotenv.blocked) {
      return { lines: [], state: empty };
    }
    if (dotenv.changed) {
      bundle = await fetchBundle(deployment, token, identity.privateKey, target.repo, target.environment);
    }

    const lines: string[] = [];
    const previous: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(bundle.secrets)) {
      previous[name] = state && name in state.previous ? state.previous[name] : (input.env[name] ?? null);
      lines.push(exportLine(name, value));
    }

    const reloaded = state !== null && sameTarget(state, resolved) && state.revision !== undefined;
    messages.push(`${reloaded ? "updated" : "loaded"} ${lines.length} secrets for ${target.repo} (${target.environment})`);
    const missing = target.requiredSecrets.filter((name) => !(name in bundle.secrets));
    if (missing.length > 0) {
      messages.push(`missing required secrets: ${missing.join(", ")}`);
    }
    await writeMarker(markerPath(deployment, target.repo, target.environment), String(bundle.revision));
    await watchEnvironment(deployment, target.repo, target.environment);
    input.startWatcher(deployment);
    return { lines, state: { ...empty, previous, revision: bundle.revision } };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearSession(deployment);
      return { lines: [], state: { ...empty, retry: true } };
    }
    if (!(error instanceof ApiError && error.status === 403 && !target.hasConfig)) {
      messages.push(`could not load secrets for ${target.repo} (${target.environment}): ${describe(error)}`);
    }
    return { lines: [], state: empty };
  }
}

type Loaded = {
  deployment: Deployment;
  token: string;
  identity: Identity;
  target: Target;
  bundle: Bundle;
};

async function enforceDotenv(loaded: Loaded, messages: string[]): Promise<{ blocked: boolean; changed: boolean }> {
  const { deployment, token, identity, target, bundle } = loaded;
  const policy = bundle.policies.dotenv;
  const store = remoteSecretStore(deployment, token, identity, target.repo, target.environment, bundle);
  const result = await enforceDotenvPolicy(target.root, policy, store);

  if (result.files.length === 0) {
    return { blocked: false, changed: false };
  }

  messages.push(...result.files.map((file) => describeOutcome(target, file)));
  if (result.blocked) {
    messages.push(`secrets were not loaded: the "${policy.mode}" policy does not allow .env files, run \`noenv migrate\``);
  }
  await reportCompliance(deployment, token, target, result).catch(() => messages.push("could not report compliance"));

  return { blocked: result.blocked, changed: result.files.some((file) => file.status === "deleted") };
}

async function signIn(
  input: HookInput,
  deployment: Deployment,
  empty: LoadedState,
  state: LoadedState | null,
  messages: string[],
): Promise<LoadedState> {
  const waiting = await readPendingSignIn(deployment);
  if (state?.notified && !(waiting && waiting.expiresAt > Date.now())) {
    messages.push("sign-in was not completed, run `noenv auth` to try again");
    return empty;
  }

  const { pending, started } = await startSignIn(deployment);
  if (started) {
    input.startPoller(deployment);
    input.openBrowser(pending.url);
  }
  if (started || state?.notified !== pending.userCode) {
    const account = deployment.account ? ` to ${deployment.account}` : "";
    messages.push(`sign in${account} to load secrets: open ${pending.url} and confirm the code ${pending.userCode}`);
  }
  return { ...empty, retry: true, notified: pending.userCode };
}

async function resolve(input: HookInput, messages: string[]): Promise<Resolved | null> {
  try {
    const target = await findTarget(input.cwd, input.env);
    const deployment = target && (await input.resolveDeployment(target.repo));
    return target && deployment ? { target, deployment } : null;
  } catch (error) {
    messages.push(describe(error));
    return null;
  }
}

function restoreLines(state: LoadedState): string[] {
  return Object.entries(state.previous).map(([name, value]) => (value === null ? unsetLine(name) : exportLine(name, value)));
}

function encodeState(state: LoadedState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64");
}

function decodeState(text: string): LoadedState | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(Buffer.from(text.trim(), "base64").toString("utf8")) as LoadedState;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
