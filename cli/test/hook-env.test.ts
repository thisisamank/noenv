import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPublicKey, generateKeyPair, importPublicKey, wrapPrivateKey } from "@noenv/crypto";
import { addUser, fetchWorker, startWorker, type TestWorker } from "@noenv/worker/testing";
import { api, repoPath } from "../src/api.ts";
import type { Deployment } from "../src/deployment.ts";
import { writeJsonFile } from "../src/files.ts";
import { withoutLoadedSecrets } from "../src/commands/exec.ts";
import { APPROVAL_CHECK_MS, hookEnv, type HookInput, type HookOutput } from "../src/hook-env.ts";
import { refresh } from "../src/refresh.ts";
import { findTarget } from "../src/target.ts";
import { approveDeviceKey } from "../src/device-keys.ts";
import { ensureIdentity, type Identity } from "../src/identity.ts";
import { remoteSecretStore } from "../src/secret-store.ts";
import { checkForUpdates, markChanged } from "../src/watch.ts";

const SECRET = "it's $ecret\nline two";

let server: TestWorker;
let deployment: Deployment;
let repo: string;
let outside: string;
let adminToken: string;
let adminIdentity: Identity;

before(async () => {
  server = await startWorker();
  deployment = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-config-")));

  repo = await gitRepo("git@github.com:acme/backend.git");
  outside = await realpath(await mkdtemp(join(tmpdir(), "noenv-outside-")));

  adminToken = await addUser(server.env, "usr_admin", true);
  await signIn(deployment, adminToken);
  adminIdentity = await ensureIdentity(deployment, adminToken);

  await createProject("github.com/acme/backend");
  await store("github.com/acme/backend").set("API_KEY", SECRET);
});

async function createProject(name: string): Promise<void> {
  const token = adminToken;
  await api(deployment, "POST", "/v1/projects", { token, body: { name, repo: name } });
  const keys = await generateKeyPair();
  const wrappedKey = await wrapPrivateKey(keys.privateKey, await importPublicKey(adminIdentity.publicKey));
  const publicKey = await exportPublicKey(keys.publicKey);
  await api(deployment, "POST", `${repoPath(name)}/environments/development`, { token, body: { publicKey, wrappedKey } });
}

function store(name: string) {
  return remoteSecretStore(deployment, adminToken, adminIdentity, name, "development");
}

async function setDotenvPolicy(name: string, mode: string): Promise<void> {
  await api(deployment, "PUT", `${repoPath(name)}/policies/dotenv`, {
    token: adminToken,
    body: { value: { mode, include: [".env", ".env.*"], exclude: [".env.example"] } },
  });
}

after(() => server.dispose());

async function deploymentIn(dir: string): Promise<Deployment> {
  return {
    url: "https://noenv.test",
    dir,
    fetch: fetchWorker(server.env),
  };
}

async function signIn(target: Deployment, token: string): Promise<void> {
  await writeJsonFile(join(target.dir, "session.json"), { token, expiresAt: "2999-01-01 00:00:00" });
}

