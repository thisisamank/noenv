import { resolveDeployment, type Deployment } from "./deployment.ts";
import { ensureIdentity, type Identity } from "./identity.ts";
import { requireSession } from "./session.ts";
import { findTarget, requireTarget, type Target } from "./target.ts";

export type CommandContext = {
  deployment: Deployment;
  token: string;
  identity: Identity;
  target: Target;
};

export async function requireDeployment(projectUrl?: string): Promise<Deployment> {
  const deployment = await resolveDeployment(projectUrl);
  if (!deployment) {
    throw new Error("no noenv account is set up, run `noenv account add URL` or set NOENV_URL");
  }
  return deployment;
}

export async function currentDeployment(): Promise<Deployment> {
  return requireDeployment((await findTarget(process.cwd(), process.env).catch(() => null))?.deployment);
}

export async function signedIn(deployment?: Deployment): Promise<Omit<CommandContext, "target">> {
  deployment ??= await currentDeployment();
  const token = await requireSession(deployment);
  return { deployment, token, identity: await ensureIdentity(deployment, token) };
}

export async function inProject(): Promise<CommandContext> {
  const target = await requireTarget();
  return { ...(await signedIn(await requireDeployment(target.deployment))), target };
}
