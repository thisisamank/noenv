import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPrivateKey, exportPublicKey, generateKeyPair, importPublicKey, wrapPrivateKey } from "@noenv/crypto";
import { addUser, fetchWorker, startWorker, type TestWorker } from "@noenv/worker/testing";
import { api, repoPath } from "../src/api.ts";
import { fetchBundle } from "../src/bundle.ts";
import type { Deployment } from "../src/deployment.ts";
import { approveDeviceKey, DeviceApprovalPending, listDeviceKeys, removeDeviceKey } from "../src/device-keys.ts";
import { writeJsonFile } from "../src/files.ts";
import { ensureIdentity, type Identity } from "../src/identity.ts";
import { remoteSecretStore } from "../src/secret-store.ts";

const REPO = "github.com/acme/devices";

let server: TestWorker;
let token: string;
let laptop: Deployment;
let laptopIdentity: Identity;

before(async () => {
  server = await startWorker();
  token = await addUser(server.env, "usr_ana", true);
  laptop = await computer();
  laptopIdentity = await ensureIdentity(laptop, token);

  await api(laptop, "POST", "/v1/projects", { token, body: { name: "devices", repo: REPO } });
  const keys = await generateKeyPair();
  const wrappedKey = await wrapPrivateKey(keys.privateKey, await importPublicKey(laptopIdentity.publicKey));
  await api(laptop, "POST", `${repoPath(REPO)}/environments/development`, {
    token,
    body: { publicKey: await exportPublicKey(keys.publicKey), wrappedKey },
  });
  await remoteSecretStore(laptop, token, laptopIdentity, REPO, "development").set("API_KEY", "from the laptop");
});

after(() => server.dispose());

async function computer(): Promise<Deployment> {
  return { url: "https://noenv.test", dir: await mkdtemp(join(tmpdir(), "noenv-device-")), fetch: fetchWorker(server.env) };
}

async function pendingCode(device: Deployment): Promise<string> {
  const error = await ensureIdentity(device, token).then(
    () => assert.fail("the device must wait for approval"),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof DeviceApprovalPending, String(error));
  assert.match(error.message, /noenv device approve [0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/);
  return error.code;
}

test("a new computer reads secrets after a computer with the key approves it", async () => {
  const desktop = await computer();
  const code = await pendingCode(desktop);
  assert.equal(await pendingCode(desktop), code, "asking again keeps the same device key");

  const [waiting] = await listDeviceKeys(laptop, token);
  assert.equal(waiting!.status, "pending");
  assert.equal(waiting!.wrappedKey, null);

  const approved = await approveDeviceKey(laptop, token, laptopIdentity.privateKey, code.toUpperCase().replaceAll("-", " "));
  assert.equal(approved.status, "approved");

  const desktopIdentity = await ensureIdentity(desktop, token);
  assert.equal(desktopIdentity.publicKey, laptopIdentity.publicKey);
  assert.ok(!existsSync(join(desktop.dir, "device-key.json")), "the device key is not needed after the handover");
  assert.ok(existsSync(join(desktop.dir, "identity.json")));

  const bundle = await fetchBundle(desktop, token, desktopIdentity.privateKey, REPO, "development");
  assert.equal(bundle.secrets.API_KEY, "from the laptop");
});

test("a wrong code approves nothing", async () => {
  const phone = await computer();
  await pendingCode(phone);
  await assert.rejects(approveDeviceKey(laptop, token, laptopIdentity.privateKey, "0000-0000-0000-0000"), /no device waits for approval/);
  await assert.rejects(ensureIdentity(phone, token), DeviceApprovalPending);
});

test("a removed device that never got the key must be approved again", async () => {
  const tablet = await computer();
  const code = await pendingCode(tablet);
  for (const entry of await listDeviceKeys(laptop, token)) {
    if (entry.status === "pending") await removeDeviceKey(laptop, token, entry.id);
  }
  await assert.rejects(approveDeviceKey(laptop, token, laptopIdentity.privateKey, code), /no device waits for approval/);
});

test("a device that had an old key keeps that file beside the new one", async () => {
  const old = await computer();
  const stale = await generateKeyPair();
  await writeJsonFile(join(old.dir, "identity.json"), {
    publicKey: await exportPublicKey(stale.publicKey),
    privateKey: await exportPrivateKey(stale.privateKey),
  });

  const code = await pendingCode(old);
  await approveDeviceKey(laptop, token, laptopIdentity.privateKey, code);
  assert.equal((await ensureIdentity(old, token)).publicKey, laptopIdentity.publicKey);
  assert.ok((await readdir(old.dir)).some((name) => name.startsWith("identity.json.replaced-")));
});
