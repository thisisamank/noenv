import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Context, UserContext } from "./context.ts";
import { approveUserCode, findPendingDevice, USER_CODE } from "./device.ts";
import { HttpError, json, readJson } from "./http.ts";
import { verifyPasskey } from "./passkeys.ts";

export async function redirectToActivation({ request }: Context): Promise<Response> {
  return Response.redirect(new URL("/dashboard/#/activate", request.url).toString(), 302);
}

export async function describeDevice({ request, env }: UserContext): Promise<Response> {
  const userCode = parseCode((await readJson(request)).code);
  const device = await findPendingDevice(env.DB, userCode);
  if (!device) {
    throw new HttpError(404, "this code is invalid, expired, or already used");
  }
  return json(device);
}

export async function approveDevice({ request, env, userId }: UserContext): Promise<Response> {
  const { code, response } = await readJson(request);
  const userCode = parseCode(code);
  const passkeyUser = await verifyPasskey(request, env, response as AuthenticationResponseJSON | undefined);
  if (passkeyUser !== userId) {
    throw new HttpError(403, "confirm with a passkey of the signed-in account");
  }
  if (!(await approveUserCode(env.DB, userCode, userId))) {
    throw new HttpError(400, "this code is invalid, expired, or already used");
  }
  return json({ approved: true });
}

function parseCode(code: unknown): string {
  const userCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!USER_CODE.test(userCode)) {
    throw new HttpError(400, "the code must look like XXXX-XXXX");
  }
  return userCode;
}
