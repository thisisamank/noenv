import { newId } from "./auth.ts";
import { identifierParam } from "./guards.ts";
import type { UserContext } from "./context.ts";
import { HttpError, json, readJson } from "./http.ts";
import { sendInvite } from "./invites.ts";
import { isPublicKey } from "./sealed.ts";

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export async function getMe({ env, userId }: UserContext): Promise<Response> {
  const user = await env.DB
    .prepare("SELECT id, email, is_admin, public_key FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; email: string; is_admin: number; public_key: string | null }>();

  return json({ id: user!.id, email: user!.email, isAdmin: user!.is_admin === 1, publicKey: user!.public_key });
}

export async function setPublicKey({ request, env, userId }: UserContext): Promise<Response> {
  const { publicKey } = await readJson(request);
  if (!isPublicKey(publicKey)) {
    throw new HttpError(400, "publicKey must be a base64 P-256 public key");
  }

  const result = await env.DB
    .prepare("UPDATE users SET public_key = ? WHERE id = ? AND public_key IS NULL")
    .bind(publicKey, userId)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(409, "a public key is already registered for this user");
  }
  return json({ publicKey });
}

type UserRow = { id: string; email: string; isAdmin: number; hasPublicKey: number; hasPasskey: number; createdAt: string };
type MembershipRow = { userId: string; repo: string; role: string; environments: string; keys: string | null };

export async function listUsers({ env }: UserContext): Promise<Response> {
  const [users, memberships] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.id, u.email, u.is_admin = 1 AS isAdmin, u.public_key IS NOT NULL AS hasPublicKey,
              EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id) AS hasPasskey, u.created_at AS createdAt
       FROM users u WHERE u.removed_at IS NULL ORDER BY u.email`,
    ),
    env.DB.prepare(
      `SELECT m.user_id AS userId, p.repo, m.role,
              (SELECT group_concat(e.name) FROM environments e WHERE e.project_id = p.id) AS environments,
              (SELECT group_concat(k.environment) FROM environment_keys k
               WHERE k.project_id = p.id AND k.user_id = m.user_id) AS keys
       FROM memberships m JOIN projects p ON p.id = m.project_id
       ORDER BY p.repo`,
    ),
  ]);

  const byUser = Map.groupBy(memberships.results as MembershipRow[], (membership) => membership.userId);
  return json({
    users: (users.results as UserRow[]).map((user) => ({
      ...user,
      isAdmin: user.isAdmin === 1,
      hasPublicKey: user.hasPublicKey === 1,
      hasPasskey: user.hasPasskey === 1,
      projects: (byUser.get(user.id) ?? []).map(({ repo, role, environments, keys }) => {
        const held = keys ? keys.split(",") : [];
        return {
          repo,
          role,
          missingKeys: (environments ? environments.split(",") : []).filter((name) => !held.includes(name)),
        };
      }),
    })),
  });
}

export async function findUser({ request, env, userId }: UserContext): Promise<Response> {
  const allowed = await env.DB
    .prepare(
      `SELECT 1 FROM users u WHERE u.id = ?1 AND (u.is_admin = 1 OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role = 'admin'))`,
    )
    .bind(userId)
    .first();
  if (!allowed) {
    throw new HttpError(403, "forbidden");
  }
  const email = new URL(request.url).searchParams.get("email")?.toLowerCase() ?? "";
  const user = await env.DB
    .prepare("SELECT id, email, public_key FROM users WHERE email = ? AND removed_at IS NULL")
    .bind(email)
    .first<{ id: string; email: string; public_key: string | null }>();

  if (!user) {
    throw new HttpError(404, "user not found");
  }
  return json({ id: user.id, email: user.email, publicKey: user.public_key });
}

export async function inviteUser(context: UserContext): Promise<Response> {
  const { request, env } = context;
  const { email } = await readJson(request);
  if (typeof email !== "string" || email.length > 254 || !EMAIL.test(email)) {
    throw new HttpError(400, "email must be a valid email address");
  }

  const user = await env.DB
    .prepare(
      `INSERT INTO users (id, email) VALUES (?, ?)
       ON CONFLICT (email) DO UPDATE SET removed_at = NULL WHERE removed_at IS NOT NULL
       RETURNING id, email`,
    )
    .bind(newId("usr"), email.toLowerCase())
    .first<{ id: string; email: string }>();

  if (!user) {
    throw new HttpError(409, "this user already exists");
  }
  return json({ ...user, ...(await sendInvite(context, user.id, user.email)) }, 201);
}

export async function setOrganizationAdmin(context: UserContext): Promise<Response> {
  const { request, env, userId } = context;
  const target = identifierParam(context, "userId");
  const { isAdmin } = await readJson(request);
  if (typeof isAdmin !== "boolean") {
    throw new HttpError(400, "isAdmin must be true or false");
  }
  if (target === userId) {
    throw new HttpError(409, "you cannot change your own admin role, ask another admin");
  }
  const result = await env.DB.prepare("UPDATE users SET is_admin = ? WHERE id = ?").bind(isAdmin ? 1 : 0, target).run();
  if (result.meta.changes === 0) {
    throw new HttpError(404, "user not found");
  }
  return json({ userId: target, isAdmin });
}

export async function removeUser(context: UserContext): Promise<Response> {
  const { env, userId } = context;
  const target = identifierParam(context, "userId");
  if (target === userId) {
    throw new HttpError(409, "you cannot remove yourself, ask another admin");
  }
  const user = await env.DB
    .prepare("SELECT EXISTS (SELECT 1 FROM secret_versions v WHERE v.author_id = u.id) AS hasHistory FROM users u WHERE u.id = ?")
    .bind(target)
    .first<{ hasHistory: number }>();
  if (!user) {
    throw new HttpError(404, "user not found");
  }

  await env.DB.batch([
    ...revokeAccess(env.DB, target),
    env.DB.prepare("DELETE FROM memberships WHERE user_id = ?").bind(target),
    env.DB.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(target),
    env.DB.prepare("DELETE FROM invites WHERE user_id = ?").bind(target),
    env.DB.prepare("DELETE FROM email_codes WHERE user_id = ?").bind(target),
    env.DB.prepare("UPDATE policies SET updated_by = ? WHERE updated_by = ?").bind(userId, target),
    user.hasHistory
      ? env.DB.prepare("UPDATE users SET is_admin = 0, removed_at = datetime('now') WHERE id = ?").bind(target)
      : env.DB.prepare("DELETE FROM users WHERE id = ?").bind(target),
  ]);
  return new Response(null, { status: 204 });
}

export async function resetPublicKey(context: UserContext): Promise<Response> {
  const target = identifierParam(context, "userId");
  const result = await context.env.DB.batch(revokeAccess(context.env.DB, target));
  if (result[0]!.meta.changes === 0) {
    throw new HttpError(404, "user not found");
  }
  return new Response(null, { status: 204 });
}

function revokeAccess(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE users SET public_key = NULL WHERE id = ?").bind(userId),
    db.prepare("DELETE FROM environment_keys WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM device_keys WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
  ];
}
