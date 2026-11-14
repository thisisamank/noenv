import { useState } from "react";
import { api } from "../api.ts";
import { AuthScreen } from "../components/AuthScreen.tsx";
import { ErrorLine } from "../components/Feedback.tsx";
import { timeAgo } from "../format.ts";
import { passkeyAssertion } from "../passkeys.ts";
import { href } from "../router.ts";
import { errorMessage } from "../use-resource.ts";

type PendingDevice = { deviceName: string | null; ip: string | null; country: string | null; createdAt: string | null };

export function Activate() {
  const [code, setCode] = useState("");
  const [device, setDevice] = useState<PendingDevice>();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<void>) {
    setState("busy");
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
      setState("idle");
    }
  }

  const lookUp = () =>
    run(async () => {
      setDevice(await api<PendingDevice>("POST", "/v1/auth/activate/device", { code }));
      setState("idle");
    });

  const approve = () =>
    run(async () => {
      await api("POST", "/v1/auth/activate", { code, response: await passkeyAssertion() });
      setState("done");
    });

  if (state === "done") {
    return (
      <AuthScreen title="Terminal connected">
        <p className="muted">Return to your terminal. Secrets load on the next prompt.</p>
        <a className="btn wide" href={href({ page: "overview" })}>
          Open dashboard
        </a>
      </AuthScreen>
    );
  }

  if (device) {
    return (
      <AuthScreen title="Is this your terminal?">
        <p className="muted">Approve only if you started this sign-in yourself, just now. Someone who sent you a code is trying to get into your account.</p>
        <dl className="device-facts">
          <dt>Device</dt>
          <dd className="mono">{device.deviceName ?? "unknown"}</dd>
          <dt>Network</dt>
          <dd className="mono">{[device.ip, device.country].filter(Boolean).join(" · ") || "unknown"}</dd>
          <dt>Started</dt>
          <dd>{device.createdAt ? timeAgo(device.createdAt) : "unknown"}</dd>
        </dl>
        <button className="btn primary wide" onClick={approve} disabled={state === "busy"} aria-busy={state === "busy"}>
          Approve with passkey
        </button>
        <button className="btn wide" onClick={() => setDevice(undefined)} disabled={state === "busy"}>
          This is not me
        </button>
        <ErrorLine message={error} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Approve terminal sign-in">
      <p className="muted">Type the code that your own terminal shows.</p>
      <input
        className="mono code-input"
        aria-label="Device code"
        placeholder="XXXX-XXXX"
        maxLength={9}
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
      />
      <button className="btn primary wide" onClick={lookUp} disabled={state === "busy" || code.length !== 9} aria-busy={state === "busy"}>
        Continue
      </button>
      <ErrorLine message={error} />
    </AuthScreen>
  );
}
