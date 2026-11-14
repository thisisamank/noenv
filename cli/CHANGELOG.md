# Changelog

## 0.4.0 — 2026-11-14

A security release. Update the CLI, then have an editor run `noenv secret sign` in each environment.

### Added

- `noenv secret sign` re-saves secrets that an older noenv or the dashboard wrote, after you check their names.
- `noenv rotate` makes a new environment key, re-encrypts every secret, and shares the key with the current key holders.
- `noenv trust` accepts a new environment key after an admin rotated it.
- `noenv status` and `noenv grant` show key fingerprints, so you can check a key with its owner.

### Changed

- Each secret version is signed with the environment key. The CLI skips a value without a valid signature, so a server or a stolen session token cannot forge one. After you update, an editor runs `noenv secret sign` once in each environment.
- The CLI checks that the server's environment key matches the key it unwraps, and pins it on first use.
- Terminal sign-in shows your device in the dashboard. You type the code and confirm with your passkey.
- Delete mode no longer uploads `.env` values in the background. A file with new names waits for `noenv migrate`.
- Names that change how code runs, such as `PATH`, `PROMPT_COMMAND`, `NODE_OPTIONS`, `LD_*` and `GIT_*`, are reserved. The CLI never exports them.

## 0.3.0 — 2026-11-13

Each repository's `.noenv` file names its deployment, and every teammate gets the same account name from the deployment. noenv no longer guesses the account from the git `origin`.

### Added

- `noenv account add URL` asks the deployment for its team name and saves the account under it. Admins set the name with `TEAM_NAME` at deploy time. Without it, the name comes from the Worker's address. `noenv account add URL NAME` still sets your own name.

### Changed

- `noenv init` saves the deployment URL in `.noenv` as `deployment = "URL"`. With one account, it uses that account. With more than one, it shows a list. Agents and scripts pass `noenv init --account NAME`. In a repository with a `.noenv` file but no deployment, `init` adds the line.
- The shell hook, `noenv exec`, and all other commands use the local account whose URL matches `.noenv`, whatever its name. Teammates can name the account differently.
- If no local account has the URL in `.noenv`, noenv prints the command to add it. It never connects to that URL on its own.
- In a repository whose `.noenv` names no deployment, noenv uses `NOENV_ACCOUNT`, then the default account, then `NOENV_URL`.

### Removed

- Repository prefixes. `noenv account add` no longer takes them, and noenv ignores the prefixes saved by 0.2.x. Run `noenv init` in each repository to save its deployment.

## 0.2.1 — 2026-11-13

The shell signs you in on its own again, instead of asking you to run `noenv auth`.

### Fixed

- The background sign-in keeps waiting through network errors, server errors, and rate limits. Before, a Wi-Fi drop or a laptop waking from sleep stopped it, and the shell asked you to run `noenv auth`.
- When a sign-in is pending but the process that waits for it has stopped, the shell starts a new one.
- After a sign-in fails or its code expires, entering the repository again starts a new sign-in.

## 0.2.0 — 2026-11-13

Coding agents and CI get their secrets with one command, secrets push to Cloudflare Workers, one CLI works with several teams, and `cd` is fast again.

### Added

- `noenv exec -- CMD` runs a command with the secrets of the repository in the current directory. It is for coding agents, scripts, and CI, where the `cd` hook does not run. It removes secrets that your shell loaded for another repository first.
- `noenv wrangler [KEY...]` pushes secrets to your Worker with `wrangler secret bulk`. Without keys, it shows a list to pick from.
- A `[wrangler]` section in `.noenv` pushes the listed keys after each `secret set` and `secret rollback`.
- `noenv account add NAME URL [PREFIX...]` saves a deployment as a named account. Repositories under a prefix such as `github.com/acme` use it.
- `noenv account list`, `account default`, and `account remove`.
- `noenv auth NAME` signs in to one account.
- When you `cd` from a repository of one account to a repository of another, noenv unloads the first set of secrets and loads the second.

### Changed

- A `cd` decrypts the last bundle on your machine and makes no network request. Before, each `cd` into a repository waited about one second for the Worker. A background refresh loads newer values when they arrive. zsh prints the result as soon as it lands. bash prints it at the next prompt.
- The shell hook does not start noenv when you `cd` inside the same repository or between directories outside a repository.
- `noenv init` creates a `.noenv` file. Commit it, so access problems show as messages instead of silence.

## 0.1.1 — 2026-11-01

### Added

- The CLI is on npm as `@thisisamank/noenv-cli`. The command stays `noenv`.

### Changed

- nenv is now noenv.
