import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createSession, hashToken, newId } from "./auth.ts";
import type { Context } from "./context.ts";
import { clearedSessionCookie, readSessionCookie, sessionCookie } from "./cookies.ts";
import { HttpError, json, readJson, requireSameOrigin } from "./http.ts";
import { canSendEmail, sendInviteEmail } from "./email.ts";
import { createInviteLink, findInvite, type Invite } from "./invites.ts";

export const BROWSER_DEVICE = "Browser";

const RP_NAME = "noenv";
const CHALLENGE_TTL = "+5 minutes";

type Purpose = "register" | "login";

type StoredPasskey = {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string;
};

export async function registrationOptions({ request, env }: Context): Promise<Response> {
  const { token } = await readJson(request);
  return beginRegistration(request, env, await findInvite(env.DB, token));
}

export async function registrationVerify({ request, env }: Context): Promise<Response> {
  requireSameOrigin(request);
  const { token, response } = await readJson(request);
  return finishRegistration(request, env, await findInvite(env.DB, token), response);
}

const MIN_SETUP_TOKEN_LENGTH = 16;

export async function setupStatus({ env }: Context): Promise<Response> {
  const open = await isSetupOpen(env);
  const email = canSendEmail(env);
  return json({ available: await isSetupAvailable(env), email, missingToken: open && !email && !hasSetupToken(env) });
}

export async function setupOptions({ request, env }: Context): Promise<Response> {
  const { email, token } = await readJson(request);
  return beginRegistration(request, env, await claimAdmin(env, email, token));
}

export async function setupVerify({ request, env }: Context): Promise<Response> {
  requireSameOrigin(request);
  const { email, token, response } = await readJson(request);
  return finishRegistration(request, env, await claimAdmin(env, email, token), response);
}

export async function emailSetupLink({ request, env }: Context): Promise<Response> {
  requireSameOrigin(request);
  if (!canSendEmail(env) || !(await isSetupAvailable(env))) {
    throw new HttpError(409, "setup by email is not available on this deployment");
  }

  const admin = await upsertAdmin(env);
  const recent = await env.DB
    .prepare("SELECT 1 FROM invites WHERE user_id = ? AND expires_at > datetime('now', '+7 days', '-1 minute')")
    .bind(admin.userId)
    .first();
  if (recent) {
    throw new HttpError(429, "a setup link was sent less than a minute ago, check your inbox");
  }

  const link = await createInviteLink(env.DB, request, admin.userId);
  if (!(await sendInviteEmail(env, { to: admin.email, link, invitedBy: null }))) {
    throw new HttpError(502, "the setup email could not be sent: check that EMAIL_FROM uses a domain onboarded to Cloudflare Email Sending, or remove EMAIL_FROM to set up without email");
  }
  return json({ sent: true });
}

export async function isSetupAvailable(env: Context["env"]): Promise<boolean> {
  return (canSendEmail(env) || hasSetupToken(env)) && (await isSetupOpen(env));
}

async function isSetupOpen(env: Context["env"]): Promise<boolean> {
  if (!env.ADMIN_EMAIL) return false;
  return (await env.DB.prepare("SELECT 1 FROM passkeys LIMIT 1").first()) === null;
}

function hasSetupToken(env: Context["env"]): boolean {
  return (env.SETUP_TOKEN?.trim().length ?? 0) >= MIN_SETUP_TOKEN_LENGTH;
}

async function claimAdmin(env: Context["env"], email: unknown, token: unknown): Promise<Invite> {
  if (canSendEmail(env)) {
    throw new HttpError(403, "this deployment sends the setup link by email, use Email me the setup link");
  }
  const expected = env.ADMIN_EMAIL?.trim().toLowerCase();
  const emailMatches = typeof email === "string" && email.trim().toLowerCase() === expected;
  const tokenMatches = typeof token === "string" && hasSetupToken(env) && (await hashToken(token.trim())) === (await hashToken(env.SETUP_TOKEN!.trim()));
  if (!(await isSetupAvailable(env)) || !emailMatches || !tokenMatches) {
    throw new HttpError(403, "setup is closed, or the admin email or setup token does not match the values set at deploy time");
  }
  return upsertAdmin(env);
}

async function upsertAdmin(env: Context["env"]): Promise<Invite> {
  const user = await env.DB
    .prepare(
      `INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)
       ON CONFLICT (email) DO UPDATE SET is_admin = 1
       RETURNING id AS userId, email`,
    )
    .bind(newId("usr"), env.ADMIN_EMAIL!.trim().toLowerCase())
    .first<Invite>();
  return user!;
}

