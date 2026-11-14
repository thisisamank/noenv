# NOENV — Minimal Technical Specification

**Version:** 0.1  
**Type:** Open-source, self-hosted secret manager  
**Infrastructure:** Cloudflare

## 1. Overview

NOENV replaces `.env` files with an encrypted, centrally managed secret system.

It combines automatic environment variable injection with self-hosted secret management.

- Secrets are encrypted locally. Cloudflare KV serves the latest values; Cloudflare D1 keeps all versions.
- Each team deploys NOENV to its own Cloudflare account.
- A shell hook loads project secrets when a developer enters a git repository that NOENV knows.
- Secrets are removed from the shell when the developer leaves the project.
- Administrators manage users, permissions, policies, and secret versions.

## 2. Core Components

| Component | Responsibility |
|---|---|
| CLI | Authentication, encryption, decryption, secret operations |
| Shell Hook | Detect projects and load/unload environment variables |
| Cloudflare Worker | API, authentication, authorization, policy enforcement |
| Cloudflare KV | Snapshot of the latest encrypted secrets per environment, for fast reads |
| Cloudflare D1 | Users, projects, permissions, policies, and every encrypted secret version |
| Dashboard | Manage secrets, teams, policies, and history |

## 3. Project Identity and Configuration

The git `origin` URL identifies a project. It is the key for all of the project's secrets.

1. The client finds the git repository root of the current directory.
2. The client reads `remote.origin.url` and normalizes it to `host/path`.
3. If the server has a project for that key, the client downloads that project's secrets.

Normalization:

- `git@github.com:Acme/Backend.git`, `https://github.com/acme/backend`, and `ssh://git@github.com:22/acme/backend.git` all become `github.com/acme/backend`.
- Remove credentials, ports, a trailing `.git`, and trailing slashes. Use lowercase.
- Reject local paths and `file://` remotes.
- Never send credentials from a remote URL to the server.

D1 maps each normalized origin to an internal project ID. When a repository moves, an admin changes only the origin of the project. Encryption binds secrets to the internal project ID, so existing secrets stay valid.

A repository without an `origin` remote, or with an unknown origin, loads no secrets.

A project can contain an optional `.noenv` file at the repository root, committed to git:

```toml
version = 1
environment = "development"

[secrets]
required = ["DATABASE_URL", "API_KEY"]
```

- `environment` selects the environment. The default is `development`. The `NOENV_ENVIRONMENT` variable overrides it for one shell.
- `secrets.required` lists the secrets the project needs.
- The file contains references only. It never contains secret values.

## 4. Developer Workflow

There is no `noenv login` or `noenv hook install` step. Setup is a shell configuration change.

1. The developer opens the landing page of the team's NOENV deployment (for example `https://noenv.<team>.workers.dev`).
2. The landing page shows a one-time CLI install command and the shell lines for Zsh and Bash. The deployment URL is already filled in.
3. The developer adds the lines to `~/.zshrc` or `~/.bashrc`:

```bash
export NOENV_URL="https://noenv.<team>.workers.dev"
eval "$(noenv shell zsh)"
```

4. Each new shell checks for a valid session with `NOENV_URL`. If there is no valid session, the shell starts the authentication flow automatically.
5. After authentication, the shell loads and unloads project secrets by directory:

```bash
cd ~/projects/backend
# NOENV loads backend secrets

npm run dev
# Application accesses secrets normally

cd ..
# NOENV removes backend secrets
```

Each team can point `NOENV_URL` at its own deployment. A developer can change the URL to switch deployments.

Authentication requirements:

- Use a device authorization flow: print a URL and a short code, then open the browser if possible.
- Do not block shell startup. The prompt stays usable while authentication is pending.
- Run only one authentication flow at a time when several terminals open together.
- Store the session per `NOENV_URL`, so several deployments can coexist.
- Never fetch and evaluate remote shell code at shell startup. `noenv shell` prints a hook that ships with the installed CLI.

