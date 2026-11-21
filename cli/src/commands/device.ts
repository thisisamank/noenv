import { fingerprint } from "@noenv/crypto";
import { signedIn } from "../context.ts";
import { approveDeviceKey, listDeviceKeys, removeDeviceKey } from "../device-keys.ts";

const USAGE = "usage: noenv device list | approve CODE | remove ID";

export async function deviceCommand([action, ...args]: string[]): Promise<void> {
  if (action === "list" && args.length === 0) return list();
  if (action === "approve" && args.length === 1) return approve(args[0]!);
  if (action === "remove" && args.length === 1) return remove(args[0]!);
  throw new Error(USAGE);
}

async function list(): Promise<void> {
  const { deployment, token } = await signedIn();
  const devices = await listDeviceKeys(deployment, token);
  if (devices.length === 0) {
    console.log("No other devices. A new computer shows a code to approve here after you sign in on it.");
    return;
  }
  for (const device of devices) {
    const where = [device.ip, device.country].filter(Boolean).join(" ");
    const state = device.status === "approved" ? `approved ${device.approvedAt}` : `waiting, code ${await fingerprint(device.publicKey)}`;
    console.log(`${device.id}  ${device.name}  ${where || "unknown network"}  added ${device.createdAt}  ${state}`);
  }
}

async function approve(code: string): Promise<void> {
  const { deployment, token, identity } = await signedIn();
  const device = await approveDeviceKey(deployment, token, identity.privateKey, code);
  const where = [device.ip, device.country].filter(Boolean).join(" ");
  console.log(`Approved ${device.name}${where ? ` (${where})` : ""}. It loads secrets at its next prompt.`);
}

async function remove(id: string): Promise<void> {
  const { deployment, token } = await signedIn();
  await removeDeviceKey(deployment, token, id);
  console.log(`Removed ${id}. It cannot get your key again. If the device is lost, ask an admin to reset your key and rotate your environments, because the device still has a copy.`);
}
