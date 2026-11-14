import { isReservedName } from "@noenv/config/names";
import { decryptUnsigned, publicKeyOf, unwrapPrivateKey, verifySecret, type Sealed } from "@noenv/crypto";
import type { Policies } from "@noenv/policy";
import { api, environmentPath } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { checkPin } from "./pins.ts";

export type Bundle = {
  projectId: string;
  revision: number;
  policies: Policies;
  environmentPrivateKey: CryptoKey;
  secrets: Record<string, string>;
  reserved: string[];
  unsigned: string[];
};

export type RawBundle = {
  projectId: string;
  revision: number;
  policies: Policies;
  publicKey: string;
  wrappedKey: Sealed;
  secrets: { name: string; version: number; sealed: Sealed }[];
};

export async function fetchRawBundle(
  deployment: Deployment,
  token: string,
  repo: string,
  environment: string,
  { pin = true }: { pin?: boolean } = {},
): Promise<RawBundle> {
  const raw = await api<RawBundle>(deployment, "GET", `${environmentPath(repo, environment)}/bundle`, { token });
  if (pin) await checkPin(deployment, repo, environment, raw);
  return raw;
}

export async function openEnvironmentKey(raw: RawBundle, privateKey: CryptoKey): Promise<CryptoKey> {
  const environmentPrivateKey = await unwrapPrivateKey(raw.wrappedKey, privateKey);
  if ((await publicKeyOf(environmentPrivateKey)) !== raw.publicKey) {
    throw new Error("the server sent an environment public key that does not belong to the environment key");
  }
  return environmentPrivateKey;
}

export async function openBundle(raw: RawBundle, privateKey: CryptoKey, environment: string): Promise<Bundle> {
  const environmentPrivateKey = await openEnvironmentKey(raw, privateKey);

  const secrets: Record<string, string> = {};
  const reserved: string[] = [];
  const unsigned: string[] = [];
  for (const { name, sealed } of raw.secrets) {
    const context = { projectId: raw.projectId, environment, name };
    if (isReservedName(name)) {
      reserved.push(name);
    } else if (!(await verifySecret(environmentPrivateKey, sealed, context))) {
      unsigned.push(name);
    } else {
      secrets[name] = await decryptUnsigned(environmentPrivateKey, sealed, context);
    }
  }
  return { projectId: raw.projectId, revision: raw.revision, policies: raw.policies, environmentPrivateKey, secrets, reserved, unsigned };
}

export function describeSkipped(bundle: Bundle): string[] {
  const notes: string[] = [];
  if (bundle.reserved.length > 0) notes.push(`skipped reserved secret names: ${bundle.reserved.join(", ")}`);
  if (bundle.unsigned.length > 0) {
    notes.push(`skipped unsigned secrets: ${bundle.unsigned.join(", ")}. An editor can run \`noenv secret sign\` after checking them`);
  }
  return notes;
}

export async function fetchBundle(
  deployment: Deployment,
  token: string,
  privateKey: CryptoKey,
  repo: string,
  environment: string,
): Promise<Bundle> {
  return openBundle(await fetchRawBundle(deployment, token, repo, environment), privateKey, environment);
}