Identity:

- People sign in with passkeys. NOENV needs no identity provider, SSO, or Cloudflare Access setup.
- The Deploy to Cloudflare button asks for `ADMIN_EMAIL` and `SETUP_TOKEN` (a random string of at least 16 characters that the admin makes up). Without email, the dashboard lets only a person who gives both values create the first admin passkey. An email address alone is not a secret, so it never claims a deployment. Setup closes after the first passkey exists. If `SETUP_TOKEN` is missing or too short, setup stays closed and the dashboard says so.
- `npm run setup -- --admin you@example.com` deploys from a local checkout and prints a one-time setup link for the first admin.
- Admins invite people from the dashboard. An invite creates a one-time link (valid 7 days) that the admin sends. Opening it creates the person's passkey.
- When the deployment has the `EMAIL` send binding and an `EMAIL_FROM` address, noenv emails the invite link through Cloudflare Email Sending. The link is still returned, so the admin can send it another way. With email on, the first admin's setup link is also emailed to `ADMIN_EMAIL` instead of being claimable by typing the address.
- A lost passkey is recovered with a new invite link from an admin. Registering through that link deletes the user's other passkeys and ends their sessions, so the lost passkey stops working.
- Org admins can grant and remove org admin, and can remove a person from the organization. Removal ends the person's sessions and deletes their passkeys, invites, memberships, and environment keys. A person with secret history stays as a hidden record, so history keeps its author. Admins cannot change or remove themselves, so the organization always keeps an admin.
- Org admins can reset a person's key after a lost laptop or a leaked key. The reset clears the public key, deletes the person's environment keys, and ends their sessions. The person registers a new key from a fresh device, and an admin runs `noenv grant` again.
- The browser session is an HttpOnly, SameSite=Strict cookie. Cookie-authenticated writes must come from the same origin.
- The CLI approves its device code in the signed-in dashboard (`/activate` redirects there) and then uses a bearer session token.
- Device approval resists code phishing:
  - The CLI sends its host name when it starts sign-in. The Worker stores it with the requester IP, country, and start time.
  - The approval URL never carries the code. The person types the code that their own terminal shows.
  - The dashboard shows the device name, network, and start time before approval.
  - Approval needs a fresh passkey assertion from the signed-in user, not only the session cookie.

Secret loading requirements:

- Detect the git repository and its `origin` from the current directory.
- Fetch only authorized project secrets.
- Decrypt secrets locally.
- Inject secrets into the current shell without printing values.
- Keep secrets active in project subdirectories.
- Remove or restore injected variables when leaving or switching projects.
- Support independent terminal sessions.
- Clear stale secrets when authentication, retrieval, or policy checks fail.

Initial shell support: Bash and Zsh.

## 5. Encryption and Access Control

- Encrypt secrets on the client before upload.
- Use authenticated encryption.
- Each version carries an HMAC-SHA256 over the project ID, environment, name, and ciphertext. The HMAC key comes from the environment private key through HKDF. Only a holder of that key can write a value that loads. A server, or a stolen session token without the key, cannot add or change a value. The CLI skips a value without a valid HMAC and names it. `noenv secret sign` re-saves such values after an editor checks them.
- The CLI checks that the environment public key from the server belongs to the environment private key that it unwraps.
- The CLI pins the project ID and the environment public key for each repository and environment on first use. A later change stops secret loading until the person runs `noenv trust` and accepts the new fingerprint.
- `noenv grant` and `noenv status` show public key fingerprints, so people can check a key out of band.
- Never send plaintext secret values to Cloudflare.
- Each project environment has an encryption key.
- Authorized users receive access to that key through public-key encryption.
- Decryption happens locally.

Three roles:

| Role | Access |
|---|---|
| Reader | Use assigned secrets |
| Editor | Read, create, and update secrets |
| Admin | Manage secrets, users, permissions, and policies |

Authorization is checked before secret retrieval.

Revoking access prevents future authorized retrieval but cannot erase secrets already copied by a user.

