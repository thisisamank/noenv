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

export async function requireDeployment(repo?: string): Promise<Deployment> {
  const found = repo ?? (await findTarget(process.cwd(), process.env).catch(() => null))?.repo ?? null;
  const deployment = await resolveDeployment(found);
  if (!deployment) {
    throw new Error("no noenv account is set up, run `noenv account add NAME URL` or set NOENV_URL");
  }
  return deployment;
}

export async function signedIn(repo?: string): Promise<Omit<CommandContext, "target">> {
  const deployment = await requireDeployment(repo);
  const token = await requireSession(deployment);
  return { deployment, token, identity: await ensureIdentity(deployment, token) };
}

export async function inProject(): Promise<CommandContext> {
  const target = await requireTarget();
  return { ...(await signedIn(target.repo)), target };
}