async function gitRepo(origin: string, files: Record<string, string> = {}): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "noenv-repo-")));
  await mkdir(join(root, "src"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", origin]);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return root;
}

function input({ deployment: target = deployment, ...overrides }: Partial<HookInput> & { deployment?: Deployment }): HookInput {
  return {
    cwd: repo,
    env: {},
    state: "",
    resolveDeployment: async () => target,
    startPoller: () => assert.fail("unexpected sign-in"),
    pollerRunning: async () => true,
    startWatcher: () => {},
    openBrowser: () => assert.fail("unexpected browser"),
    ...overrides,
  };
}

async function run(overrides: Partial<HookInput> & { deployment?: Deployment }): Promise<HookOutput> {
  const first = await hookEnv(input(overrides));
  if (!first.refresh) return first;
  const target = await findTarget(first.refresh.root, { NOENV_ENVIRONMENT: first.refresh.environment });
  await refresh(overrides.deployment ?? deployment, target!);
  const state = bash(`${first.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  const second = await hookEnv(input({ ...overrides, state }));
  return { lines: [...first.lines, ...second.lines], messages: [...first.messages, ...second.messages], refresh: second.refresh };
}

function secretLines(lines: string[]): string[] {
  return lines.filter((line) => line.startsWith("export ") && !line.startsWith("export _NOENV_"));
}

function stateOf(lines: string[]): Record<string, unknown> {
  const encoded = lines.findLast((line) => line.startsWith("export _NOENV_STATE="))!.slice("export _NOENV_STATE='".length, -1);
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function bash(script: string): string {
  return execFileSync("bash", ["-c", script], { encoding: "utf8" });
}

test("loads secrets in a subdirectory and restores the previous value on exit", async () => {
  const entered = await run({ cwd: join(repo, "src"), env: { API_KEY: "original" } });
  assert.deepEqual(entered.messages, ["loaded 1 secrets for github.com/acme/backend (development)"]);

  const prelude = "export API_KEY=original";
  assert.equal(bash(`${prelude}; ${entered.lines.join("\n")}\nprintf '%s' "$API_KEY"`), SECRET);

  const state = bash(`${entered.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  const stayed = await hookEnv(input({ cwd: repo, state, env: { API_KEY: SECRET } }));
  assert.deepEqual([secretLines(stayed.lines), stayed.messages, stayed.refresh], [[], [], undefined]);

  const left = await hookEnv(input({ cwd: outside, state, env: { API_KEY: SECRET } }));
  const script = `${prelude}\n${entered.lines.join("\n")}\n${left.lines.join("\n")}\nprintf '%s|%s' "$API_KEY" "\${_NOENV_STATE-unset}"`;
  assert.equal(bash(script), "original|unset");
});

test("unsets secrets that did not exist before", async () => {
  const entered = await run({});
  const state = bash(`${entered.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  const left = await hookEnv(input({ cwd: outside, state }));

  assert.equal(bash(`${entered.lines.join("\n")}\n${left.lines.join("\n")}\nprintf '%s' "\${API_KEY-unset}"`), "unset");
});

test("starts one sign-in and does not repeat the message while it is pending", async () => {
  const signedOut = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-config-")));
  let pollers = 0;
  let opened = "";
  const hooks = { deployment: signedOut, startPoller: () => void pollers++, openBrowser: (url: string) => void (opened = url) };

  const first = await hookEnv(input(hooks));
  assert.equal(pollers, 1);
  assert.equal(opened, "https://noenv.test/activate");
  assert.match(first.messages[0], /enter the code [A-Z2-9]{4}-[A-Z2-9]{4}/);
  assert.match(first.messages[0], /sign in to load secrets/);
  assert.ok(first.lines.includes("_NOENV_RETRY='1'"));

  const state = bash(`${first.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  const second = await hookEnv(input({ ...hooks, state }));
  assert.equal(pollers, 1);
  assert.deepEqual(second.messages, []);

  const otherTerminal = await hookEnv(input(hooks));
  assert.equal(pollers, 1);
  assert.match(otherTerminal.messages[0], /sign in to load secrets/);
});

test("restarts the poller when a sign-in is pending but nothing waits for it", async () => {
  const signedOut = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-config-")));
  let pollers = 0;
  let browsers = 0;
  const hooks = { deployment: signedOut, startPoller: () => void pollers++, openBrowser: () => void browsers++ };

  await hookEnv(input(hooks));
  await hookEnv(input({ ...hooks, pollerRunning: async () => false }));
  assert.equal(pollers, 2);
  assert.equal(browsers, 1);
});

test("a failed sign-in starts again when you enter the repository, not at every prompt", async () => {
  const signedOut = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-config-")));
  let pollers = 0;
  const hooks = { deployment: signedOut, startPoller: () => void pollers++, openBrowser: () => {} };

  const first = await hookEnv(input(hooks));
  await rm(join(signedOut.dir, "pending-sign-in.json"));
  const state = bash(`${first.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);

  const samePrompt = await hookEnv(input({ ...hooks, state }));
  assert.match(samePrompt.messages[0], /enter the repository again/);
  assert.equal(pollers, 1);

  const reentered = await hookEnv(input(hooks));
  assert.match(reentered.messages[0], /sign in to load secrets/);
  assert.equal(pollers, 2);
});

test("stays silent in unknown repos and reports access errors in repos with a .noenv file", async () => {
  const unknown = await gitRepo("https://github.com/acme/unrelated.git");
  const silent = await run({ cwd: unknown });
  assert.deepEqual(silent.messages, []);
  assert.deepEqual(stateOf(silent.lines).previous, {});

  const optedIn = await gitRepo("https://github.com/acme/frontend.git", { ".noenv": "version = 1" });
  const result = await run({ cwd: optedIn });
  assert.match(result.messages[0], /could not load secrets for github.com\/acme\/frontend/);
});

test("an expired session is cleared and sign-in starts", async () => {
  const revoked = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-config-")));
  await signIn(revoked, "invalid-token");

  const result = await run({ deployment: revoked, startPoller: () => {}, openBrowser: () => {} });
  assert.ok(result.lines.includes("_NOENV_RETRY='1'"));
  assert.match(result.messages[0], /sign in to load secrets/);
});

test("entering a repository with cached secrets makes no network request", async () => {
  await run({});
  const offline: Deployment = { ...deployment, fetch: () => assert.fail("unexpected request") };

  const result = await hookEnv(input({ deployment: offline }));
  assert.deepEqual(result.messages, ["loaded 1 secrets for github.com/acme/backend (development)"]);
  assert.equal(bash(`${result.lines.join("\n")}\nprintf '%s' "$API_KEY"`), SECRET);
  assert.ok(result.refresh);
});

test("exec restores the values the shell hook replaced", () => {
  const state = Buffer.from(JSON.stringify({ repo: "r", environment: "e", retry: false, previous: { API_KEY: "original", DB: null } })).toString("base64");
  const env = withoutLoadedSecrets({ _NOENV_STATE: state, API_KEY: "from-a", DB: "from-a", PATH: "/bin" });
  assert.deepEqual(env, { API_KEY: "original", PATH: "/bin" });
});

test("NOENV_ENVIRONMENT selects another environment", async () => {
  const result = await run({ env: { NOENV_ENVIRONMENT: "production" } });
  assert.equal(stateOf(result.lines).environment, "production");
  assert.deepEqual(result.messages, []);

  const invalid = await hookEnv(input({ env: { NOENV_ENVIRONMENT: "prod; rm -rf ~" } }));
  assert.deepEqual(invalid.lines, []);
  assert.match(invalid.messages[0], /NOENV_ENVIRONMENT must contain only/);
});

test("delete mode keeps .env files with new names until migrate, then deletes them and loads their values", async () => {
  await createProject("github.com/acme/delete-mode");
  await setDotenvPolicy("github.com/acme/delete-mode", "delete");
  const root = await gitRepo("git@github.com:acme/delete-mode.git", { ".env": "LOCAL_ONLY=from-dotenv", ".env.example": "LOCAL_ONLY=" });

  const blocked = await run({ cwd: root });
  assert.equal(existsSync(join(root, ".env")), true);
  assert.match(blocked.messages[0], /^\.env: kept, run `noenv migrate` to review and upload new values \(LOCAL_ONLY\)$/);
  assert.deepEqual(secretLines(blocked.lines), []);

  await store("github.com/acme/delete-mode").set("LOCAL_ONLY", "from-dotenv");
  const result = await run({ cwd: root });

  assert.equal(existsSync(join(root, ".env")), false);
  assert.equal(existsSync(join(root, ".env.example")), true);
  assert.deepEqual(result.messages.slice(-2), [".env: deleted, noenv stores its values", "loaded 1 secrets for github.com/acme/delete-mode (development)"]);
  assert.equal(bash(`${result.lines.join("\n")}\nprintf '%s' "$LOCAL_ONLY"`), "from-dotenv");

  const { devices } = await api<any>(deployment, "GET", "/v1/devices", { token: adminToken });
  const report = devices.flatMap((d: any) => d.compliance).find((c: any) => c.repo === "github.com/acme/delete-mode");
  assert.deepEqual([report.compliant, report.files], [true, [{ path: ".env", status: "deleted" }]]);
});

test("block mode keeps the file and does not load secrets", async () => {
  await createProject("github.com/acme/block-mode");
  await store("github.com/acme/block-mode").set("API_KEY", "x");
  await setDotenvPolicy("github.com/acme/block-mode", "block");
  const root = await gitRepo("git@github.com:acme/block-mode.git", { ".env": "API_KEY=local" });

  const result = await run({ cwd: root });

  assert.equal(existsSync(join(root, ".env")), true);
  assert.deepEqual(secretLines(result.lines), []);
  assert.match(result.messages.at(-1)!, /"block" policy does not allow .env files/);
});

test("warn mode loads secrets and reports the file", async () => {
  await createProject("github.com/acme/warn-mode");
  await store("github.com/acme/warn-mode").set("API_KEY", "x");
  const root = await gitRepo("git@github.com:acme/warn-mode.git", { ".env.local": "API_KEY=local" });

  const result = await run({ cwd: root });

  assert.deepEqual(result.messages, [".env.local: found", "loaded 1 secrets for github.com/acme/warn-mode (development)"]);
  assert.equal(existsSync(join(root, ".env.local")), true);
});

test("a secret saved from this shell loads at the next prompt", async () => {
  const name = "github.com/acme/live-local";
  await createProject(name);
  const root = await gitRepo(`git@github.com:${name.split("/").slice(1).join("/")}.git`);

  const entered = await run({ cwd: root });
  const state = bash(`${entered.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  assert.deepEqual(secretLines((await hookEnv(input({ cwd: root, state }))).lines), []);

  await store(name).set("FRESH", "just-saved");
  await markChanged(deployment, name, "development");

  const next = await run({ cwd: root, state });
  assert.deepEqual(next.messages, [`updated 1 secrets for ${name} (development)`]);
  assert.equal(bash(`${entered.lines.join("\n")}\n${next.lines.join("\n")}\nprintf '%s' "$FRESH"`), "just-saved");
});

test("a change made elsewhere loads after the watcher sees the new revision", async () => {
  const name = "github.com/acme/live-remote";
  await createProject(name);
  await store(name).set("SHARED", "v1");
  const root = await gitRepo(`git@github.com:${name.split("/").slice(1).join("/")}.git`);

  const entered = await run({ cwd: root });
  const state = bash(`${entered.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);

  await store(name).set("SHARED", "v2");
  assert.deepEqual(secretLines((await hookEnv(input({ cwd: root, state }))).lines), []);

  assert.equal(await checkForUpdates(deployment), true);
  const next = await run({ cwd: root, state });
  assert.equal(bash(`${entered.lines.join("\n")}\n${next.lines.join("\n")}\nprintf '%s' "$SHARED"`), "v2");
});

test("switching to a repo of another account restores the first account's values", async () => {
  const other = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-config-")));
  const otherAccount = { ...other, url: "https://noenv.other.test" };
  await signIn(otherAccount, "invalid-token");

  const entered = await run({});
  const state = bash(`${entered.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  const switched = await run({ state, deployment: otherAccount, startPoller: () => {}, openBrowser: () => {} });

  assert.ok(switched.lines.includes("unset API_KEY"));
  assert.equal(stateOf(switched.lines).url, "https://noenv.other.test");
});

test("the restore script unloads secrets without running noenv", async () => {
  const entered = await run({ env: { API_KEY: "original" } });
  const script = `export API_KEY=original\n${entered.lines.join("\n")}\neval "$_NOENV_RESTORE"\nprintf '%s|%s' "$API_KEY" "\${_NOENV_STATE-unset}"`;
  assert.equal(bash(script), "original|unset");
});

test("the hook looks up the deployment named in .noenv", async () => {
  const root = await gitRepo("git@github.com:acme/named.git", { ".noenv": 'version = 1\ndeployment = "https://noenv.acme.com/"\n' });
  const asked: (string | undefined)[] = [];
  await hookEnv({ ...input({ cwd: root }), resolveDeployment: async (url) => (asked.push(url), null) });
  assert.deepEqual(asked, ["https://noenv.acme.com"]);
});

test("a new computer shows the approval code once, then loads secrets after approval", async () => {
  const desktop = await deploymentIn(await mkdtemp(join(tmpdir(), "noenv-desktop-")));
  await signIn(desktop, adminToken);

  const waiting = await run({ deployment: desktop });
  const notice = waiting.messages.filter((message) => message.includes("noenv device approve"));
  assert.equal(notice.length, 1, JSON.stringify(waiting.messages));
  assert.deepEqual(secretLines(waiting.lines), []);
  const code = notice[0]!.match(/approve ([0-9a-f-]{19})/)![1]!;

  const state = bash(`${waiting.lines.join("\n")}\nprintf '%s' "$_NOENV_STATE"`);
  const again = await hookEnv(input({ deployment: desktop, state }));
  assert.deepEqual(again.messages, [], "the code is not shown on every prompt");
  assert.equal(again.refresh, undefined, "right after a check, the hook does not start another one, so zsh does not loop");

  await approveDeviceKey(deployment, adminToken, adminIdentity.privateKey, code);
  const now = Date.now;
  Date.now = () => now() + APPROVAL_CHECK_MS;
  const later = await hookEnv(input({ deployment: desktop, state }));
  assert.ok(later.refresh, "a later prompt checks again");
  const loaded = await run({ deployment: desktop, state }).finally(() => (Date.now = now));
  assert.ok(loaded.messages.includes("loaded 1 secrets for github.com/acme/backend (development)"), JSON.stringify(loaded.messages));
  assert.equal(bash(`${loaded.lines.join("\n")}\nprintf '%s' "$API_KEY"`), SECRET);
});
