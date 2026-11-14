#!/usr/bin/env node
import { accountCommand } from "./commands/account.ts";
import { authCommand, statusCommand } from "./commands/auth.ts";
import { execCommand } from "./commands/exec.ts";
import { wranglerCommand } from "./commands/wrangler.ts";
import { migrateCommand } from "./commands/migrate.ts";
import { grantCommand, initCommand, inviteCommand, revokeCommand, rotateCommand, trustCommand } from "./commands/project.ts";
import { secretCommand } from "./commands/secret.ts";
import { hookEnvCommand, refreshCommand, shellCommand, watchCommand } from "./commands/shell.ts";

const USAGE = `usage: noenv <command>

  shell zsh|bash             print the shell hook for your shell profile
  account add URL [NAME]     add a deployment as an account; NAME defaults to the
                             team name that the deployment reports
  account list               list accounts, * marks the default
  account default NAME       use NAME in repositories whose .noenv names no account
  account remove NAME        forget an account
  auth [NAME]                sign in to an account (default: the one in .noenv)
  status                     show the account, user, and project
  init [--account NAME]      create the project, the environment, and the .noenv file;
                             with more than one account, it asks which one to use
  exec -- COMMAND            run COMMAND with this repository's secrets, for agents,
                             scripts, and CI; it picks the account and project from
                             the current directory
  secret set KEY             save a secret (the value is read without echo)
  secret list                list secrets in this environment
  secret history KEY         list the versions of a secret
  secret rollback KEY VER    restore an older version of a secret
  secret sign [--yes]        sign secrets that an older noenv or the dashboard wrote
  migrate                    move .env files of this repository into noenv
  wrangler [KEY...]          push secrets to the Worker with wrangler; without KEY,
                             pick them in a list (keys under [wrangler] secrets in
                             .noenv are checked; without a terminal, push those)
  invite EMAIL               invite a user to this deployment
  grant EMAIL ROLE           give a user access to this project and environment
  revoke EMAIL               remove a user from this project
  rotate [--yes]             make a new environment key, re-encrypt every secret, and
                             share the key with the current key holders
  trust                      accept a new environment key after an admin rotated it
`;

const commands: Record<string, (args: string[]) => Promise<void>> = {
  account: accountCommand,
  shell: shellCommand,
  "hook-env": hookEnvCommand,
  refresh: refreshCommand,
  exec: execCommand,
  watch: watchCommand,
  auth: authCommand,
  status: statusCommand,
  init: initCommand,
  secret: secretCommand,
  migrate: migrateCommand,
  wrangler: wranglerCommand,
  invite: inviteCommand,
  grant: grantCommand,
  revoke: revokeCommand,
  trust: trustCommand,
  rotate: rotateCommand,
};

const [name, ...args] = process.argv.slice(2);
const command = commands[name ?? ""];

if (!command) {
  process.stdout.write(USAGE);
  process.exit(name ? 1 : 0);
}

try {
  await command(args);
} catch (error) {
  process.stderr.write(`noenv: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
}