Key rotation (`noenv rotate`, environment admin):

- The CLI makes a new environment key pair, re-encrypts and signs every active secret, and wraps the new private key for each current key holder. It shows each holder's key fingerprint first.
- The Worker applies the rotation in one batch. It rejects the request unless it covers exactly the current key holders and exactly the active secrets.
- A removed member keeps the old key. Rotation stops them from reading values written after it. It does not change the values, so change the values they knew at their providers.
- After a rotation, a version written with an earlier key cannot be restored.
- Other members run `noenv trust` and check the new fingerprint.

## 6. Secret Versioning

- Each update creates an immutable encrypted version.
- Store every encrypted version, the active-version references, and history in D1.
- After each update, write a snapshot of the active encrypted secrets of the environment to KV. Secret retrieval reads this snapshot in one KV read.
- D1 keeps a revision number per environment. If the KV snapshot revision does not match D1, retrieval reads from D1. This handles KV eventual consistency.
- A rollback creates a new version that copies the older ciphertext. It does not move the pointer back.
- Support rollback to previous versions.
- Record author and timestamp.
- Never include plaintext secret values in history or logs.

## 7. Organization Policies

Admins can configure policies at organization, project, and environment levels.

Initial policy support:

| Policy | Purpose |
|---|---|
| `.env` detection | Detect existing environment files |
| `.env` enforcement | Warn, block activation, require migration, or delete automatically |
| CLI version | Require a minimum NOENV version |
| Session expiry | Require periodic reauthentication |
| Environment access | Restrict access by user or role |
| Secret caching | Control local secret persistence |

Policies are stored centrally and evaluated by NOENV clients.

Clients report compliance status to the dashboard.

Mandatory policy violations can block new secret retrieval.

### `.env` Migration

When prohibited `.env` files are detected:

1. Detect matching files within the git repository.
2. Block activation when required by policy.
3. Offer secure migration to NOENV with `noenv migrate`. It shows each file and its names before it uploads.
4. Encrypt and upload secrets.
5. Verify successful migration.
6. Remove the files:
   - In `delete` mode, remove a file automatically, without a prompt, only when NOENV already stores every value in it with the same value.
   - In all other modes, remove them only after explicit local confirmation.
7. Report compliance.

Automatic deletion (`delete` mode) has these limits:

- Never upload a value automatically. The shell hook and `noenv exec` only compare a file with NOENV. A file that has a name NOENV does not store yet is kept with the status `unmigrated`, and secret loading is blocked until the developer runs `noenv migrate`. A `.env` file on a branch from someone else can therefore not add secrets for the team.
- Delete a file only after every value in it is stored in NOENV and verified by a decryption round trip.
- Never overwrite an existing NOENV secret during migration. If a `.env` value differs from the NOENV value, report a conflict, keep the file, and block secret loading.
- Do not delete a file that changed after migration.
- Do not enter nested git repositories (for example vendored dependencies) or `node_modules`.
- If migration or verification fails, keep the file and block secret loading.
- Delete only regular files that match the policy patterns in the directory tree of a git repository that NOENV knows.
- Never follow symbolic links and never delete directories.
- Never scan outside that directory tree.
- Report each deleted path (never its contents) to the dashboard.

Admins cannot delete any other files from developer machines.

Client-reported compliance is not proof against a developer who controls their device.

## 8. Dashboard

The dashboard provides:

- **Projects:** Create projects and environments.
- **Secrets:** View secret names and versions, and roll back.
- **Team:** Invite users and assign permissions.
- **Policies:** Define and enforce organizational rules.
- **History:** View changes and roll back versions.
- **Devices:** View registered devices and compliance status.

The Worker serves the dashboard under `/dashboard/`. People sign in with their passkey.