async function beginRegistration(request: Request, env: Context["env"], user: Invite): Promise<Response> {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: new URL(request.url).hostname,
    userName: user.email,
    userID: new TextEncoder().encode(user.userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(env.DB, options.challenge, "register", user.userId);
  return json(options);
}

async function finishRegistration(request: Request, env: Context["env"], user: Invite, response: unknown): Promise<Response> {
  const { hostname, origin } = new URL(request.url);
  const result = await verifyRegistrationResponse({
    response: response as RegistrationResponseJSON,
    expectedChallenge: (challenge) => consumeChallenge(env.DB, challenge, "register", user.userId),
    expectedOrigin: origin,
    expectedRPID: hostname,
    requireUserVerification: true,
  }).catch(() => ({ verified: false as const }));

  if (!result.verified) {
    throw new HttpError(400, "the passkey could not be verified, try again");
  }

  const { credential } = result.registrationInfo;
  await env.DB.batch([
    env.DB
      .prepare("INSERT INTO passkeys (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)")
      .bind(credential.id, user.userId, toBase64(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? [])),
    env.DB.prepare("DELETE FROM invites WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM passkeys WHERE user_id = ? AND id != ?").bind(user.userId, credential.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("UPDATE users SET removed_at = NULL WHERE id = ?").bind(user.userId),
  ]);
  return signedIn(env, user.userId);
}

export async function loginOptions({ request, env }: Context): Promise<Response> {
  const options = await generateAuthenticationOptions({ rpID: new URL(request.url).hostname, userVerification: "required" });
  await storeChallenge(env.DB, options.challenge, "login", null);
  return json(options);
}

export async function loginVerify({ request, env }: Context): Promise<Response> {
  requireSameOrigin(request);
  const { response } = (await readJson(request)) as { response?: AuthenticationResponseJSON };
  return signedIn(env, await verifyPasskey(request, env, response));
}

export async function verifyPasskey(request: Request, env: Context["env"], response: AuthenticationResponseJSON | undefined): Promise<string> {
  const passkey = await env.DB
    .prepare("SELECT * FROM passkeys WHERE id = ?")
    .bind(typeof response?.id === "string" ? response.id : "")
    .first<StoredPasskey>();

  if (!passkey) {
    throw new HttpError(401, "this passkey is not registered with this noenv deployment");
  }

  const { hostname, origin } = new URL(request.url);
  const result = await verifyAuthenticationResponse({
    response: response!,
    expectedChallenge: (challenge) => consumeChallenge(env.DB, challenge, "login", null),
    expectedOrigin: origin,
    expectedRPID: hostname,
    credential: {
      id: passkey.id,
      publicKey: fromBase64(passkey.public_key),
      counter: passkey.counter,
      transports: JSON.parse(passkey.transports),
    },
    requireUserVerification: true,
  }).catch(() => ({ verified: false, authenticationInfo: undefined }));

  if (!result.verified || !result.authenticationInfo) {
    throw new HttpError(401, "the passkey could not be verified, try again");
  }

  await env.DB
    .prepare("UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?")
    .bind(result.authenticationInfo.newCounter, passkey.id)
    .run();
  return passkey.user_id;
}

export async function logout({ request, env }: Context): Promise<Response> {
  requireSameOrigin(request);
  const token = readSessionCookie(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
}

async function signedIn(env: Context["env"], userId: string): Promise<Response> {
  const session = await createSession(env, userId, BROWSER_DEVICE);
  return new Response(JSON.stringify({ signedIn: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(session.token, session.expiresAt) },
  });
}

async function storeChallenge(db: D1Database, challenge: string, purpose: Purpose, userId: string | null): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM challenges WHERE expires_at <= datetime('now')"),
    db
      .prepare("INSERT INTO challenges (challenge, purpose, user_id, expires_at) VALUES (?, ?, ?, datetime('now', ?))")
      .bind(challenge, purpose, userId, CHALLENGE_TTL),
  ]);
}

async function consumeChallenge(db: D1Database, challenge: string, purpose: Purpose, userId: string | null): Promise<boolean> {
  const row = await db
    .prepare(
      `DELETE FROM challenges
       WHERE challenge = ? AND purpose = ? AND user_id IS ? AND expires_at > datetime('now')
       RETURNING challenge`,
    )
    .bind(challenge, purpose, userId)
    .first();
  return row !== null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
