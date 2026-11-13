import { openBundle } from "./bundle.ts";
import type { Deployment } from "./deployment.ts";
import { loadIdentity } from "./identity.ts";
import { readCache, type CacheEntry } from "./refresh.ts";
import { loadSession, readPendingSignIn, startSignIn } from "./session.ts";
import { exportLine, setLine, unsetLine } from "./shell.ts";
import { findTarget, type Target } from "./target.ts";
import { CHANGED, markerPath, readMarker, watchEnvironment } from "./watch.ts";

export type LoadedState = {
  url?: string;
  repo: string;
  environment: string;
  previous: Record<string, string | null>;
  retry: boolean;
  notified?: string;
  revision?: number;
};

export type RefreshJob = {
  url: string;
  root: string;
  environment: string;
};

export type HookInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  state: string;
  resolveDeployment: (projectUrl: string | undefined) => Promise<Deployment | null>;
  startPoller: (deployment: Deployment) => void;
  pollerRunning: (deployment: Deployment) => Promise<boolean>;
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
  refresh?: RefreshJob;
};

type Step = {
  lines: string[];
  state: LoadedState;
  refresh: boolean;
};

const STATE_VARIABLES = ["_NOENV_STATE", "_NOENV_RETRY", "_NOENV_REV_FILE", "_NOENV_REV", "_NOENV_RESTORE"];

export async function hookEnv(input: HookInput): Promise<HookOutput> {
  const state = decodeState(input.state);
  const messages: string[] = [];
  const resolved = await resolve(input, messages);

  if (!resolved) {
    return { lines: state ? [...restoreLines(state), ...STATE_VARIABLES.map(unsetLine)] : [], messages };
  }

  const { target, deployment } = resolved;
  const marker = markerPath(deployment, target.repo, target.environment);
  const revision = await readMarker(marker);
  const step = await load(input, resolved, state, revision, messages);

  return {
    lines: [
      ...step.lines,
      exportLine("_NOENV_STATE", encodeState(step.state)),
      step.state.retry ? setLine("_NOENV_RETRY", "1") : unsetLine("_NOENV_RETRY"),
      setLine("_NOENV_REV_FILE", marker),
      setLine("_NOENV_REV", revision),
      setLine("_NOENV_RESTORE", [...restoreLines(step.state), ...STATE_VARIABLES.map(unsetLine)].join("\n")),
    ],
    messages,
    refresh: step.refresh ? { url: deployment.url, root: target.root, environment: target.environment } : undefined,
  };
}

async function load(input: HookInput, resolved: Resolved, state: LoadedState | null, revision: string, messages: string[]): Promise<Step> {
  const { target, deployment } = resolved;
  const entering = state === null || !sameTarget(state, resolved);
  const empty: LoadedState = { url: deployment.url, repo: target.repo, environment: target.environment, previous: {}, retry: false };
  const restore = state ? restoreLines(state) : [];

  if (!(await loadSession(deployment))) {
    return { lines: restore, state: await signIn(input, deployment, empty, state, entering, messages), refresh: false };
  }

  const entry = await readCache(deployment, target);
  const identity = await loadIdentity(deployment);
  const refresh = entering || state.retry || revision === CHANGED || !entry || !identity;

  if (!entering && !state.retry && (!entry || !identity || ("raw" in entry && entry.raw.revision === state.revision))) {
    return { lines: [], state, refresh };
  }
  if (!entry || !identity) {
    return { lines: restore, state: empty, refresh };
  }

  const opened = await openEntry(entry, identity.privateKey, target, messages);
  if (!opened) {
    return { lines: restore, state: empty, refresh };
  }

  const lines = [...restore];
  const previous: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(opened.secrets)) {
    previous[name] = state && name in state.previous ? state.previous[name] : (input.env[name] ?? null);
    lines.push(exportLine(name, value));
  }

  const count = Object.keys(opened.secrets).length;
  const updated = !entering && state.revision !== undefined;
  messages.push(`${updated ? "updated" : "loaded"} ${count} secrets for ${target.repo} (${target.environment})`);
  const missing = target.requiredSecrets.filter((name) => !(name in opened.secrets));
  if (missing.length > 0) messages.push(`missing required secrets: ${missing.join(", ")}`);

  await watchEnvironment(deployment, target.repo, target.environment);
  input.startWatcher(deployment);
  return { lines, state: { ...empty, previous, revision: opened.revision }, refresh };
}

async function openEntry(
  entry: CacheEntry,
  privateKey: CryptoKey,
  target: Target,
  messages: string[],
): Promise<{ secrets: Record<string, string>; revision: number } | null> {
  if ("error" in entry) {
    if (!(entry.status === 403 && !target.hasConfig) && entry.status !== 401) {
      messages.push(`could not load secrets for ${target.repo} (${target.environment}): ${entry.error}`);
    }
    return null;
  }
  messages.push(...entry.notes);
  if (entry.blocked) return null;
  try {
    const bundle = await openBundle(entry.raw, privateKey, target.environment);
    return { secrets: bundle.secrets, revision: bundle.revision };
  } catch (error) {
    messages.push(`could not decrypt secrets for ${target.repo} (${target.environment}): ${describe(error)}`);
    return null;
  }
}

function sameTarget(state: LoadedState, { target, deployment }: Resolved): boolean {
  return state.url === deployment.url && state.repo === target.repo && state.environment === target.environment;
}

async function signIn(
  input: HookInput,
  deployment: Deployment,
  empty: LoadedState,
  state: LoadedState | null,
  entering: boolean,
  messages: string[],
): Promise<LoadedState> {
  const waiting = await readPendingSignIn(deployment);
  if (state?.notified && !entering && !(waiting && waiting.expiresAt > Date.now())) {
    messages.push("sign-in was not completed, enter the repository again or run `noenv auth` to retry");
    return empty;
  }

  try {
    const { pending, started } = await startSignIn(deployment);
    if (started) input.openBrowser(pending.url);
    if (started || !(await input.pollerRunning(deployment))) input.startPoller(deployment);
    if (started || state?.notified !== pending.userCode) {
      const account = deployment.account ? ` to ${deployment.account}` : "";
      messages.push(`sign in${account} to load secrets: open ${pending.url} and confirm the code ${pending.userCode}`);
    }
    return { ...empty, retry: true, notified: pending.userCode };
  } catch (error) {
    messages.push(`could not start sign-in: ${describe(error)}`);
    return empty;
  }
}

async function resolve(input: HookInput, messages: string[]): Promise<Resolved | null> {
  try {
    const target = await findTarget(input.cwd, input.env);
    const deployment = target && (await input.resolveDeployment(target.deployment));
    return target && deployment ? { target, deployment } : null;
  } catch (error) {
    messages.push(describe(error));
    return null;
  }
}

export function restoreLines(state: LoadedState): string[] {
  return Object.entries(state.previous).map(([name, value]) => (value === null ? unsetLine(name) : exportLine(name, value)));
}

function encodeState(state: LoadedState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64");
}

export function decodeState(text: string | undefined): LoadedState | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(Buffer.from(text.trim(), "base64").toString("utf8")) as LoadedState;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
