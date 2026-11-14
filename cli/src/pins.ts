import { join } from "node:path";
import { fingerprint } from "@noenv/crypto";
import { ApiError } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { readJsonFile, writeJsonFile } from "./files.ts";

export type Pin = {
  projectId: string;
  publicKey: string;
};

type Pins = Record<string, Pin>;

export async function readPin(deployment: Deployment, repo: string, environment: string): Promise<Pin | null> {
  return (await readPins(deployment))[pinKey(repo, environment)] ?? null;
}

export async function writePin(deployment: Deployment, repo: string, environment: string, pin: Pin): Promise<void> {
  const pins = await readPins(deployment);
  pins[pinKey(repo, environment)] = { projectId: pin.projectId, publicKey: pin.publicKey };
  await writeJsonFile(pinsPath(deployment), pins);
}

export async function checkPin(deployment: Deployment, repo: string, environment: string, pin: Pin): Promise<void> {
  const known = await readPin(deployment, repo, environment);
  if (!known) {
    await writePin(deployment, repo, environment, pin);
    return;
  }
  if (known.projectId !== pin.projectId || known.publicKey !== pin.publicKey) {
    throw new ApiError(
      409,
      `the server sent a different project or key for ${repo} (${environment}) than before (${await fingerprint(known.publicKey)}, now ${await fingerprint(pin.publicKey)}). If an admin rotated the key, check the new fingerprint with them and run \`noenv trust\``,
    );
  }
}

async function readPins(deployment: Deployment): Promise<Pins> {
  return (await readJsonFile<Pins>(pinsPath(deployment))) ?? {};
}

function pinKey(repo: string, environment: string): string {
  return `${repo} ${environment}`;
}

function pinsPath(deployment: Deployment): string {
  return join(deployment.dir, "pins.json");
}