- The dashboard never decrypts secrets and never writes values. It has no environment private key, so it cannot sign a version. It shows history and rolls back to an older signed version. People set values with `noenv secret set`.
- Creating an environment in the browser wraps its private key for the creator's registered public key.
- Sharing an environment key with another member needs a private key in the browser. Until per-device keys exist, key sharing is a CLI action (`noenv grant`).


## 9. CLI Commands

```bash
noenv shell zsh|bash
noenv init
noenv status

noenv secret set KEY
noenv secret list
noenv secret rollback KEY VERSION
noenv secret sign
noenv trust

noenv migrate
```

`noenv shell` prints the shell hook for the given shell. The hook starts authentication when no valid session exists. Developers do not run separate login or hook install commands.

Secret entry must not expose values through terminal echo or command-line arguments.

## 10. Security Requirements

- No plaintext secret files created by NOENV.
- No secret values in NOENV logs or normal terminal output.
- No plaintext secret values stored in Cloudflare.
- No plaintext secret caching on disk.
- No execution of arbitrary shell code from `.noenv`.
- Reserve secret names that change how a shell or a runtime runs code: `PATH`, `PROMPT_COMMAND`, `PS1`, `PROMPT`, `BASH_ENV`, `NODE_OPTIONS`, `PYTHONPATH`, and names that start with `LD_`, `DYLD_`, `GIT_`, `NOENV_` or `_NOENV_`, among others (`packages/config/src/names.ts`). The comparison ignores case. The worker rejects these names on write. `.env` migration treats them as invalid. The CLI skips them on load, so a stored value cannot run code on a reader's machine.
- No automatic destructive filesystem operations, except the admin-enforced `.env` deletion in §7, within its limits.
- Restore previous shell variables on project exit.
- Enforce authorization and applicable policies before retrieval.
- Use D1 for authoritative permissions and version pointers; account for KV eventual consistency.
- Support recovery of encryption keys before production use.

- Passkeys require user verification (PIN or biometric) for registration and sign-in.
- When `minCliVersion` is set, a bearer client that sends no version header is rejected like an old CLI. Cookie (dashboard) requests are exempt.
- The `AUTH_LIMIT` rate limit binding limits each address to 20 requests a minute on each unauthenticated sign-in and setup endpoint.
- Only org admins and project admins can look up a user by email.

**Threat model:** NOENV prevents accidental secret exposure. It does not prevent an authorized developer or application from deliberately inspecting injected environment variables.

Known limits that the design accepts:

- **Secrets are ambient in the shell.** Every process started in a loaded repository gets every secret, including install scripts, coding agents, and editor extensions. `noenv exec -- <command>` limits the secrets to one command.
- **The project comes from the local git origin.** A directory that claims a known origin loads that project's secrets for a person who has access. This adds little risk on top of the previous limit, because that person already runs code in the real repository.
- **`identity.json` is the root credential.** It is a plaintext PKCS8 private key, mode 0600, in the NOENV config directory. Anyone who copies it and holds a session can unwrap every environment key of that person. Keep it out of backups and dotfile sync. After a leak, an admin resets the key and rotates the affected environments.
- **Trust on first use.** The first key pin and the first `noenv grant` trust the server. Compare fingerprints out of band when the server could be compromised.

## 11. MVP Scope

The MVP must support:

1. One-click deployment to Cloudflare (Deploy to Cloudflare button), or one command from a checkout (`npm run setup -- --admin you@example.com`).
2. Landing page with CLI install and shell setup, and automatic authentication on shell start.
3. `.noenv` project configuration.
4. Automatic directory-based secret injection and removal.
5. Client-side encryption and decryption.
6. Multiple projects and environments.
7. Basic team permissions.
8. Secret version history and rollback.
9. Dashboard for secrets, users, and policies.
10. `.env` detection, migration, and policy enforcement.

**Out of scope:** Enterprise SSO, automatic credential rotation, CI/CD identities, per-secret permissions, and advanced compliance verification.

---

**Core principle:** NOENV makes secrets available to authorized applications automatically, without requiring developers to create, copy, or manage plaintext `.env` files.
