import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/index.ts";
import { addUser, call, startWorker, type TestWorker } from "./helpers.ts";

const ORIGIN = "https://noenv.test";

type Sent = { to: string; subject: string; html: string; text: string };

let worker: TestWorker;
let sent: Sent[];
let withEmail: Env;

before(async () => {
  worker = await startWorker();
  await addUser(worker.env, "usr_admin", true);
  await addUser(worker.env, "usr_ana");
  await addUser(worker.env, "usr_ben");
  await addUser(worker.env, "usr_cara");
  await addUser(worker.env, "usr_dan");
  await worker.env.DB.prepare("UPDATE users SET removed_at = datetime('now') WHERE id = 'usr_dan'").run();
  const email = {
    async send(message: Sent) {
      sent.push(message);
      return { messageId: `msg_${sent.length}` };
    },
  };
  withEmail = { ...worker.env, EMAIL: email as unknown as SendEmail, EMAIL_FROM: "noenv@example.com" };
});

beforeEach(() => {
  sent = [];
});

after(() => worker.dispose());

function api(env: Env, method: string, path: string, options: { body?: unknown; cookie?: string; token?: string } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (options.cookie) headers.Cookie = `noenv_session=${options.cookie}`;
  return call(env, method, path, { body: options.body, token: options.token, headers });
}

function lastCode(): string {
  return sent.at(-1)!.text.match(/code: (\d{6})/)![1]!;
}

function sessionFrom(response: { headers: Headers }): string {
  return (response.headers.get("Set-Cookie") ?? "").match(/noenv_session=([0-9a-f]{64})/)![1]!;
}

async function age(userId: string) {
  await worker.env.DB.prepare("UPDATE email_codes SET created_at = datetime('now', '-2 minutes') WHERE user_id = ?").bind(userId).run();
}

test("an emailed code signs the person in once", async () => {
  const requested = await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: " USR_ANA@example.com " } });
  assert.deepEqual(requested.body, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "usr_ana@example.com");
  assert.match(sent[0]!.subject, /^\d{6} is your noenv sign-in code$/);

  const code = lastCode();
  const signedIn = await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_ana@example.com", code } });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  const me = await api(withEmail, "GET", "/v1/me", { cookie: sessionFrom(signedIn) });
  assert.equal(me.body.email, "usr_ana@example.com");

  const replay = await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_ana@example.com", code } });
  assert.equal(replay.status, 401);
});

test("an unknown or removed address gets the same answer and no email", async () => {
  for (const email of ["nobody@example.com", "usr_dan@example.com"]) {
    const requested = await api(withEmail, "POST", "/v1/auth/email/code", { body: { email } });
    assert.deepEqual([requested.status, requested.body], [200, { sent: true }]);
  }
  assert.equal(sent.length, 0);
});

test("a code stops working after five wrong guesses", async () => {
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "usr_ben@example.com" } });
  const code = lastCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let guess = 0; guess < 5; guess++) {
    assert.equal((await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_ben@example.com", code: wrong } })).status, 401);
  }
  assert.equal((await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_ben@example.com", code } })).status, 401);
});

test("a second code within a minute is not sent, and a later one replaces the first", async () => {
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "usr_cara@example.com" } });
  const first = lastCode();
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "usr_cara@example.com" } });
  assert.equal(sent.length, 1);

  await age("usr_cara");
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "usr_cara@example.com" } });
  assert.equal(sent.length, 2);
  const second = lastCode();
  if (first !== second) {
    assert.equal((await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_cara@example.com", code: first } })).status, 401);
  }
  assert.equal((await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_cara@example.com", code: second } })).status, 200);
});

test("an expired code does not sign in", async () => {
  await age("usr_ana");
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "usr_ana@example.com" } });
  await worker.env.DB.prepare("UPDATE email_codes SET expires_at = datetime('now', '-1 second') WHERE user_id = 'usr_ana'").run();
  assert.equal((await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_ana@example.com", code: lastCode() } })).status, 401);
});

test("without email configured, sign-in by email is not available", async () => {
  const requested = await api(worker.env, "POST", "/v1/auth/email/code", { body: { email: "usr_ana@example.com" } });
  assert.equal(requested.status, 409);
});

test("a terminal sign-in is approved with an emailed code", async () => {
  const device = (await call(withEmail, "POST", "/v1/auth/device", { body: { deviceName: "ana-phone" } })).body;
  const token = "token_usr_ana";

  const requested = await api(withEmail, "POST", "/v1/auth/activate/email", { token });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  assert.match(sent[0]!.subject, /terminal approval code$/);
  const code = lastCode();

  const login = await api(withEmail, "POST", "/v1/auth/email", { body: { email: "usr_ana@example.com", code } });
  assert.equal(login.status, 401, "an approval code must not sign in");

  const approved = await api(withEmail, "POST", "/v1/auth/activate", { token, body: { code: device.userCode, emailCode: code } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const issued = await call(withEmail, "POST", "/v1/auth/token", { body: { deviceCode: device.deviceCode } });
  assert.match(issued.body.token, /^[0-9a-f]{64}$/);
});

test("a person changes their email after they confirm a code sent to the new address", async () => {
  await addUser(worker.env, "usr_eve");
  await addUser(worker.env, "usr_fay");
  const token = "token_usr_eve";

  assert.equal((await api(withEmail, "POST", "/v1/me/email", { token, body: { email: "usr_fay@example.com" } })).status, 409);
  assert.equal((await api(withEmail, "POST", "/v1/me/email", { token, body: { email: "usr_eve@example.com" } })).status, 400);
  assert.equal((await api(worker.env, "POST", "/v1/me/email", { token, body: { email: "eve@new.example" } })).status, 409);

  const requested = await api(withEmail, "POST", "/v1/me/email", { token, body: { email: "Eve@New.example" } });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  assert.equal(sent[0]!.to, "eve@new.example");
  const code = lastCode();

  const wrongUser = await api(withEmail, "POST", "/v1/me/email/confirm", { token: "token_usr_fay", body: { code } });
  assert.equal(wrongUser.status, 401);

  const confirmed = await api(withEmail, "POST", "/v1/me/email/confirm", { token, body: { code } });
  assert.deepEqual([confirmed.status, confirmed.body], [200, { email: "eve@new.example" }]);
  assert.equal((await api(withEmail, "GET", "/v1/me", { token })).body.email, "eve@new.example");

  const notice = sent.at(-1)!;
  assert.equal(notice.to, "usr_eve@example.com");
  assert.equal(notice.subject, "Your noenv email was changed");

  assert.equal((await api(withEmail, "POST", "/v1/me/email/confirm", { token, body: { code } })).status, 401);

  sent = [];
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "usr_eve@example.com" } });
  assert.equal(sent.length, 0, "the old address no longer gets sign-in codes");
  await api(withEmail, "POST", "/v1/auth/email/code", { body: { email: "eve@new.example" } });
  assert.equal(sent[0]!.to, "eve@new.example");
});
