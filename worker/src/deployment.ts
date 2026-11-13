import type { Context } from "./context.ts";
import { json } from "./http.ts";

export async function deploymentInfo({ request, env }: Context): Promise<Response> {
  return json({ name: env.TEAM_NAME?.trim() || nameFromHost(new URL(request.url).hostname) });
}

export function nameFromHost(host: string): string {
  const labels = host.split(".");
  if (host.endsWith(".workers.dev") && labels.length >= 4) return labels.at(-3)!;
  return labels.length >= 2 ? labels.at(-2)! : host;
}
