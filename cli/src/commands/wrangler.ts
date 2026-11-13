import { ENV_VAR_NAME } from "@noenv/config/names";
import { fetchBundle } from "../bundle.ts";
import { inProject } from "../context.ts";
import { checklist } from "../prompt.ts";
import { putWranglerSecrets, wranglerSource } from "../wrangler.ts";

export async function wranglerCommand(args: string[]): Promise<void> {
  const invalid = args.find((name) => !ENV_VAR_NAME.test(name));
  if (invalid) throw new Error(`usage: noenv wrangler [KEY...] (${invalid} is not a variable name)`);

  const { deployment, token, identity, target } = await inProject();
  const environment = wranglerSource(target);
  const label = `${target.repo} (${environment})`;
  const { secrets } = await fetchBundle(deployment, token, identity.privateKey, target.repo, environment);
  const names = Object.keys(secrets).sort();
  if (names.length === 0) throw new Error(`there are no secrets in ${label}`);

  const selected = await choose(args, names, target.wrangler.secrets, label);
  if (!selected) return console.log("Cancelled, nothing was pushed");
  if (selected.length === 0) return console.log("Nothing selected, nothing was pushed");

  const missing = selected.filter((name) => !(name in secrets));
  if (missing.length > 0) throw new Error(`${label} has no secret named ${missing.join(", ")}`);
  await putWranglerSecrets(target, Object.fromEntries(selected.map((name) => [name, secrets[name]!])));
}

async function choose(args: string[], names: string[], configured: string[], label: string): Promise<string[] | null> {
  if (args.length > 0) return args;
  if (process.stdin.isTTY && process.stderr.isTTY) {
    return checklist(`Push secrets from ${label} to Wrangler`, names, configured);
  }
  if (configured.length === 0) {
    throw new Error("pass the KEY names, or list them under [wrangler] secrets in .noenv");
  }
  return configured;
}
