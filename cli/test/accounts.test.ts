import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDeployment, writeAccounts, type Accounts } from "../src/deployment.ts";

const accounts: Accounts = {
  default: "personal",
  accounts: {
    personal: { url: "https://noenv.me.dev" },
    work: { url: "https://noenv.acme.com/" },
    globex: { url: "https://secrets.globex.io" },
  },
};

async function configured(): Promise<NodeJS.ProcessEnv> {
  const env = { NOENV_CONFIG_DIR: await mkdtemp(join(tmpdir(), "noenv-accounts-")), NOENV_URL: "https://legacy.test" };
  await writeAccounts(accounts, env);
  return env;
}

test("the deployment in .noenv picks the local account with that URL, whatever its name", async () => {
  const env = await configured();
  const deployment = await resolveDeployment("https://noenv.acme.com", { ...env, NOENV_ACCOUNT: "globex" });
  assert.deepEqual([deployment?.account, deployment?.url], ["work", "https://noenv.acme.com"]);
  assert.equal(deployment?.dir, join(env.NOENV_CONFIG_DIR!, "noenv.acme.com"));
});

test("the deployment in .noenv can match NOENV_URL", async () => {
  const env = await configured();
  assert.equal((await resolveDeployment("https://legacy.test", env))?.url, "https://legacy.test");
});

test("an unknown deployment in .noenv is an error, never a request to that URL", async () => {
  const env = await configured();
  await assert.rejects(
    resolveDeployment("https://evil.example", env),
    /uses the deployment https:\/\/evil\.example, add it with `noenv account add https:\/\/evil\.example`/,
  );
});

test("without a deployment in .noenv: NOENV_ACCOUNT, then the default, then NOENV_URL", async () => {
  const env = await configured();
  assert.equal((await resolveDeployment(undefined, { ...env, NOENV_ACCOUNT: "globex" }))?.account, "globex");
  assert.equal((await resolveDeployment(undefined, env))?.account, "personal");

  const empty = { NOENV_CONFIG_DIR: await mkdtemp(join(tmpdir(), "noenv-accounts-")), NOENV_URL: "https://legacy.test" };
  assert.equal((await resolveDeployment(undefined, empty))?.url, "https://legacy.test");
});
