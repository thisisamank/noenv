import { rename } from "node:fs/promises";
import { join } from "node:path";
import { exportPrivateKey, exportPublicKey, generateKeyPair, importPrivateKey } from "@noenv/crypto";
import { api } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { receiveAccountKey } from "./device-keys.ts";
import { readJsonFile, writeJsonFile } from "./files.ts";

export type Identity = {
  publicKey: string;
  privateKey: CryptoKey;
};

type StoredIdentity = {
  publicKey: string;
  privateKey: string;
};

type Me = {
  id: string;
  email: string;
  isAdmin: boolean;
  publicKey: string | null;
};

export async function loadIdentity(deployment: Deployment): Promise<Identity | null> {
  const stored = await readJsonFile<StoredIdentity>(identityPath(deployment));
  if (!stored) return null;
  return { publicKey: stored.publicKey, privateKey: await importPrivateKey(stored.privateKey) };
}

export async function ensureIdentity(deployment: Deployment, token: string): Promise<Identity> {
  const local = await loadIdentity(deployment);
  const me = await api<Me>(deployment, "GET", "/v1/me", { token });

  if (local && me.publicKey === local.publicKey) return local;
  if (me.publicKey) {
    return storeReceivedKey(deployment, me.publicKey, await receiveAccountKey(deployment, token, me.publicKey), local !== null);
  }

  const identity = local ?? (await createIdentity(deployment));
  await api(deployment, "PUT", "/v1/me/public-key", { token, body: { publicKey: identity.publicKey } });
  return identity;
}

/** Saves an account key that another device approved. An older key file on this device is kept beside it, not deleted. */
async function storeReceivedKey(deployment: Deployment, publicKey: string, privateKey: CryptoKey, replacing: boolean): Promise<Identity> {
  const path = identityPath(deployment);
  if (replacing) await rename(path, `${path}.replaced-${Date.now()}`);
  await writeJsonFile(path, { publicKey, privateKey: await exportPrivateKey(privateKey) }, "wx");
  return { publicKey, privateKey };
}

async function createIdentity(deployment: Deployment): Promise<Identity> {
  const pair = await generateKeyPair();
  const stored = {
    publicKey: await exportPublicKey(pair.publicKey),
    privateKey: await exportPrivateKey(pair.privateKey),
  };
  await writeJsonFile(identityPath(deployment), stored, "wx");
  return { publicKey: stored.publicKey, privateKey: pair.privateKey };
}

function identityPath(deployment: Deployment): string {
  return join(deployment.dir, "identity.json");
}
