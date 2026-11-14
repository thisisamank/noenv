import { fromBase64, toBase64 } from "./encoding.ts";

export const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importPublicKey(text: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(text), ECDH, true, []);
}

export async function publicKeyOf(privateKey: CryptoKey): Promise<string> {
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", privateKey);
  return exportPublicKey(await crypto.subtle.importKey("jwk", { kty, crv, x, y }, ECDH, true, []));
}

export async function fingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64(publicKey)));
  return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("").replace(/(.{4})(?!$)/g, "$1-");
}

export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
}

export async function importPrivateKey(text: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromBase64(text), ECDH, true, ["deriveBits"]);
}
