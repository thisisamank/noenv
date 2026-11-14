import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret, exportPublicKey, generateKeyPair, importPublicKey, unwrapPrivateKey, wrapPrivateKey } from "@noenv/crypto";
import { addUser, call, PROJECT_PATH, REPO, startWorker, type TestWorker } from "./helpers.ts";

const ENVIRONMENT_PATH = `${PROJECT_PATH}/environments/development`;

let worker: TestWorker;
const tokens: Record<string, string> = {};
const identities: Record<string, CryptoKeyPair> = {};

before(async () => {
  worker = await startWorker();
  for (const [id, isAdmin] of [["usr_admin", true], ["usr_other_admin", true], ["usr_member", false], ["usr_leaver", false]] as const) {
    tokens[id] = await addUser(worker.env, id, isAdmin);
    identities[id] = await generateKeyPair();
    await api(id, "PUT", "/v1/me/public-key", { publicKey: await exportPublicKey(identities[id]!.publicKey) });
  }
});

after(() => worker.dispose());

function api(user: string, method: string, path: string, body?: unknown) {
  return call(worker.env, method, path, { token: tokens[user], body });
}

async function wrapFor(user: string, key: CryptoKey) {
  return wrapPrivateKey(key, await importPublicKey(await exportPublicKey(identities[user]!.publicKey)));
}

async function environmentKey(user: string): Promise<{ key: CryptoKey; projectId: string; secrets: any[] }> {
  const bundle = (await api(user, "GET", `${ENVIRONMENT_PATH}/bundle`)).body;
  return { key: await unwrapPrivateKey(bundle.wrappedKey, identities[user]!.privateKey), projectId: bundle.projectId, secrets: bundle.secrets };
}

test("admins cannot change or remove themselves, and can demote another admin", async () => {
  assert.equal((await api("usr_admin", "PUT", "/v1/users/usr_admin/admin", { isAdmin: false })).status, 409);
  assert.equal((await api("usr_admin", "DELETE", "/v1/users/usr_admin")).status, 409);
  assert.equal((await api("usr_member", "PUT", "/v1/users/usr_member/admin", { isAdmin: true })).status, 403);

  assert.equal((await api("usr_admin", "PUT", "/v1/users/usr_other_admin/admin", { isAdmin: false })).status, 200);
  assert.equal((await api("usr_other_admin", "GET", "/v1/users")).status, 403);
});

test("rotation re-encrypts every secret for the current key holders and blocks rollback across it", async () => {
  await api("usr_admin", "POST", "/v1/projects", { name: "Backend", repo: REPO });
  const first = await generateKeyPair();
  await api("usr_admin", "POST", ENVIRONMENT_PATH, { publicKey: await exportPublicKey(first.publicKey), wrappedKey: await wrapFor("usr_admin", first.privateKey) });
  for (const user of ["usr_member", "usr_leaver"]) {
    await api("usr_admin", "PUT", `${PROJECT_PATH}/members/${user}`, { role: "reader" });
    await api("usr_admin", "PUT", `${ENVIRONMENT_PATH}/keys/${user}`, { wrappedKey: await wrapFor(user, first.privateKey) });
  }
  const { projectId } = await environmentKey("usr_admin");
  const context = { projectId, environment: "development", name: "API_KEY" };
  await api("usr_admin", "PUT", `${ENVIRONMENT_PATH}/secrets/API_KEY`, await encryptSecret(first.privateKey, "old", context));
  await api("usr_admin", "PUT", `${ENVIRONMENT_PATH}/secrets/API_KEY`, await encryptSecret(first.privateKey, "current", context));

  assert.equal((await api("usr_admin", "DELETE", `${PROJECT_PATH}/members/usr_leaver`)).status, 204);
  const holders = (await api("usr_admin", "GET", `${ENVIRONMENT_PATH}/keys`)).body.holders.map((h: any) => h.userId).sort();
  assert.deepEqual(holders, ["usr_admin", "usr_member"]);
  assert.equal((await api("usr_member", "GET", `${ENVIRONMENT_PATH}/keys`)).status, 403);

  const second = await generateKeyPair();
  const publicKey = await exportPublicKey(second.publicKey);
  const secrets = { API_KEY: await encryptSecret(second.privateKey, "current", context) };
  const wrappedKeys = { usr_admin: await wrapFor("usr_admin", second.privateKey), usr_member: await wrapFor("usr_member", second.privateKey) };

  const missingHolder = await api("usr_admin", "POST", `${ENVIRONMENT_PATH}/rotate`, { publicKey, secrets, wrappedKeys: { usr_admin: wrappedKeys.usr_admin } });
  assert.equal(missingHolder.status, 409);
  const missingSecret = await api("usr_admin", "POST", `${ENVIRONMENT_PATH}/rotate`, { publicKey, secrets: {}, wrappedKeys });
  assert.equal(missingSecret.status, 409);

  const rotated = await api("usr_admin", "POST", `${ENVIRONMENT_PATH}/rotate`, { publicKey, secrets, wrappedKeys });
  assert.deepEqual(rotated.body, { rotated: true, holders: 2, secrets: 1 });

  const member = await environmentKey("usr_member");
  assert.equal(await decryptSecret(member.key, member.secrets[0].sealed, context), "current");
  assert.equal((await api("usr_member", "GET", `${ENVIRONMENT_PATH}/bundle`)).body.publicKey, publicKey);

  const rollback = await api("usr_admin", "POST", `${ENVIRONMENT_PATH}/secrets/API_KEY/rollback`, { version: 1 });
  assert.equal(rollback.status, 409);
});

test("removing a user ends their sessions, passkeys, keys, and memberships", async () => {
  assert.equal((await api("usr_admin", "DELETE", "/v1/users/usr_member")).status, 204);
  assert.equal((await api("usr_member", "GET", "/v1/me")).status, 401);

  const { env } = worker;
  const left = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM memberships WHERE user_id = 'usr_member') + (SELECT COUNT(*) FROM environment_keys WHERE user_id = 'usr_member')
            + (SELECT COUNT(*) FROM passkeys WHERE user_id = 'usr_member') AS n`,
  ).first<{ n: number }>();
  assert.equal(left!.n, 0);
  const { users } = (await api("usr_admin", "GET", "/v1/users")).body;
  assert.ok(!users.some((user: any) => user.id === "usr_member"));
});

test("an admin key reset clears the public key, the environment keys, and the sessions", async () => {
  assert.equal((await api("usr_admin", "DELETE", "/v1/users/usr_other_admin/public-key")).status, 204);
  assert.equal((await api("usr_other_admin", "GET", "/v1/me")).status, 401);
  const user = await worker.env.DB.prepare("SELECT public_key FROM users WHERE id = 'usr_other_admin'").first<{ public_key: string | null }>();
  assert.equal(user!.public_key, null);
  assert.equal((await api("usr_admin", "DELETE", "/v1/users/usr_nobody/public-key")).status, 404);
});
