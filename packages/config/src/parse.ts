import { parse } from "smol-toml";
import { ConfigError } from "./errors.ts";
import { ENV_VAR_NAME, IDENTIFIER } from "./names.ts";

export type WranglerConfig = {
  secrets: string[];
  environment?: string;
  env?: string;
};

export type ProjectConfig = {
  deployment?: string;
  environment: string;
  requiredSecrets: string[];
  wrangler: WranglerConfig;
};

export const DEFAULT_CONFIG: ProjectConfig = {
  environment: "development",
  requiredSecrets: [],
  wrangler: { secrets: [] },
};

export function parseConfig(text: string): ProjectConfig {
  const raw = parse(text);

  if (raw.version !== 1) {
    throw new ConfigError("version must be 1");
  }

  const environment = raw.environment ?? DEFAULT_CONFIG.environment;
  if (typeof environment !== "string" || !IDENTIFIER.test(environment)) {
    throw new ConfigError('environment must contain only letters, digits, "_" or "-"');
  }

  const secrets = (raw.secrets ?? {}) as Record<string, unknown>;
  const required = secrets.required ?? [];
  if (!Array.isArray(required) || !required.every(isEnvVarName)) {
    throw new ConfigError("secrets.required must be a list of valid variable names");
  }

  const config: ProjectConfig = { environment, requiredSecrets: required, wrangler: parseWrangler(raw.wrangler) };
  if (raw.deployment !== undefined) config.deployment = parseDeployment(raw.deployment);
  return config;
}

function parseDeployment(value: unknown): string {
  const url = typeof value === "string" ? URL.parse(value) : null;
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new ConfigError("deployment must be the http or https URL of a noenv deployment");
  }
  return url.origin;
}

function parseWrangler(value: unknown): WranglerConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  const secrets = raw.secrets ?? [];
  if (!Array.isArray(secrets) || !secrets.every(isEnvVarName)) {
    throw new ConfigError("wrangler.secrets must be a list of valid variable names");
  }
  const config: WranglerConfig = { secrets };
  for (const key of ["environment", "env"] as const) {
    const field = raw[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || !IDENTIFIER.test(field)) {
      throw new ConfigError(`wrangler.${key} must contain only letters, digits, "_" or "-"`);
    }
    config[key] = field;
  }
  return config;
}

function isEnvVarName(value: unknown): value is string {
  return typeof value === "string" && ENV_VAR_NAME.test(value);
}
