import { hostname } from "node:os";
import { join } from "node:path";
import {
  exportPrivateKey,
  exportPublicKey,
  fingerprint,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  publicKeyOf,
  unwrapIdentityKey,
  wrapIdentityKey,
  type Sealed,
} from "@noenv/crypto";
import { api } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { readJsonFile, removeFile, writeJsonFile } from "./files.ts";

export type DeviceKey = {
  id: string;
  name: string;
  publicKey: string;
  ip: string | null;
  country: string | null;
  createdAt: string;
  approvedAt: string | null;
  status: "pending" | "approved";
  wrappedKey: Sealed | null;
};

type StoredDeviceKey = {
  publicKey: string;
  privateKey: string;
};

/** The status of a cached shell-hook entry when this device waits for another device to approve it. */
export const DEVICE_PENDING = 409;

/** Thrown on a new device until a device that has the account key approves it. */
export class DeviceApprovalPending extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`this device needs approval before it can read secrets: on a computer where noenv already works, run \`noenv device approve ${code}\``);
    this.code = code;
  }
}

/**
 * Gets this person's account key on a new device. The device registers its own key, and an
 * approved copy of the account key, encrypted to that device key, comes back from the server.
 * Returns the account private key, or throws DeviceApprovalPending.
 */
export async function receiveAccountKey(deployment: Deployment, token: string, accountPublicKey: string): Promise<CryptoKey> {
  const device = await loadOrCreateDeviceKey(deployment);
  const registered = await api<DeviceKey>(deployment, "POST", "/v1/me/devices", {
    token,
    body: { name: hostname().slice(0, 100), publicKey: device.publicKey },
  });
  if (registered.status !== "approved" || !registered.wrappedKey) {
    throw new DeviceApprovalPending(await fingerprint(device.publicKey));
  }

  const accountKey = await unwrapIdentityKey(registered.wrappedKey, await importPrivateKey(device.privateKey));
  if ((await publicKeyOf(accountKey)) !== accountPublicKey) {
    throw new Error("the key that this device received does not match your account key, ask an admin to check the deployment");
  }
  await removeFile(deviceKeyPath(deployment));
  return accountKey;
}

export async function listDeviceKeys(deployment: Deployment, token: string): Promise<DeviceKey[]> {
  return (await api<{ devices: DeviceKey[] }>(deployment, "GET", "/v1/me/devices", { token })).devices;
}

/**
 * Finds the waiting device whose key has the fingerprint `code`, and gives it a copy of the account
 * key. The person types the code that the new device shows, so a device that someone else
 * registered on this account cannot get the key.
 */
export async function approveDeviceKey(deployment: Deployment, token: string, accountKey: CryptoKey, code: string): Promise<DeviceKey> {
  const wanted = normalizeCode(code);
  const devices = await listDeviceKeys(deployment, token);
  const matches: DeviceKey[] = [];
  for (const device of devices) {
    if (device.status === "pending" && normalizeCode(await fingerprint(device.publicKey)) === wanted) matches.push(device);
  }
  const [device] = matches;
  if (!device) {
    throw new Error(`no device waits for approval with the code ${code}, check the code that the new device shows`);
  }

  const wrappedKey = await wrapIdentityKey(accountKey, await importPublicKey(device.publicKey));
  return api<DeviceKey>(deployment, "POST", `/v1/me/devices/${device.id}/approve`, { token, body: { wrappedKey } });
}

export async function removeDeviceKey(deployment: Deployment, token: string, id: string): Promise<void> {
  await api(deployment, "DELETE", `/v1/me/devices/${encodeURIComponent(id)}`, { token });
}

export function normalizeCode(code: string): string {
  return code.toLowerCase().replace(/[^0-9a-f]/g, "");
}

async function loadOrCreateDeviceKey(deployment: Deployment): Promise<StoredDeviceKey> {
  const stored = await readJsonFile<StoredDeviceKey>(deviceKeyPath(deployment));
  if (stored) return stored;

  const pair = await generateKeyPair();
  const created = { publicKey: await exportPublicKey(pair.publicKey), privateKey: await exportPrivateKey(pair.privateKey) };
  try {
    await writeJsonFile(deviceKeyPath(deployment), created, "wx");
    return created;
  } catch (error) {
    // Another terminal made the key at the same time; use that one.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readJsonFile<StoredDeviceKey>(deviceKeyPath(deployment)))!;
  }
}

function deviceKeyPath(deployment: Deployment): string {
  return join(deployment.dir, "device-key.json");
}
