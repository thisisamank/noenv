import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { useApp } from "../app-context.ts";
import { ErrorLine, useToast } from "../components/Feedback.tsx";
import { errorMessage, useResource } from "../use-resource.ts";

export function Account({ onChanged }: { onChanged: () => void }) {
  const { me } = useApp();
  const setup = useResource(() => api<{ email: boolean }>("GET", "/v1/setup"), []);

  return (
    <>
      <div className="head">
        <h1>Account</h1>
      </div>
      <section className="card" style={{ padding: 20, display: "grid", gap: 16, maxWidth: 480 }}>
        <div className="field">
          <span>Email</span>
          <b className="mono">{me.email}</b>
          <span className="help">Invites, sign-in codes and terminal approval codes go to this address.</span>
        </div>
        {setup.data?.email === false ? (
          <p className="muted small">This deployment cannot send email, so you cannot change your email here. Ask an admin to turn on email.</p>
        ) : (
          setup.data && <ChangeEmail onChanged={onChanged} />
        )}
      </section>
    </>
  );
}

function ChangeEmail({ onChanged }: { onChanged: () => void }) {
  const notify = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const send = (event: FormEvent) => (
    event.preventDefault(),
    run(async () => {
      await api("POST", "/v1/me/email", { email });
      setSentTo(email.trim().toLowerCase());
      setCode("");
    })
  );

  const confirm = (event: FormEvent) => (
    event.preventDefault(),
    run(async () => {
      const result = await api<{ email: string }>("POST", "/v1/me/email/confirm", { code });
      notify(`Your email is now ${result.email}`);
      setSentTo(undefined);
      setEmail("");
      onChanged();
    })
  );

  if (sentTo) {
    return (
      <form onSubmit={confirm} className="field">
        <span>Confirmation code</span>
        <input
          className="mono code-input"
          aria-label="Confirmation code"
          placeholder="000000"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          autoFocus
        />
        <span className="help">We sent a 6-digit code to {sentTo}. It expires in 10 minutes.</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={busy || code.length !== 6} aria-busy={busy}>
            Confirm new email
          </button>
          <button type="button" className="btn" onClick={() => setSentTo(undefined)} disabled={busy}>
            Cancel
          </button>
        </div>
        <ErrorLine message={error} />
      </form>
    );
  }

  return (
    <form onSubmit={send} className="field">
      <span>New email</span>
      <input type="email" placeholder="you@company.com" aria-label="New email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <span className="help">We send a code to the new address to confirm it. Your old address gets a notice after the change.</span>
      <div>
        <button className="btn" disabled={busy} aria-busy={busy}>
          Send code
        </button>
      </div>
      <ErrorLine message={error} />
    </form>
  );
}
