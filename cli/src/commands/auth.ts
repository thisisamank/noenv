import { fingerprint } from "@noenv/crypto";
import { api, environmentPath } from "../api.ts";
import { currentDeployment, requireDeployment } from "../context.ts";
import { deploymentAt, namedDeployment, type Deployment } from "../deployment.ts";
import { loadSession, openBrowser, readPendingSignIn, startSignIn, waitForSignIn } from "../session.ts";
import { findTarget } from "../target.ts";

type Me = { email: string; isAdmin: boolean; publicKey: string | null };

export async function authCommand(args: string[]): Promise<void> {
  if (args[0] === "--wait") {
    const deployment = args[1] ? deploymentAt(args[1]) : await currentDeployment();
    const pending = await readPendingSignIn(deployment);
    if (pending) await waitForSignIn(deployment, pending);
    return;
  }

  const deployment = args[0] ? await namedDeployment(args[0]) : await currentDeployment();
  const { pending, started } = await startSignIn(deployment);
  console.log(`Open ${pending.url} and enter the code ${pending.userCode}`);
  if (started) openBrowser(pending.url);

  if (!(await waitForSignIn(deployment, pending))) {
    throw new Error("sign-in was not completed");
  }
  const me = await api<Me>(deployment, "GET", "/v1/me", { token: (await loadSession(deployment))! });
  console.log(`Signed in to ${label(deployment)} as ${me.email}`);
}

export async function statusCommand(): Promise<void> {
  const target = await findTarget(process.cwd(), process.env);
  const deployment = await requireDeployment(target?.deployment);
  if (deployment.account) console.log(`Account:     ${deployment.account}${target?.deployment ? " (matches the deployment in .noenv)" : ""}`);
  console.log(`Deployment:  ${deployment.url}`);

  const token = await loadSession(deployment);
  if (!token) {
    console.log("Signed in:   no");
    return;
  }
  const me = await api<Me>(deployment, "GET", "/v1/me", { token });
  console.log(`Signed in:   ${me.email}${me.isAdmin ? " (organization admin)" : ""}`);
  console.log(`Your key:    ${me.publicKey ? await fingerprint(me.publicKey) : "not registered yet"}`);

  if (!target) {
    console.log("Project:     none (not in a git repository with an origin)");
    return;
  }
  console.log(`Project:     ${target.repo}`);
  console.log(`Environment: ${target.environment}`);

  try {
    const path = `${environmentPath(target.repo, target.environment)}/secrets`;
    const { secrets } = await api<{ secrets: unknown[] }>(deployment, "GET", path, { token });
    console.log(`Secrets:     ${secrets.length}`);
  } catch {
    console.log("Secrets:     no access");
  }
}

function label(deployment: Deployment): string {
  return deployment.account ?? deployment.url;
}
