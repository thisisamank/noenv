import type { Sealed } from "@noenv/crypto";
import type { EnvironmentContext } from "./context.ts";
import { secretNameParam } from "./guards.ts";
import { HttpError, json, readJson } from "./http.ts";
import { isPublicKey, parseSealed, parseSignedSecret } from "./sealed.ts";

type ActiveSecret = {
  name: string;
  version: number;
  sealed: Sealed;
};

type Snapshot = {
  revision: number;
  secrets: ActiveSecret[];
};

export async function listSecrets(context: EnvironmentContext): Promise<Response> {
  const { results } = await context.env.DB
    .prepare(
      `SELECT s.name, s.active_version AS version, u.email AS author, v.created_at AS updatedAt
       FROM secrets s
       JOIN secret_versions v USING (project_id, environment, name)
       JOIN users u ON u.id = v.author_id
       WHERE s.project_id = ? AND s.environment = ? AND v.version = s.active_version
       ORDER BY s.name`,
    )
    .bind(context.projectId, context.environment)
    .all();
  return json({ secrets: results });
}

export async function getBundle(context: EnvironmentContext): Promise<Response> {
  const state = await context.env.DB
    .prepare(
      `SELECT k.wrapped_key, e.revision, e.public_key
       FROM environment_keys k
       JOIN environments e ON e.project_id = k.project_id AND e.name = k.environment
       WHERE k.project_id = ? AND k.environment = ? AND k.user_id = ?`,
    )
    .bind(context.projectId, context.environment, context.userId)
    .first<{ wrapped_key: string; revision: number; public_key: string }>();

  if (!state) {
    throw new HttpError(403, "no environment key has been shared with this user");
  }

  const cached = await context.env.SECRETS.get<Snapshot>(snapshotKey(context), "json");
  const snapshot = cached?.revision === state.revision ? cached : await readSnapshot(context);

  return json({
    projectId: context.projectId,
    policies: context.policies,
    revision: snapshot.revision,
    publicKey: state.public_key,
    wrappedKey: JSON.parse(state.wrapped_key),
    secrets: snapshot.secrets,
  });
}

export async function putSecret(context: EnvironmentContext): Promise<Response> {
  const name = secretNameParam(context);
  const sealed = parseSignedSecret(await readJson(context.request));
  const version = await addVersion(context, name, sealed, null);
  return json({ name, version }, 201);
}

export async function listVersions(context: EnvironmentContext): Promise<Response> {
  const name = secretNameParam(context);
  const { results } = await context.env.DB
    .prepare(
      `SELECT v.version, u.email AS author, v.restored_from AS restoredFrom, v.created_at AS createdAt
       FROM secret_versions v JOIN users u ON u.id = v.author_id
       WHERE v.project_id = ? AND v.environment = ? AND v.name = ?
       ORDER BY v.version DESC`,
    )
    .bind(context.projectId, context.environment, name)
    .all();

  if (results.length === 0) {
    throw new HttpError(404, "secret not found");
  }
  return json({ name, versions: results });
}

export async function rollbackSecret(context: EnvironmentContext): Promise<Response> {
  const name = secretNameParam(context);
  const { version } = await readJson(context.request);
  if (!Number.isInteger(version)) {
    throw new HttpError(400, "version must be an integer");
  }

  const target = await context.env.DB
    .prepare(
      `SELECT v.ephemeral_public_key AS ephemeralPublicKey, v.iv, v.ciphertext, v.mac, v.key_version = e.key_version AS current
       FROM secret_versions v JOIN environments e ON e.project_id = v.project_id AND e.name = v.environment
       WHERE v.project_id = ? AND v.environment = ? AND v.name = ? AND v.version = ?`,
    )
    .bind(context.projectId, context.environment, name, version)
    .first<Sealed & { current: number }>();

  if (!target) {
    throw new HttpError(404, "version not found");
  }
  if (!target.current) {
    throw new HttpError(409, "this version was written with an earlier environment key, so it cannot be restored after a rotation");
  }

  const { current: _current, ...sealed } = target;
  const newVersion = await addVersion(context, name, sealed, version as number);
  return json({ name, version: newVersion, restoredFrom: version });
}

export async function listKeyHolders({ env, projectId, environment }: EnvironmentContext): Promise<Response> {
  const { results } = await env.DB
    .prepare(
      `SELECT u.id AS userId, u.email, u.public_key AS publicKey FROM environment_keys k JOIN users u ON u.id = k.user_id
       WHERE k.project_id = ? AND k.environment = ? ORDER BY u.email`,
    )
    .bind(projectId, environment)
    .all();
  return json({ holders: results });
}

