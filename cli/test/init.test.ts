import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "@noenv/config";
import { writeConfig } from "../src/commands/project.ts";
import type { Target } from "../src/target.ts";

async function target(): Promise<Target> {
  const root = await mkdtemp(join(tmpdir(), "noenv-init-"));
  return { root, repo: "github.com/acme/api", environment: "development", requiredSecrets: [], hasConfig: false, wrangler: { secrets: [] } };
}

test("init writes the deployment URL of the chosen account into a new .noenv", async () => {
  const project = await target();
  await writeConfig(project, "https://noenv.acme.com");
  const config = parseConfig(await readFile(join(project.root, ".noenv"), "utf8"));
  assert.equal(config.deployment, "https://noenv.acme.com");
  assert.equal(config.environment, "development");
});

test("init adds the deployment to an existing .noenv and keeps the rest", async () => {
  const project = await target();
  await writeFile(join(project.root, ".noenv"), 'version = 1\nenvironment = "staging"\n\n[secrets]\nrequired = ["API_KEY"]\n');
  await writeConfig(project, "https://noenv.acme.com");
  const config = parseConfig(await readFile(join(project.root, ".noenv"), "utf8"));
  assert.deepEqual([config.deployment, config.environment, config.requiredSecrets], ["https://noenv.acme.com", "staging", ["API_KEY"]]);
});
