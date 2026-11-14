import { createSession, hashToken, randomToken } from "./auth.ts";
import type { Context } from "./context.ts";
import { HttpError, json, readJson } from "./http.ts";

export const USER_CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CODE_TTL_SECONDS = 600;
const POLL_INTERVAL_SECONDS = 5;

export async function startDeviceAuth({ request, env }: Context): Promise<Response> {
  const body = await request.json().catch(() => null);
  const requested = (body as { deviceName?: unknown } | null)?.deviceName;
  const deviceName = typeof requested === "string" ? requested.slice(0, 100) : null;
  const ip = request.headers.get("CF-Connecting-IP");
  const country = (request.cf as { country?: string } | undefined)?.country ?? null;
  const deviceCode = randomToken();
  const userCode = randomUserCode();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM device_codes WHERE expires_at <= datetime('now')"),
    env.DB
      .prepare(
        `INSERT INTO device_codes (device_code_hash, user_code, expires_at, device_name, ip, country, created_at)
         VALUES (?, ?, datetime('now', ?), ?, ?, ?, datetime('now'))`,
      )
      .bind(await hashToken(deviceCode), userCode, `+${DEVICE_CODE_TTL_SECONDS} seconds`, deviceName, ip, country),
  ]);

  const verificationUri = `${new URL(request.url).origin}/activate`;
  return json(
    {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: verificationUri,
      interval: POLL_INTERVAL_SECONDS,
      expiresIn: DEVICE_CODE_TTL_SECONDS,
    },
    201,
  );
}

export async function issueSessionToken({ request, env }: Context): Promise<Response> {
  const { deviceCode, deviceName } = await readJson(request);
  if (typeof deviceCode !== "string") {
    throw new HttpError(400, "deviceCode is required");
  }
  if (deviceName !== undefined && (typeof deviceName !== "string" || deviceName.length > 100)) {
    throw new HttpError(400, "deviceName must be at most 100 characters");
  }

  const deviceCodeHash = await hashToken(deviceCode);
  const claimed = await env.DB
    .prepare(
      `DELETE FROM device_codes
       WHERE device_code_hash = ? AND user_id IS NOT NULL AND expires_at > datetime('now')
       RETURNING user_id, device_name`,
    )
    .bind(deviceCodeHash)
    .first<{ user_id: string; device_name: string | null }>();

  if (!claimed) {
    throw new HttpError(400, (await isPending(env.DB, deviceCodeHash)) ? "authorization_pending" : "expired_token");
  }

  return json(await createSession(env, claimed.user_id, claimed.device_name ?? deviceName ?? "unknown device"));
}

export async function approveUserCode(db: D1Database, userCode: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE device_codes SET user_id = ?
       WHERE user_code = ? AND user_id IS NULL AND expires_at > datetime('now')`,
    )
    .bind(userId, userCode)
    .run();
  return result.meta.changes === 1;
}

export type PendingDevice = {
  deviceName: string | null;
  ip: string | null;
  country: string | null;
  createdAt: string | null;
};

export async function findPendingDevice(db: D1Database, userCode: string): Promise<PendingDevice | null> {
  return db
    .prepare(
      `SELECT device_name AS deviceName, ip, country, created_at AS createdAt FROM device_codes
       WHERE user_code = ? AND user_id IS NULL AND expires_at > datetime('now')`,
    )
    .bind(userCode)
    .first<PendingDevice>();
}

async function isPending(db: D1Database, deviceCodeHash: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM device_codes WHERE device_code_hash = ? AND expires_at > datetime('now')")
    .bind(deviceCodeHash)
    .first();
  return row !== null;
}

function randomUserCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => USER_CODE_ALPHABET[byte & 31]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
