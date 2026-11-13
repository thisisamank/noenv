import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Target } from "./target.ts";

export function wranglerSource(target: Target): string {
  return target.wrangler.environment ?? target.environment;
}

export async function putWranglerSecrets(target: Target, secrets: Record<string, string>): Promise<void> {
  const names = Object.keys(secrets);
  const env = target.wrangler.env ? ` --env ${target.wrangler.env}` : "";
  console.log(`Pushing ${names.length} secrets from noenv (${wranglerSource(target)}) to Wrangler${env}: ${names.join(", ")}`);

  const args = ["secret", "bulk", ...(target.wrangler.env ? ["--env", target.wrangler.env] : [])];
  const child = spawn(await findWrangler(target.root), args, { cwd: target.root, stdio: ["pipe", "inherit", "inherit"] });
  child.stdin.end(JSON.stringify(secrets));

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? new Error("wrangler is not installed, run `npm install -D wrangler`") : error),
    );
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`wrangler secret bulk failed with exit code ${code}`);
}

async function findWrangler(root: string): Promise<string> {
  for (let dir = root; ; dir = dirname(dir)) {
    const local = join(dir, "node_modules", ".bin", "wrangler");
    if (await access(local).then(() => true, () => false)) return local;
    if (dirname(dir) === dir) return "wrangler";
  }
}
