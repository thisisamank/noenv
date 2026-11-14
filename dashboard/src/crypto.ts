import { exportPublicKey, generateKeyPair, importPublicKey, wrapPrivateKey, type Sealed } from "@noenv/crypto";

export async function createEnvironmentKeys(ownerPublicKey: string): Promise<{ publicKey: string; wrappedKey: Sealed }> {
  const keys = await generateKeyPair();
  return {
    publicKey: await exportPublicKey(keys.publicKey),
    wrappedKey: await wrapPrivateKey(keys.privateKey, await importPublicKey(ownerPublicKey)),
  };
}
