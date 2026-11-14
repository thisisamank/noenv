import { openWith, sealTo, type Sealed } from "./box.ts";
import { fromBase64, fromBytes, toBase64, toBytes } from "./encoding.ts";
import { importPublicKey, publicKeyOf } from "./keys.ts";

export type SecretContext = {
  projectId: string;
  environment: string;
  name: string;
};

const MAC_INFO = toBytes("noenv-secret-mac-v1");

export async function encryptSecret(
  environmentPrivateKey: CryptoKey,
  value: string,
  context: SecretContext,
): Promise<Sealed> {
  const publicKey = await importPublicKey(await publicKeyOf(environmentPrivateKey));
  const sealed = await sealTo(publicKey, toBytes(value), contextBytes(context));
  const signature = await crypto.subtle.sign("HMAC", await macKey(environmentPrivateKey), macInput(sealed, context));
  return { ...sealed, mac: toBase64(new Uint8Array(signature)) };
}

export async function decryptSecret(
  environmentPrivateKey: CryptoKey,
  sealed: Sealed,
  context: SecretContext,
): Promise<string> {
  if (!(await verifySecret(environmentPrivateKey, sealed, context))) {
    throw new Error("the secret has no valid signature from a holder of the environment key");
  }
  return decryptUnsigned(environmentPrivateKey, sealed, context);
}

export async function decryptUnsigned(
  environmentPrivateKey: CryptoKey,
  sealed: Sealed,
  context: SecretContext,
): Promise<string> {
  return fromBytes(await openWith(environmentPrivateKey, sealed, contextBytes(context)));
}

export async function verifySecret(environmentPrivateKey: CryptoKey, sealed: Sealed, context: SecretContext): Promise<boolean> {
  if (typeof sealed.mac !== "string") return false;
  try {
    return await crypto.subtle.verify("HMAC", await macKey(environmentPrivateKey), fromBase64(sealed.mac), macInput(sealed, context));
  } catch {
    return false;
  }
}

async function macKey(environmentPrivateKey: CryptoKey): Promise<CryptoKey> {
  const { d } = await crypto.subtle.exportKey("jwk", environmentPrivateKey);
  const scalar = fromBase64(d!.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (d!.length % 4)) % 4));
  const material = await crypto.subtle.importKey("raw", scalar, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: MAC_INFO },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

function macInput({ ephemeralPublicKey, iv, ciphertext }: Sealed, { projectId, environment, name }: SecretContext): Uint8Array<ArrayBuffer> {
  return toBytes(`noenv-secret-mac-v1\0${projectId}\0${environment}\0${name}\0${ephemeralPublicKey}\0${iv}\0${ciphertext}`);
}

function contextBytes({ projectId, environment, name }: SecretContext): Uint8Array<ArrayBuffer> {
  return toBytes(`noenv-secret-v1\0${projectId}\0${environment}\0${name}`);
}
