import { createHash } from "node:crypto";
import { join } from "node:path";
import { enforceDotenvPolicy } from "@noenv/dotenv";
import { ApiError } from "./api.ts";
import { fetchRawBundle, openBundle, type RawBundle } from "./bundle.ts";
import { describeOutcome, reportCompliance } from "./compliance.ts";
import type { Deployment } from "./deployment.ts";
import { readJsonFile, writeJsonFile } from "./files.ts";
import { DEVICE_PENDING, DeviceApprovalPending } from "./device-keys.ts";
import { ensureIdentity, loadIdentity } from "./identity.ts";
import { remoteSecretStore } from "./secret-store.ts";
import { clearSession, loadSession } from "./session.ts";
import type { Target } from "./target.ts";
import { markerPath, writeMarker } from "./watch.ts";

export type CacheEntry =
  | { raw: RawBundle; notes: string[]; blocked: boolean }
  | { error: string; status: number; checkedAt?: number };

export async function readCache(deployment: Deployment, target: Target): Promise<CacheEntry | null> {
  return readJsonFile<CacheEntry>(cachePath(deployment, target)).catch(() => null);
}

export async function refresh(deployment: Deployment, target: Target): Promise<CacheEntry | null> {
  const entry = await fetchEntry(deployment, target);
  if (!entry) return null;
  await writeJsonFile(cachePath(deployment, target), entry);
  await writeMarker(markerPath(deployment, target.repo, target.environment), `${"raw" in entry ? entry.raw.revision : "x"}:${Date.now()}`);
  return entry;
}

async function fetchEntry(deployment: Deployment, target: Target): Promise<CacheEntry | null> {
  try {
    const token = await loadSession(deployment);
    if (!token) return { error: "you are not signed in", status: 401 };

    const identity = (await loadIdentity(deployment)) ?? (await ensureIdentity(deployment, token));
    let raw = await fetchRawBundle(deployment, token, target.repo, target.environment);
    const bundle = await openBundle(raw, identity.privateKey, target.environment);

    const policy = bundle.policies.dotenv;
    const store = remoteSecretStore(deployment, token, identity, target.repo, target.environment, bundle);
    const result = await enforceDotenvPolicy(target.root, policy, store);
    const notes = result.files.map((file) => describeOutcome(target, file));
    if (result.files.length > 0) {
      await reportCompliance(deployment, token, target, result).catch(() => notes.push("could not report compliance"));
    }
    if (result.blocked) {
      notes.push(`secrets were not loaded: the "${policy.mode}" policy does not allow .env files, run \`noenv migrate\``);
    }
    if (result.files.some((file) => file.status === "deleted")) {
      raw = await fetchRawBundle(deployment, token, target.repo, target.environment);
    }
    return { raw, notes, blocked: result.blocked };
  } catch (error) {
    if (error instanceof DeviceApprovalPending) return { error: error.message, status: DEVICE_PENDING, checkedAt: Date.now() };
    if (!(error instanceof ApiError)) return null;
    if (error.status === 401) await clearSession(deployment);
    return { error: error.message, status: error.status };
  }
}

function cachePath(deployment: Deployment, target: Target): string {
  const name = createHash("sha256").update(`${target.repo}\0${target.environment}`).digest("hex").slice(0, 32);
  return join(deployment.dir, "bundles", `${name}.json`);
}
