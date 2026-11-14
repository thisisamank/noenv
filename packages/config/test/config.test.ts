import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, findProject, normalizeRemoteUrl, parseConfig } from "@noenv/config";
import { isSecretName } from "@noenv/config/names";

const VALID = `
version = 1
deployment = "https://noenv.acme.com/"
environment = "staging"

[secrets]
required = ["DATABASE_URL", "API_KEY"]

[wrangler]
secrets = ["API_KEY"]
environment = "production"
env = "staging"
`;

test("parses a valid config", () => {
  assert.deepEqual(parseConfig(VALID), {
    deployment: "https://noenv.acme.com",
    environment: "staging",
    requiredSecrets: ["DATABASE_URL", "API_KEY"],
    wrangler: { secrets: ["API_KEY"], environment: "production", env: "staging" },
  });
});

test("defaults the environment to development", () => {
  assert.deepEqual(parseConfig("version = 1"), { environment: "development", requiredSecrets: [], wrangler: { secrets: [] } });
});

test("rejects values that are unsafe for a shell", () => {
  assert.throws(() => parseConfig(VALID.replace("API_KEY", "$(rm -rf ~)")), ConfigError);
  assert.throws(() => parseConfig(VALID.replace('environment = "staging"', 'environment = "dev; echo"')), ConfigError);
  assert.throws(() => parseConfig(VALID.replace('secrets = ["API_KEY"]', 'secrets = ["$(id)"]')), ConfigError);
  assert.throws(() => parseConfig(VALID.replace('env = "staging"', 'env = "x --config /tmp/evil"')), ConfigError);
  assert.throws(() => parseConfig(VALID.replace("https://noenv.acme.com/", "file:///etc/passwd")), ConfigError);
  assert.throws(() => parseConfig(VALID.replace('"https://noenv.acme.com/"', "42")), ConfigError);
});

test("rejects an unknown version", () => {
  assert.throws(() => parseConfig(VALID.replace("version = 1", "version = 2")), ConfigError);
});

test("normalizes every common remote form to the same key", () => {
  const remotes = [
    "git@github.com:Acme/Backend.git",
    "github.com:acme/backend",
    "https://github.com/acme/backend.git",
    "https://user:token@github.com/acme/backend/",
    "ssh://git@github.com:22/acme/backend.git",
    "git://github.com/acme/backend",
  ];
  for (const remote of remotes) {
    assert.equal(normalizeRemoteUrl(remote), "github.com/acme/backend", remote);
  }
});

test("rejects local and unsupported remotes", () => {
  assert.throws(() => normalizeRemoteUrl("/srv/git/backend.git"), ConfigError);
  assert.throws(() => normalizeRemoteUrl("file:///srv/git/backend.git"), ConfigError);
  assert.throws(() => normalizeRemoteUrl("github.com:"), ConfigError);
});

test("finds the project from a subdirectory of a git repository", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "noenv-")));
  const nested = join(root, "src", "deep");
  await mkdir(nested, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", "git@github.com:acme/backend.git"]);
  await writeFile(join(root, ".noenv"), VALID);

  assert.deepEqual(await findProject(nested), {
    root,
    repo: "github.com/acme/backend",
    hasConfig: true,
    deployment: "https://noenv.acme.com",
    environment: "staging",
    requiredSecrets: ["DATABASE_URL", "API_KEY"],
    wrangler: { secrets: ["API_KEY"], environment: "production", env: "staging" },
  });
});

test("returns null outside a git repository or without an origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "noenv-"));
  assert.equal(await findProject(root), null);

  execFileSync("git", ["init", "-q", root]);
  assert.equal(await findProject(root), null);
});

test("reserves variable names that change how shells and runtimes execute code", () => {
  for (const name of ["PATH", "path", "PROMPT_COMMAND", "PS1", "PROMPT", "BASH_ENV", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "GIT_SSH_COMMAND", "NOENV_URL", "_NOENV_RESTORE", "npm_config_script_shell"]) {
    assert.equal(isSecretName(name), false, name);
  }
  for (const name of ["DATABASE_URL", "API_KEY", "GITHUB_TOKEN", "PATHNAME_PREFIX", "_PRIVATE"]) {
    assert.equal(isSecretName(name), true, name);
  }
});
