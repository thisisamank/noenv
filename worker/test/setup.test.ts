import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TestAuthenticator } from "./authenticator.ts";
import { call, startWorker, type TestWorker } from "./helpers.ts";

const ORIGIN = "https://noenv.test";

let worker: TestWorker;

before(async () => {
  worker = await startWorker();
});

after(() => worker.dispose());

function api(env: TestWorker["env"], method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (cookie) headers.Cookie = `noenv_session=${cookie}`;
  return call(env, method, path, { body, headers });
}

test("setup is off when no admin email was set at deploy time", async () => {
  assert.deepEqual((await api(worker.env, "GET", "/v1/setup")).body, { available: false, email: false, missingToken: false });
  assert.equal((await api(worker.env, "POST", "/v1/setup/options", { email: "a@example.com" })).status, 403);
});

test("without a setup token, knowing the admin email is not enough", async () => {
  const env = { ...worker.env, ADMIN_EMAIL: "owner@example.com" };
  assert.deepEqual((await api(env, "GET", "/v1/setup")).body, { available: false, email: false, missingToken: true });
  assert.equal((await api(env, "POST", "/v1/setup/options", { email: "owner@example.com" })).status, 403);
  const short = { ...env, SETUP_TOKEN: "short" };
  assert.equal((await api(short, "POST", "/v1/setup/options", { email: "owner@example.com", token: "short" })).status, 403);
});

test("only the deploy-time admin email with the setup token can create the first passkey, once", async () => {
  const token = "correct-horse-battery-staple";
  const env = { ...worker.env, ADMIN_EMAIL: "Owner@Example.com", SETUP_TOKEN: token };
  assert.deepEqual((await api(env, "GET", "/v1/setup")).body, { available: true, email: false, missingToken: false });
  assert.equal((await api(env, "POST", "/v1/setup/options", { email: "intruder@example.com", token })).status, 403);
  assert.equal((await api(env, "POST", "/v1/setup/options", { email: "owner@example.com" })).status, 403);
  assert.equal((await api(env, "POST", "/v1/setup/options", { email: "owner@example.com", token: "wrong-token-of-enough-length" })).status, 403);

  const options = await api(env, "POST", "/v1/setup/options", { email: "owner@example.com", token });
  const response = await new TestAuthenticator().register(options.body, ORIGIN);
  const created = await api(env, "POST", "/v1/setup", { email: "owner@example.com", token, response });
  assert.equal(created.status, 200);

  const session = created.headers.get("Set-Cookie")!.match(/noenv_session=([0-9a-f]{64})/)![1];
  const me = await api(env, "GET", "/v1/me", undefined, session);
  assert.deepEqual([me.body.email, me.body.isAdmin], ["owner@example.com", true]);

  assert.deepEqual((await api(env, "GET", "/v1/setup")).body, { available: false, email: false, missingToken: false });
  assert.equal((await api(env, "POST", "/v1/setup/options", { email: "owner@example.com", token })).status, 403);
});

test("the deployment tells the CLI its team name", async () => {
  assert.deepEqual((await api(worker.env, "GET", "/v1/deployment")).body, { name: "noenv" });
  assert.deepEqual((await api({ ...worker.env, TEAM_NAME: " Acme " }, "GET", "/v1/deployment")).body, { name: "Acme" });
});

test("unauthenticated sign-in endpoints are rate limited per address", async () => {
  let remaining = 3;
  const env = { ...worker.env, AUTH_LIMIT: { limit: async () => ({ success: remaining-- > 0 }) } as unknown as RateLimit };
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await api(env, "POST", "/v1/auth/device")).status);
  assert.deepEqual(statuses, [201, 201, 201, 429]);
});