export async function rotateEnvironmentKey(context: EnvironmentContext): Promise<Response> {
  const { env, projectId, environment, userId } = context;
  const db = env.DB;
  const body = await readJson(context.request);
  if (!isPublicKey(body.publicKey)) {
    throw new HttpError(400, "publicKey must be the base64 public key of the new environment key");
  }
  const wrappedKeys = objectOf(body.wrappedKeys, "wrappedKeys", (value) => parseSealed(value, "wrappedKeys"));
  const secrets = objectOf(body.secrets, "secrets", parseSignedSecret);

  const [holders, active] = await db.batch<{ id: string }>([
    db.prepare("SELECT user_id AS id FROM environment_keys WHERE project_id = ? AND environment = ?").bind(projectId, environment),
    db.prepare("SELECT name AS id FROM secrets WHERE project_id = ? AND environment = ?").bind(projectId, environment),
  ]);
  requireSameSet(holders.results.map((row) => row.id), Object.keys(wrappedKeys), "wrappedKeys must cover exactly the current key holders");
  requireSameSet(active.results.map((row) => row.id), Object.keys(secrets), "secrets must cover exactly the active secrets");
  if (!(userId in wrappedKeys)) {
    throw new HttpError(400, "wrappedKeys must include your own key");
  }

  await db.batch([
    db
      .prepare("UPDATE environments SET public_key = ?, key_version = key_version + 1, revision = revision + 1 WHERE project_id = ? AND name = ?")
      .bind(body.publicKey, projectId, environment),
    db.prepare("DELETE FROM environment_keys WHERE project_id = ? AND environment = ?").bind(projectId, environment),
    ...Object.entries(wrappedKeys).map(([holder, wrapped]) =>
      db
        .prepare("INSERT INTO environment_keys (project_id, environment, user_id, wrapped_key) VALUES (?, ?, ?, ?)")
        .bind(projectId, environment, holder, JSON.stringify(wrapped)),
    ),
    ...Object.entries(secrets).flatMap(([name, sealed]) => [
      db
        .prepare(
          `INSERT INTO secret_versions
             (project_id, environment, name, version, ephemeral_public_key, iv, ciphertext, author_id, mac, key_version)
           SELECT ?1, ?2, ?3, MAX(version) + 1, ?4, ?5, ?6, ?7, ?8,
                  (SELECT key_version FROM environments WHERE project_id = ?1 AND name = ?2)
           FROM secret_versions WHERE project_id = ?1 AND environment = ?2 AND name = ?3`,
        )
        .bind(projectId, environment, name, sealed.ephemeralPublicKey, sealed.iv, sealed.ciphertext, userId, sealed.mac!),
      db
        .prepare(
          `UPDATE secrets SET active_version = (SELECT MAX(version) FROM secret_versions WHERE project_id = ?1 AND environment = ?2 AND name = ?3)
           WHERE project_id = ?1 AND environment = ?2 AND name = ?3`,
        )
        .bind(projectId, environment, name),
    ]),
  ]);

  await env.SECRETS.put(snapshotKey(context), JSON.stringify(await readSnapshot(context)));
  return json({ rotated: true, holders: Object.keys(wrappedKeys).length, secrets: Object.keys(secrets).length });
}

function objectOf<T>(value: unknown, field: string, parse: (item: unknown) => T): Record<string, T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length > 500) {
    throw new HttpError(400, `${field} has too many entries`);
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, parse(item)]));
}

function requireSameSet(expected: string[], actual: string[], message: string): void {
  const wanted = new Set(expected);
  if (wanted.size !== actual.length || !actual.every((item) => wanted.has(item))) {
    throw new HttpError(409, message);
  }
}

async function addVersion(context: EnvironmentContext, name: string, sealed: Sealed, restoredFrom: number | null): Promise<number> {
  const { projectId, environment, userId } = context;
  const db = context.env.DB;

  const [inserted] = await db.batch<{ version: number }>([
    db
      .prepare(
        `INSERT INTO secret_versions
           (project_id, environment, name, version, ephemeral_public_key, iv, ciphertext, author_id, restored_from, mac, key_version)
         SELECT ?1, ?2, ?3, COALESCE(MAX(version), 0) + 1, ?4, ?5, ?6, ?7, ?8, ?9,
                (SELECT key_version FROM environments WHERE project_id = ?1 AND name = ?2)
         FROM secret_versions WHERE project_id = ?1 AND environment = ?2 AND name = ?3
         RETURNING version`,
      )
      .bind(projectId, environment, name, sealed.ephemeralPublicKey, sealed.iv, sealed.ciphertext, userId, restoredFrom, sealed.mac ?? null),
    db
      .prepare(
        `INSERT INTO secrets (project_id, environment, name, active_version)
         SELECT ?1, ?2, ?3, MAX(version)
         FROM secret_versions WHERE project_id = ?1 AND environment = ?2 AND name = ?3
         ON CONFLICT (project_id, environment, name) DO UPDATE SET active_version = excluded.active_version`,
      )
      .bind(projectId, environment, name),
    db
      .prepare("UPDATE environments SET revision = revision + 1 WHERE project_id = ? AND name = ?")
      .bind(projectId, environment),
  ]);

  await context.env.SECRETS.put(snapshotKey(context), JSON.stringify(await readSnapshot(context)));
  return inserted.results[0].version;
}

async function readSnapshot({ env, projectId, environment }: EnvironmentContext): Promise<Snapshot> {
  const db = env.DB;
  const [revision, secrets] = await db.batch([
    db.prepare("SELECT revision FROM environments WHERE project_id = ? AND name = ?").bind(projectId, environment),
    db
      .prepare(
        `SELECT s.name, s.active_version AS version, v.ephemeral_public_key AS ephemeralPublicKey, v.iv, v.ciphertext, v.mac
         FROM secrets s
         JOIN secret_versions v USING (project_id, environment, name)
         WHERE s.project_id = ? AND s.environment = ? AND v.version = s.active_version
         ORDER BY s.name`,
      )
      .bind(projectId, environment),
  ]);

  const rows = secrets.results as (Sealed & { name: string; version: number; mac: string | null })[];
  return {
    revision: (revision.results[0] as { revision: number }).revision,
    secrets: rows.map(({ name, version, mac, ...sealed }) => ({ name, version, sealed: mac ? { ...sealed, mac } : sealed })),
  };
}

function snapshotKey({ projectId, environment }: EnvironmentContext): string {
  return `snapshot/${projectId}/${environment}`;
}
