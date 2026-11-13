# Changelog

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
