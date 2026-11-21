import { newId } from "./auth.ts";
import type { UserContext } from "./context.ts";
import { identifierParam } from "./guards.ts";
import { HttpError, json, readJson } from "./http.ts";
import { isPublicKey, parseSealed } from "./sealed.ts";

/** A device that is not approved within this time must register again. */
const PENDING_TTL = "-1 day";
const MAX_DEVICES = 50;

type DeviceRow = {
  id: string;
  user_id: string;
  name: string;
  public_key: string;
  ip: string | null;
  country: string | null;
  wrapped_key: string | null;
  account_key: string | null;
  created_at: string;
  approved_at: string | null;
};

/**
 * A device asks for a copy of its owner's account key. The copy is encrypted on a device that
 * already has the key (see approveDeviceKey); the server only stores it and never sees the key.
 */
export async function registerDeviceKey({ request, env, userId }: UserContext): Promise<Response> {
  const { name, publicKey } = await readJson(request);
  if (!isPublicKey(publicKey)) {
    throw new HttpError(400, "publicKey must be a base64 P-256 public key");
  }
  const deviceName = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "unknown device";
  const accountKey = await currentAccountKey(env.DB, userId);
  if (!accountKey) {
    throw new HttpError(409, "this account has no key yet, so there is nothing to copy to a device");
  }

  const existing = await env.DB.prepare("SELECT * FROM device_keys WHERE public_key = ?").bind(publicKey).first<DeviceRow>();
  if (existing) {
    if (existing.user_id === userId) return json(describe(existing, accountKey));
    throw new HttpError(409, "this device key belongs to another account");
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM device_keys WHERE user_id = ?").bind(userId).first<{ count: number }>();
  if (count!.count >= MAX_DEVICES) {
    throw new HttpError(409, `you have ${MAX_DEVICES} devices, remove one with \`noenv device remove\``);
  }

  const cf = (request as { cf?: { country?: string } }).cf;
  const [, created] = await env.DB.batch<DeviceRow>([
    env.DB.prepare(`DELETE FROM device_keys WHERE approved_at IS NULL AND created_at <= datetime('now', ?)`).bind(PENDING_TTL),
    env.DB
      .prepare(
        `INSERT INTO device_keys (id, user_id, name, public_key, ip, country)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(newId("dev"), userId, deviceName, publicKey, request.headers.get("CF-Connecting-IP"), cf?.country ?? null),
  ]);
  return json(describe(created!.results[0]!, accountKey), 201);
}

export async function listDeviceKeys({ env, userId }: UserContext): Promise<Response> {
  const accountKey = await currentAccountKey(env.DB, userId);
  const { results } = await env.DB
    .prepare(
      `SELECT * FROM device_keys
       WHERE user_id = ? AND (approved_at IS NOT NULL OR created_at > datetime('now', ?))
       ORDER BY created_at`,
    )
    .bind(userId, PENDING_TTL)
    .all<DeviceRow>();
  return json({ devices: results.map((row) => describe(row, accountKey)) });
}

export async function approveDeviceKey(context: UserContext): Promise<Response> {
  const { env, userId } = context;
  const deviceId = identifierParam(context, "deviceId");
  const wrappedKey = parseSealed((await readJson(context.request)).wrappedKey, "wrappedKey");
  const accountKey = await currentAccountKey(env.DB, userId);

  const approved = await env.DB
    .prepare(
      `UPDATE device_keys SET wrapped_key = ?, account_key = ?, approved_at = datetime('now')
       WHERE id = ? AND user_id = ? AND approved_at IS NULL AND created_at > datetime('now', ?)
       RETURNING *`,
    )
    .bind(JSON.stringify(wrappedKey), accountKey, deviceId, userId, PENDING_TTL)
    .first<DeviceRow>();
  if (!approved) {
    throw new HttpError(404, "no device waits for approval with this id, it may be approved or expired");
  }
  return json(describe(approved, accountKey));
}

export async function removeDeviceKey(context: UserContext): Promise<Response> {
  const deviceId = identifierParam(context, "deviceId");
  const result = await context.env.DB
    .prepare("DELETE FROM device_keys WHERE id = ? AND user_id = ?")
    .bind(deviceId, context.userId)
    .run();
  if (result.meta.changes === 0) {
    throw new HttpError(404, "device not found");
  }
  return new Response(null, { status: 204 });
}

function describe(row: DeviceRow, accountKey: string | null) {
  // A copy made for an older account key (before an admin reset) is useless, so it counts as pending.
  const current = row.approved_at !== null && row.wrapped_key !== null && row.account_key === accountKey;
  return {
    id: row.id,
    name: row.name,
    publicKey: row.public_key,
    ip: row.ip,
    country: row.country,
    createdAt: row.created_at,
    approvedAt: current ? row.approved_at : null,
    status: current ? "approved" : "pending",
    wrappedKey: current ? JSON.parse(row.wrapped_key!) : null,
  };
}

async function currentAccountKey(db: D1Database, userId: string): Promise<string | null> {
  const user = await db.prepare("SELECT public_key FROM users WHERE id = ?").bind(userId).first<{ public_key: string | null }>();
  return user?.public_key ?? null;
}
