import type { Env } from "./context.ts";
import { escapeHtml } from "./pages.ts";

export type InviteEmail = {
  to: string;
  link: string;
  invitedBy: string | null;
};

type Copy = {
  subject: string;
  preview: string;
  heading: string;
  body: string;
  action: string;
  reason: string;
};

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canSendEmail(env: Env): boolean {
  return Boolean(env.EMAIL) && ADDRESS.test(env.EMAIL_FROM?.trim() ?? "");
}

export type CodeEmail = {
  to: string;
  code: string;
  host: string;
  purpose: "login" | "approve" | "change_email";
};

export type EmailChangedNotice = {
  to: string;
  newEmail: string;
  host: string;
};

export async function sendInviteEmail(env: Env, invite: InviteEmail): Promise<boolean> {
  const copy = inviteCopy(invite, new URL(invite.link).host);
  return send(env, invite.to, copy.subject, renderHtml(copy, linkAction(copy, invite.link)), renderText(copy, `${copy.action}: ${invite.link}`, LINK_EXPIRY));
}

export async function sendCodeEmail(env: Env, message: CodeEmail): Promise<boolean> {
  const copy = codeCopy(message);
  return send(env, message.to, copy.subject, renderHtml(copy, codeAction(message.code)), renderText(copy, `${copy.action}: ${message.code}`, CODE_EXPIRY));
}

export async function sendEmailChangedNotice(env: Env, notice: EmailChangedNotice): Promise<boolean> {
  const copy: Copy = {
    subject: "Your noenv email was changed",
    preview: `Your noenv account on ${notice.host} now uses ${notice.newEmail}.`,
    heading: "Your noenv email was changed",
    body: `Your account on ${notice.host} now uses ${notice.newEmail}. Sign-in codes go to that address from now on.`,
    action: "",
    reason: `You received this because ${notice.to} was the email of this account.`,
  };
  const warning = "If you did not make this change, tell an admin of your noenv team now. They can remove the account or send you a new invite.";
  return send(env, notice.to, copy.subject, renderHtml(copy, `<p style="margin:0;font-size:15px;line-height:1.6;color:#b42318;">${escapeHtml(warning)}</p>`), renderText(copy, warning, ""));
}

const LINK_EXPIRY = "This link expires in 7 days and works once.";
const CODE_EXPIRY = "This code expires in 10 minutes and works once. Never share it. noenv staff never ask for it.";

async function send(env: Env, to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!canSendEmail(env)) return false;
  try {
    await env.EMAIL!.send({ from: { email: env.EMAIL_FROM!.trim(), name: "noenv" }, to, subject, html, text });
    return true;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    console.error(`email "${subject}" to ${to} failed: ${code ?? "unknown"} ${message ?? ""}`);
    return false;
  }
}

function codeCopy({ to, code, host, purpose }: CodeEmail): Copy {
  if (purpose === "change_email") {
    return {
      subject: `${code} is your noenv email confirmation code`,
      preview: `Confirm this address for your noenv account on ${host}.`,
      heading: "Confirm your new email",
      body: `Enter this code in the noenv dashboard at ${host} to use this address for your account.`,
      action: "Confirmation code",
      reason: `You received this because someone signed in to ${host} asked to change their email to ${to}.`,
    };
  }
  if (purpose === "approve") {
    return {
      subject: `${code} is your noenv terminal approval code`,
      preview: `Use this code to approve a terminal sign-in on ${host}.`,
      heading: "Approve a terminal sign-in",
      body: `Enter this code in the noenv dashboard at ${host} to connect a terminal to your account. If you did not start a terminal sign-in, do not use the code.`,
      action: "Approval code",
      reason: `You received this because someone signed in as ${to} asked to approve a terminal.`,
    };
  }
  return {
    subject: `${code} is your noenv sign-in code`,
    preview: `Use this code to sign in to ${host}.`,
    heading: "Sign in to noenv",
    body: `Enter this code on the noenv sign-in page at ${host}.`,
    action: "Sign-in code",
    reason: `You received this because someone asked to sign in to ${host} as ${to}.`,
  };
}

function inviteCopy({ to, invitedBy }: InviteEmail, host: string): Copy {
  if (!invitedBy) {
    return {
      subject: "Finish setting up noenv",
      preview: "Create your admin passkey to start using noenv.",
      heading: "Finish setting up noenv",
      body: `Your noenv deployment at ${host} is ready. Create your admin passkey to sign in, then invite your team and connect your terminal.`,
      action: "Create admin passkey",
      reason: `You received this because ${to} is the admin email set when noenv was deployed at ${host}.`,
    };
  }
  return {
    subject: `${invitedBy} invited you to noenv`,
    preview: `Join your team's secrets on ${host}.`,
    heading: "Join your team on noenv",
    body: `${invitedBy} invited you to ${host}, where your team keeps its environment variables. Accept the invite to create a passkey, then connect your terminal.`,
    action: "Accept invite",
    reason: `You received this because ${invitedBy} invited ${to}.`,
  };
}

function renderText(copy: Copy, action: string, expiry: string): string {
  return `${copy.heading}

${copy.body}

${action}

${expiry}

${copy.reason} If you were not expecting it, you can ignore this email.

noenv · encrypted environment variables for your team`;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function linkAction(copy: Copy, link: string): string {
  const url = escapeHtml(link);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:8px;background:#0b0c0e;">
                  <a href="${url}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(copy.action)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">${LINK_EXPIRY}</p>
            <hr style="margin:28px 0 20px;border:0;border-top:1px solid #e4e4e7;">
            <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#71717a;">Button not working? Paste this link into your browser:</p>
            <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:#0b0c0e;">${url}</a></p>`;
}

function codeAction(code: string): string {
  return `<p style="margin:0;padding:16px 20px;border-radius:8px;background:#f4f4f5;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:28px;font-weight:700;letter-spacing:0.3em;color:#0b0c0e;text-align:center;">${escapeHtml(code)}</p>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">${CODE_EXPIRY}</p>`;
}

function renderHtml(copy: Copy, action: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 20px;font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0b0c0e;">
            <span style="display:inline-block;width:28px;height:28px;line-height:28px;margin-right:8px;border-radius:7px;background:#0b0c0e;color:#ffffff;font-size:15px;text-align:center;vertical-align:middle;">n</span><span style="vertical-align:middle;">noenv</span>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:36px 36px 32px;font-family:${FONT};">
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:650;letter-spacing:-0.02em;color:#0b0c0e;">${escapeHtml(copy.heading)}</h1>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3f3f46;">${escapeHtml(copy.body)}</p>
            ${action}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#a1a1aa;">
            ${escapeHtml(copy.reason)} If you were not expecting it, you can ignore this email.<br>
            noenv · encrypted environment variables for your team
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
