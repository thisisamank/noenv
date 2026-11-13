#!/usr/bin/env node
import { accountCommand } from "./commands/account.ts";
import { authCommand, statusCommand } from "./commands/auth.ts";
import { execCommand } from "./commands/exec.ts";
import { wranglerCommand } from "./commands/wrangler.ts";
import { migrateCommand } from "./commands/migrate.ts";
import { grantCommand, initCommand, inviteCommand, revokeCommand } from "./commands/project.ts";
import { secretCommand } from "./commands/secret.ts";
import { hookEnvCommand, refreshCommand, shellCommand, watchCommand } from "./commands/shell.ts";

const USAGE = `usage: noenv <command>

  shell zsh|bash             print the shell hook for your shell profile
  account add NAME URL [PREFIX...]
                             add an account, such as work or personal; repos
                             under a PREFIX (github.com/acme) use it
  account list               list accounts, * marks the default
  account default NAME       use NAME where no prefix matches
  account remove NAME        forget an account
  auth [NAME]                sign in to an account (default: the one for this repo)
  status                     show the account, user, and project
  init                       create the project, the environment, and the .noenv file
  exec -- COMMAND            run COMMAND with this repository's secrets, for agents,
                             scripts, and CI; it picks the account and project from
                             the current directory
  secret set KEY             save a secret (the value is read without echo)
  secret list                list secrets in this environment
  secret history KEY         list the versions of a secret
  secret rollback KEY VER    restore an older version of a secret
  migrate                    move .env files of this repository into noenv
  wrangler [KEY...]          push secrets to the Worker with wrangler; without KEY,
                             pick them in a list (keys under [wrangler] secrets in
                             .noenv are checked; without a terminal, push those)
  invite EMAIL               invite a user to this deployment
  grant EMAIL ROLE           give a user access to this project and environment
  revoke EMAIL               remove a user from this project
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
