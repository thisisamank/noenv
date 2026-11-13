import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchAccount, resolveDeployment, writeAccounts, type Accounts } from "../src/deployment.ts";

const accounts: Accounts = {
  default: "personal",
  accounts: {
    personal: { url: "https://noenv.me.dev", match: [] },
    acme: { url: "https://noenv.acme.com", match: ["github.com/acme"] },
    platform: { url: "https://noenv.platform.acme.com/", match: ["github.com/acme/platform-"] },
    globex: { url: "https://secrets.globex.io", match: ["gitlab.globex.io/"] },
  },
};

test("the longest repository prefix wins and partial names do not match", () => {
  assert.equal(matchAccount(accounts, "github.com/acme/backend"), "acme");
  assert.equal(matchAccount(accounts, "gitlab.globex.io/team/api"), "globex");
  assert.equal(matchAccount(accounts, "github.com/acmecorp/backend"), undefined);
  assert.equal(matchAccount(accounts, "github.com/acme/platform-/x"), "platform");
});

test("NOENV_ACCOUNT, then a prefix, then the default, then NOENV_URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "noenv-accounts-"));
  const env = { NOENV_CONFIG_DIR: dir, NOENV_URL: "https://legacy.test" };

  assert.equal((await resolveDeployment("github.com/acme/x", env))?.url, "https://legacy.test");

  await writeAccounts(accounts, env);
  assert.equal((await resolveDeployment("github.com/acme/x", env))?.account, "acme");
  assert.equal((await resolveDeployment("github.com/me/blog", env))?.account, "personal");
  assert.equal((await resolveDeployment("github.com/acme/x", { ...env, NOENV_ACCOUNT: "globex" }))?.account, "globex");
  await assert.rejects(resolveDeployment(null, { ...env, NOENV_ACCOUNT: "nope" }), /no account named "nope"/);

  const acme = await resolveDeployment("github.com/acme/x", env);
  assert.equal(acme?.dir, join(dir, "noenv.acme.com"));
});
