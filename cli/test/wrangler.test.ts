import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Target } from "../src/target.ts";
import { putWranglerSecrets } from "../src/wrangler.ts";

async function project(script: string): Promise<Target> {
  const root = await mkdtemp(join(tmpdir(), "noenv-wrangler-"));
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await writeFile(join(root, "node_modules", ".bin", "wrangler"), `#!/bin/sh\n${script}\n`);
  await chmod(join(root, "node_modules", ".bin", "wrangler"), 0o755);
  const wrangler = { secrets: ["API_KEY"], env: "production" };
  return { root, repo: "github.com/acme/api", environment: "development", requiredSecrets: [], hasConfig: true, wrangler };
}

test("pipes the values to the project's wrangler secret bulk on stdin", async () => {
  const target = await project(`printf '%s' "$*" > args; cat > stdin`);
  await putWranglerSecrets(target, { API_KEY: "it's $ecret", DB: "x" });

  assert.equal(await readFile(join(target.root, "args"), "utf8"), "secret bulk --env production");
  assert.deepEqual(JSON.parse(await readFile(join(target.root, "stdin"), "utf8")), { API_KEY: "it's $ecret", DB: "x" });
});

test("reports a failed wrangler run", async () => {
  const target = await project("exit 7");
  await assert.rejects(putWranglerSecrets(target, { API_KEY: "x" }), /failed with exit code 7/);
});
