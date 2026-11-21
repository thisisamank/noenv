import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  decryptUnsigned,
  fingerprint,
  publicKeyOf,
  encryptSecret,
  exportPrivateKey,
  exportPublicKey,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  unwrapIdentityKey,
  unwrapPrivateKey,
  wrapIdentityKey,
  wrapPrivateKey,
} from "@noenv/crypto";

const context = { projectId: "prj_123", environment: "development", name: "API_KEY" };

test("only a holder of the environment private key can write a secret that decrypts", async () => {
  const environment = await generateKeyPair();

  const sealed = await encryptSecret(environment.privateKey, "s3cret", context);
  assert.ok(!sealed.ciphertext.includes("s3cret"));
  assert.equal(await decryptSecret(environment.privateKey, sealed, context), "s3cret");

  const stranger = await generateKeyPair();
  await assert.rejects(decryptSecret(stranger.privateKey, sealed, context));
});

test("rejects a secret sealed to the public key without the MAC, as a server could forge it", async () => {
  const environment = await generateKeyPair();
  const forger = await encryptSecret((await generateKeyPair()).privateKey, "evil", context);
  const sealed = await encryptSecret(environment.privateKey, "s3cret", context);
  const { mac: _mac, ...unsigned } = sealed;

  await assert.rejects(decryptSecret(environment.privateKey, unsigned, context), /no valid signature/);
  await assert.rejects(decryptSecret(environment.privateKey, { ...sealed, mac: forger.mac }, context), /no valid signature/);
  assert.equal(await decryptUnsigned(environment.privateKey, unsigned, context), "s3cret");
});

test("derives the public key and a stable fingerprint from the private key", async () => {
  const environment = await generateKeyPair();
  const publicKey = await exportPublicKey(environment.publicKey);
  assert.equal(await publicKeyOf(environment.privateKey), publicKey);
  assert.match(await fingerprint(publicKey), /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
});

test("rejects a ciphertext moved to another secret name", async () => {
  const environment = await generateKeyPair();
  const sealed = await encryptSecret(environment.privateKey, "s3cret", context);

  await assert.rejects(decryptSecret(environment.privateKey, sealed, { ...context, name: "OTHER" }));
});

test("rejects a tampered ciphertext", async () => {
  const environment = await generateKeyPair();
  const sealed = await encryptSecret(environment.privateKey, "s3cret", context);
  const tampered = { ...sealed, ciphertext: sealed.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A")) };

  await assert.rejects(decryptSecret(environment.privateKey, tampered, context));
});

test("shares an environment private key with a user through their public key", async () => {
  const user = await generateKeyPair();
  const userPublicKey = await importPublicKey(await exportPublicKey(user.publicKey));
  const userPrivateKey = await importPrivateKey(await exportPrivateKey(user.privateKey));

  const environment = await generateKeyPair();
  const sealed = await encryptSecret(environment.privateKey, "s3cret", context);
  const wrapped = await wrapPrivateKey(environment.privateKey, userPublicKey);

  const unwrapped = await unwrapPrivateKey(wrapped, userPrivateKey);
  assert.equal(await decryptSecret(unwrapped, sealed, context), "s3cret");
});

test("another user cannot unwrap the key", async () => {
  const owner = await generateKeyPair();
  const stranger = await generateKeyPair();
  const wrapped = await wrapPrivateKey((await generateKeyPair()).privateKey, owner.publicKey);

  await assert.rejects(unwrapPrivateKey(wrapped, stranger.privateKey));
});

test("a wrapped key cannot be used as a secret ciphertext", async () => {
  const user = await generateKeyPair();
  const wrapped = await wrapPrivateKey((await generateKeyPair()).privateKey, user.publicKey);

  await assert.rejects(decryptSecret(user.privateKey, wrapped, context));
});

test("an account key copied to a device cannot be read as an environment key", async () => {
  const device = await generateKeyPair();
  const account = await generateKeyPair();
  const wrapped = await wrapIdentityKey(account.privateKey, device.publicKey);

  await assert.rejects(unwrapPrivateKey(wrapped, device.privateKey));
  const unwrapped = await unwrapIdentityKey(wrapped, device.privateKey);
  assert.equal(await publicKeyOf(unwrapped), await exportPublicKey(account.publicKey));
});
