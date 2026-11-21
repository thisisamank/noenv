import { openWith, sealTo, type Sealed } from "./box.ts";
import { toBytes } from "./encoding.ts";
import { ECDH } from "./keys.ts";

const WRAP_CONTEXT = toBytes("noenv-key-wrap-v1");

export async function wrapPrivateKey(privateKey: CryptoKey, recipientPublicKey: CryptoKey): Promise<Sealed> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
  return sealTo(recipientPublicKey, pkcs8, WRAP_CONTEXT);
}

export async function unwrapPrivateKey(wrapped: Sealed, recipientPrivateKey: CryptoKey): Promise<CryptoKey> {
  const pkcs8 = await openWith(recipientPrivateKey, wrapped, WRAP_CONTEXT);
  return crypto.subtle.importKey("pkcs8", pkcs8, ECDH, true, ["deriveBits"]);
}

const IDENTITY_WRAP_CONTEXT = toBytes("noenv-identity-wrap-v1");

/** Encrypts a person's account key to the key of one of their devices. A separate context keeps it apart from wrapped environment keys. */
export async function wrapIdentityKey(privateKey: CryptoKey, devicePublicKey: CryptoKey): Promise<Sealed> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
  return sealTo(devicePublicKey, pkcs8, IDENTITY_WRAP_CONTEXT);
}

export async function unwrapIdentityKey(wrapped: Sealed, devicePrivateKey: CryptoKey): Promise<CryptoKey> {
  const pkcs8 = await openWith(devicePrivateKey, wrapped, IDENTITY_WRAP_CONTEXT);
  return crypto.subtle.importKey("pkcs8", pkcs8, ECDH, true, ["deriveBits"]);
}
