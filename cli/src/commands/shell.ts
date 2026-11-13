import { text } from "node:stream/consumers";
import { deploymentAt, resolveDeployment } from "../deployment.ts";
import { hookEnv } from "../hook-env.ts";
import { openBrowser, startBackgroundPoller } from "../session.ts";
import { hookScript, parseShell } from "../shell.ts";
import { runWatcher, startWatcher } from "../watch.ts";

export async function shellCommand([shell]: string[]): Promise<void> {
  process.stdout.write(hookScript(parseShell(shell)));
}

export async function hookEnvCommand([shell]: string[]): Promise<void> {
  parseShell(shell);
  const state = process.stdin.isTTY ? "" : await text(process.stdin);

  const { lines, messages } = await hookEnv({
    cwd: process.cwd(),
    env: process.env,
    state,
    resolveDeployment: (repo) => resolveDeployment(repo),
    startPoller: startBackgroundPoller,
    startWatcher: (deployment) => void startWatcher(deployment),
    openBrowser,
  });

  for (const message of messages) process.stderr.write(`noenv: ${message}\n`);
  process.stdout.write(lines.join("\n"));
}

export async function watchCommand([url]: string[]): Promise<void> {
  if (!url) throw new Error("usage: noenv watch URL");
  await runWatcher(deploymentAt(url));
}
