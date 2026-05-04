import { existsSync } from "node:fs";
import path from "node:path";

/** Resolve a repo-level file whether the CLI runs from `js/` or the repository root. */
export function resolveProjectFile(filename: string): string {
  const here = path.resolve(process.cwd(), filename);
  if (existsSync(here)) return here;
  const parent = path.resolve(process.cwd(), "..", filename);
  if (existsSync(parent)) return parent;
  return here;
}
