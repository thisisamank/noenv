import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { addUser, call, PUBLIC_KEY, startWorker, type TestWorker } from "./helpers.ts";

let worker: TestWorker;
let ana: string;
let ben: string;
let admin: string;

const DEVICE_KEY = btoa(String.fromCharCode(...new Uint8Array(65).fill(7)));
const WRAPPED = { ephemeralPublicKey: PUBLIC_KEY, iv: "aXY=", ciphertext: "Y2lwaGVy" };

before(async () => {
  worker = await startWorker();
  admin = await addUser(worker.env, "usr_admin", true);
  ana = await addUser(worker.env, "usr_ana");
  ben = await addUser(worker.env, "usr_ben");
  await call(worker.env, "PUT", "/v1/me/public-key", { token: ana, body: { publicKey: PUBLIC_KEY } });
});

after(() => worker.dispose());

const register = (token: string, publicKey = DEVICE_KEY) =>
  call(worker.env, "POST", "/v1/me/devices", { token, body: { name: "desk", publicKey }, headers: { "CF-Connecting-IP": "198.51.100.4" } });

test("a person without an account key cannot register a device", async () => {
  assert.equal((await register(ben)).status, 409);
});

test("only the owner approves a device, and only once", async () => {
  const created = await register(ana);
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.status, created.body.ip, created.body.wrappedKey], ["pending", "198.51.100.4", null]);
  assert.equal((await register(ana)).body.id, created.body.id, "registering again returns the same device");
  assert.equal((await register(ben)).status, 409, "another account cannot claim the device key");

  const path = `/v1/me/devices/${created.body.id}/approve`;
  assert.equal((await call(worker.env, "POST", path, { token: ben, body: { wrappedKey: WRAPPED } })).status, 404);
  assert.equal((await call(worker.env, "POST", path, { token: ana, body: { wrappedKey: { nope: 1 } } })).status, 400);

  const approved = await call(worker.env, "POST", path, { token: ana, body: { wrappedKey: WRAPPED } });
  assert.equal(approved.status, 200);
  assert.deepEqual([approved.body.status, approved.body.wrappedKey], ["approved", WRAPPED]);
  assert.equal((await call(worker.env, "POST", path, { token: ana, body: { wrappedKey: WRAPPED } })).status, 404);

  assert.deepEqual((await register(ana)).body.wrappedKey, WRAPPED);
  assert.deepEqual((await call(worker.env, "GET", "/v1/me/devices", { token: ben })).body, { devices: [] });
});

test("a pending device expires after a day", async () => {
  const other = btoa(String.fromCharCode(...new Uint8Array(65).fill(9)));
  const created = await register(ana, other);
  await worker.env.DB.prepare("UPDATE device_keys SET created_at = datetime('now', '-25 hours') WHERE id = ?").bind(created.body.id).run();
  const approve = await call(worker.env, "POST", `/v1/me/devices/${created.body.id}/approve`, { token: ana, body: { wrappedKey: WRAPPED } });
  assert.equal(approve.status, 404);
  const listed = (await call(worker.env, "GET", "/v1/me/devices", { token: ana })).body.devices;
  assert.ok(!listed.some((device: { id: string }) => device.id === created.body.id));
});

test("an admin key reset deletes the copies of the old key", async () => {
  assert.equal((await call(worker.env, "DELETE", "/v1/users/usr_ana/public-key", { token: admin })).status, 204);
  const { results } = await worker.env.DB.prepare("SELECT 1 FROM device_keys WHERE user_id = 'usr_ana'").all();
  assert.equal(results.length, 0);
});
