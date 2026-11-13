import { text } from "node:stream/consumers";
import { deploymentAt, resolveDeployment } from "../deployment.ts";
import { hookEnv } from "../hook-env.ts";
import { openBrowser, pollerRunning, startBackgroundPoller } from "../session.ts";
import { refresh } from "../refresh.ts";
import { hookScript, parseShell, quote } from "../shell.ts";
import { findTarget } from "../target.ts";
import { runWatcher, startWatcher } from "../watch.ts";

export async function shellCommand([shell]: string[]): Promise<void> {
  process.stdout.write(hookScript(parseShell(shell)));
}

export async function hookEnvCommand([shell]: string[]): Promise<void> {
  parseShell(shell);
  const state = process.stdin.isTTY ? "" : await text(process.stdin);

  const { lines, messages, refresh: job } = await hookEnv({
    cwd: process.cwd(),
    env: process.env,
    state,
    resolveDeployment: (repo) => resolveDeployment(repo),
    startPoller: startBackgroundPoller,
    pollerRunning,
    startWatcher: (deployment) => void startWatcher(deployment),
    openBrowser,
  });

  for (const message of messages) process.stderr.write(`noenv: ${message}\n`);
  if (job) lines.push(`_noenv_refresh ${quote(job.url)} ${quote(job.root)} ${quote(job.environment)}`);
  process.stdout.write(lines.join("\n"));
}

export async function refreshCommand([url, root, environment]: string[]): Promise<void> {
  if (!url || !root || !environment) throw new Error("usage: noenv refresh URL ROOT ENVIRONMENT");
  const target = await findTarget(root, { ...process.env, NOENV_ENVIRONMENT: environment });
  if (target) await refresh(deploymentAt(url), target);
}

export async function watchCommand([url]: string[]): Promise<void> {
  if (!url) throw new Error("usage: noenv watch URL");
  await runWatcher(deploymentAt(url));
}
