import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICIES } from "@noenv/policy";
import { encryptSecret, exportPublicKey, generateKeyPair, importPublicKey, wrapPrivateKey } from "@noenv/crypto";
import { openBundle, type RawBundle } from "../src/bundle.ts";
import type { Deployment } from "../src/deployment.ts";
import { checkPin } from "../src/pins.ts";

const context = { projectId: "prj_1", environment: "development" };

async function rawBundle(names: string[]) {
  const user = await generateKeyPair();
  const environment = await generateKeyPair();
  const raw: RawBundle = {
    projectId: context.projectId,
    revision: 1,
    policies: DEFAULT_POLICIES,
    publicKey: await exportPublicKey(environment.publicKey),
    wrappedKey: await wrapPrivateKey(environment.privateKey, await importPublicKey(await exportPublicKey(user.publicKey))),
    secrets: await Promise.all(
      names.map(async (name) => ({ name, version: 1, sealed: await encryptSecret(environment.privateKey, "value", { ...context, name }) })),
    ),
  };
  return { raw, userKey: user.privateKey, environment };
}

test("skips reserved names that a server or an older client stored", async () => {
  const { raw, userKey } = await rawBundle(["API_KEY", "PROMPT_COMMAND", "LD_PRELOAD"]);
  const bundle = await openBundle(raw, userKey, "development");
  assert.deepEqual(bundle.secrets, { API_KEY: "value" });
  assert.deepEqual(bundle.reserved, ["PROMPT_COMMAND", "LD_PRELOAD"]);
});

test("skips values without a valid MAC, as anyone with the public key could seal them", async () => {
  const { raw, userKey } = await rawBundle(["API_KEY", "DATABASE_URL"]);
  const forged = await encryptSecret((await generateKeyPair()).privateKey, "evil", { ...context, name: "DATABASE_URL" });
  raw.secrets[1]!.sealed = { ...raw.secrets[1]!.sealed, mac: forged.mac };
  const { mac: _mac, ...unsigned } = raw.secrets[0]!.sealed;
  raw.secrets.push({ name: "NEW_ONE", version: 1, sealed: unsigned });

  const bundle = await openBundle(raw, userKey, "development");
  assert.deepEqual(bundle.secrets, { API_KEY: "value" });
  assert.deepEqual(bundle.unsigned, ["DATABASE_URL", "NEW_ONE"]);
});

test("rejects an environment public key that does not belong to the unwrapped key", async () => {
  const { raw, userKey } = await rawBundle(["API_KEY"]);
  raw.publicKey = await exportPublicKey((await generateKeyPair()).publicKey);
  await assert.rejects(openBundle(raw, userKey, "development"), /does not belong/);
});

test("pins the project and key on first use and rejects a later change", async () => {
  const deployment = { url: "https://noenv.test", dir: await mkdtemp(join(tmpdir(), "noenv-pins-")), fetch } as Deployment;
  const { raw } = await rawBundle([]);
  const other = await rawBundle([]);

  await checkPin(deployment, "github.com/acme/backend", "development", raw);
  await checkPin(deployment, "github.com/acme/backend", "development", raw);
  await assert.rejects(checkPin(deployment, "github.com/acme/backend", "development", other.raw), /noenv trust/);
  await assert.rejects(checkPin(deployment, "github.com/acme/backend", "development", { ...raw, projectId: "prj_2" }), /different project/);
  await checkPin(deployment, "github.com/acme/backend", "staging", other.raw);
});
