import { readDotenvFile, removeIfUnchanged } from "./file.ts";
import { findDotenvFiles } from "./find.ts";
import type { SecretStore } from "./migrate.ts";
import type { DotenvPolicy } from "./policy.ts";

export type FileStatus = "found" | "invalid" | "conflict" | "unmigrated" | "failed" | "migrated" | "changed" | "deleted";

export type FileOutcome = {
  path: string;
  status: FileStatus;
  names: string[];
};

export type EnforcementResult = {
  blocked: boolean;
  files: FileOutcome[];
};

export async function enforceDotenvPolicy(
  root: string,
  policy: DotenvPolicy,
  store: SecretStore,
): Promise<EnforcementResult> {
  const paths = await findDotenvFiles(root, policy);

  if (policy.mode !== "delete") {
    const files = paths.map((path) => ({ path, status: "found" as const, names: [] }));
    return { blocked: policy.mode !== "warn" && files.length > 0, files };
  }

  const files: FileOutcome[] = [];
  for (const path of paths) {
    files.push(await deleteIfStored(path, store));
  }
  return { blocked: files.some((file) => file.status !== "deleted"), files };
}

async function deleteIfStored(path: string, store: SecretStore): Promise<FileOutcome> {
  try {
    const file = await readDotenvFile(path);
    if (file.invalidNames.length > 0) {
      return { path, status: "invalid", names: file.invalidNames };
    }

    const conflicts: string[] = [];
    const missing: string[] = [];
    for (const [name, value] of Object.entries(file.values)) {
      const stored = await store.get(name);
      if (stored === undefined) missing.push(name);
      else if (stored !== value) conflicts.push(name);
    }
    if (conflicts.length > 0) {
      return { path, status: "conflict", names: conflicts };
    }
    if (missing.length > 0) {
      return { path, status: "unmigrated", names: missing };
    }

    return { path, status: (await removeIfUnchanged(file)) ? "deleted" : "changed", names: [] };
  } catch {
    return { path, status: "failed", names: [] };
  }
}
