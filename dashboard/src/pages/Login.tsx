import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { AuthScreen } from "../components/AuthScreen.tsx";
import { ErrorLine, Loading } from "../components/Feedback.tsx";
import { requestSignInCode, setUpAdmin, signInWithEmailCode, signInWithPasskey } from "../passkeys.ts";
import { errorMessage, useResource } from "../use-resource.ts";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const setup = useResource(() => api<{ available: boolean; email: boolean; missingToken: boolean }>("GET", "/v1/setup"), []);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onSignedIn();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (setup.loading) {
    return (
      <AuthScreen title="noenv">
        <Loading />
      </AuthScreen>
    );
  }

  if (setup.data?.available && setup.data.email) {
    const send = async () => {
      setBusy(true);
      setError(undefined);
      try {
        await api("POST", "/v1/setup/email");
        setSent(true);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    };
    return (
      <AuthScreen title="Set up noenv">
        <p className="muted">
          {sent
            ? "Check your inbox. Open the link in the email to create your admin passkey."
            : "We'll email a setup link to the admin email you entered when you deployed."}
        </p>
        <button className="btn primary wide" onClick={send} disabled={busy} aria-busy={busy}>
          {sent ? "Send it again" : "Email me the setup link"}
        </button>
        <ErrorLine message={error} />
      </AuthScreen>
    );
  }

  if (setup.data?.missingToken) {
    return (
      <AuthScreen title="Set up noenv">
        <p className="muted">
          This deployment has no setup token. Add a <code>SETUP_TOKEN</code> secret of at least 16 random characters to the Worker, then reload this page.
        </p>
      </AuthScreen>
    );
  }

  if (setup.data?.available) {
    const submit = (event: FormEvent) => (event.preventDefault(), run(() => setUpAdmin(email, token)));
    return (
      <AuthScreen title="Set up noenv">
        <p className="muted">Use the admin email and the setup token you entered when you deployed.</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 12, width: "100%" }}>
          <input type="email" placeholder="you@company.com" aria-label="Admin email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
          <input type="password" placeholder="Setup token" aria-label="Setup token" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required />
          <button className="btn primary wide" disabled={busy} aria-busy={busy}>
            Create admin passkey
          </button>
        </form>
        <ErrorLine message={error} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Sign in to noenv">
      <button className="btn primary wide" onClick={() => run(signInWithPasskey)} disabled={busy} aria-busy={busy}>
        Sign in with passkey
      </button>
      <ErrorLine message={error} />
      {setup.data?.email && <EmailSignIn onSignedIn={onSignedIn} />}
      <p className="muted small">New here? Open the invite link an admin sent you.</p>
    </AuthScreen>
  );
}

function EmailSignIn({ onSignedIn }: { onSignedIn: () => void }) {
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

  const sendCode = (event: FormEvent) => (
    event.preventDefault(),
    run(async () => {
      await requestSignInCode(email);
      setSentTo(email);
      setCode("");
    })
  );

  const verify = (event: FormEvent) => (
    event.preventDefault(),
    run(async () => {
      await signInWithEmailCode(sentTo!, code);
      onSignedIn();
    })
  );

  if (sentTo) {
    return (
      <form onSubmit={verify} style={{ display: "grid", gap: 12, width: "100%" }}>
        <p className="muted small">If {sentTo} has a noenv account, a 6-digit code is on its way. It expires in 10 minutes.</p>
        <input
          className="mono code-input"
          aria-label="Sign-in code"
          placeholder="000000"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          autoFocus
        />
        <button className="btn primary wide" disabled={busy || code.length !== 6} aria-busy={busy}>
          Sign in
        </button>
        <button type="button" className="btn wide" onClick={() => setSentTo(undefined)} disabled={busy}>
          Use a different email
        </button>
        <ErrorLine message={error} />
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} style={{ display: "grid", gap: 12, width: "100%" }}>
      <p className="muted small">No passkey on this device? Get a sign-in code by email.</p>
      <input type="email" placeholder="you@company.com" aria-label="Email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <button className="btn wide" disabled={busy} aria-busy={busy}>
        Email me a code
      </button>
      <ErrorLine message={error} />
    </form>
  );
}
