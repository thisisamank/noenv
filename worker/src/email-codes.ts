import { hashToken } from "./auth.ts";
import type { Context, Env, UserContext } from "./context.ts";
import { canSendEmail, sendCodeEmail, sendEmailChangedNotice } from "./email.ts";
import { HttpError, json, readJson, requireSameOrigin } from "./http.ts";
import { signedIn } from "./passkeys.ts";

export type CodePurpose = "login" | "approve" | "change_email";

const CODE_TTL = "+10 minutes";
const RESEND_AFTER = "-60 seconds";
const MAX_ATTEMPTS = 5;
const CODE_DIGITS = 6;

export async function requestSignInCode({ request, env, waitUntil }: Context): Promise<Response> {
  requireSameOrigin(request);
  requireEmail(env);
  const email = parseEmail((await readJson(request)).email);
  const user = await findActiveUser(env.DB, email);
  const code = user && (await issueCode(env.DB, user.id, "login"));
  if (user && code) {
    // Send in the background, so the response time does not show whether the address has an account.
    waitUntil(sendCodeEmail(env, { to: user.email, code, host: new URL(request.url).host, purpose: "login" }));
  }
  return json({ sent: true });
}

export async function verifySignInCode({ request, env }: Context): Promise<Response> {
  requireSameOrigin(request);
  requireEmail(env);
  const { email, code } = await readJson(request);
  const user = await findActiveUser(env.DB, parseEmail(email));
  if (!user || !(await redeemCode(env.DB, user.id, "login", code))) {
    throw new HttpError(401, "the code is wrong or expired, request a new code");
  }
  return signedIn(env, user.id);
}

export async function requestApprovalCode({ request, env, userId }: UserContext): Promise<Response> {
  requireEmail(env);
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  const code = await issueCode(env.DB, userId, "approve");
  if (!code) {
    throw new HttpError(429, "a code was sent less than a minute ago, check your inbox");
  }
  if (!(await sendCodeEmail(env, { to: user!.email, code, host: new URL(request.url).host, purpose: "approve" }))) {
    await env.DB.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = 'approve'").bind(userId).run();
    throw new HttpError(502, "the email could not be sent, approve with a passkey instead");
  }
  return json({ sent: true });
}

export async function requestEmailChange({ request, env, userId }: UserContext): Promise<Response> {
  requireEmail(env);
  const email = parseEmail((await readJson(request)).email);
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  if (email === user!.email) {
    throw new HttpError(400, "this is already your email");
  }
  await requireUnusedEmail(env.DB, email);

  const code = await issueCode(env.DB, userId, "change_email", email);
  if (!code) {
    throw new HttpError(429, "a code was sent less than a minute ago, check your inbox");
  }
  if (!(await sendCodeEmail(env, { to: email, code, host: new URL(request.url).host, purpose: "change_email" }))) {
    await env.DB.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = 'change_email'").bind(userId).run();
    throw new HttpError(502, "the email could not be sent, check the address");
  }
  return json({ sent: true });
}

export async function confirmEmailChange({ request, env, userId, waitUntil }: UserContext): Promise<Response> {
  requireEmail(env);
  const redeemed = await redeemCode(env.DB, userId, "change_email", (await readJson(request)).code);
  if (!redeemed?.email) {
    throw new HttpError(401, "the code is wrong or expired, request a new code");
  }
  await requireUnusedEmail(env.DB, redeemed.email);

  const old = await env.DB
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(redeemed.email, userId),
    env.DB.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose != 'change_email'").bind(userId),
  ]);
  waitUntil(sendEmailChangedNotice(env, { to: old!.email, newEmail: redeemed.email, host: new URL(request.url).host }));
  return json({ email: redeemed.email });
}

/** Returns the new code, or null when a code for this purpose was sent less than a minute ago. */
export async function issueCode(db: D1Database, userId: string, purpose: CodePurpose, email: string | null = null): Promise<string | null> {
  const code = randomCode();
  const row = await db
    .prepare(
      `INSERT INTO email_codes (user_id, purpose, code_hash, email, expires_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now', ?5))
       ON CONFLICT (user_id, purpose) DO UPDATE
         SET code_hash = excluded.code_hash, email = excluded.email, attempts = 0, created_at = datetime('now'), expires_at = excluded.expires_at
         WHERE email_codes.created_at <= datetime('now', ?6)
       RETURNING user_id`,
    )
    .bind(userId, purpose, await codeHash(userId, purpose, code), email, CODE_TTL, RESEND_AFTER)
    .first();
  return row ? code : null;
}

/**
 * Uses the code once and returns its row, or null when the code is wrong or expired.
 * Each guess counts, and the code stops working after MAX_ATTEMPTS guesses.
 */
export async function redeemCode(db: D1Database, userId: string, purpose: CodePurpose, code: unknown): Promise<{ email: string | null } | null> {
  const digits = typeof code === "string" ? code.replace(/\s|-/g, "") : "";
  if (!new RegExp(`^\\d{${CODE_DIGITS}}$`).test(digits)) return null;

  const counted = await db
    .prepare(
      `UPDATE email_codes SET attempts = attempts + 1
       WHERE user_id = ? AND purpose = ? AND expires_at > datetime('now') AND attempts < ?
       RETURNING code_hash`,
    )
    .bind(userId, purpose, MAX_ATTEMPTS)
    .first<{ code_hash: string }>();
  if (!counted || counted.code_hash !== (await codeHash(userId, purpose, digits))) return null;

  return db
    .prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = ? AND code_hash = ? RETURNING email")
    .bind(userId, purpose, counted.code_hash)
    .first<{ email: string | null }>();
}

async function requireUnusedEmail(db: D1Database, email: string): Promise<void> {
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) {
    throw new HttpError(409, "this email belongs to another account");
  }
}

function requireEmail(env: Env): void {
  if (!canSendEmail(env)) {
    throw new HttpError(409, "sign-in by email is not available on this deployment");
  }
}

function parseEmail(email: unknown): string {
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
    throw new HttpError(400, "enter a valid email address");
  }
  return email.trim().toLowerCase();
}

async function findActiveUser(db: D1Database, email: string) {
  return db.prepare("SELECT id, email FROM users WHERE email = ? AND removed_at IS NULL").bind(email).first<{ id: string; email: string }>();
}

function codeHash(userId: string, purpose: CodePurpose, code: string): Promise<string> {
  return hashToken(`${userId}:${purpose}:${code}`);
}

function randomCode(): string {
  // Rejection sampling keeps every code equally likely.
  const limit = 10 ** CODE_DIGITS;
  const max = Math.floor(2 ** 32 / limit) * limit;
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value! < max) return String(value! % limit).padStart(CODE_DIGITS, "0");
  }
}
