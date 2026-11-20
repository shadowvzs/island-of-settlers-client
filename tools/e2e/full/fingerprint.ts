import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const EXCLUDED = new Set([".git", "node_modules", "dist", ".cache"]);
const filesIn = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(entry => !EXCLUDED.has(entry.name)).map(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesIn(path) : Promise.resolve([path]);
  }));
  return nested.flat().sort();
};
/** Hash working contents, including uncommitted changes; a commit ID alone is insufficient. */
export const fingerprint = async (root: string) => {
  const hash = createHash("sha256");
  const workers = process.env.WORKER_REPO ?? "../island-of-settlers-worker-generation";
  for (const tree of ["src", "assets", `${workers}/src`, `${workers}/game_ready`, "tools/e2e/full"]) {
    for (const file of await filesIn(resolve(root, tree))) {
      hash.update(relative(root, file)); hash.update("\0"); hash.update(await readFile(file));
    }
  }
  for (const file of ["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json"]) {
    hash.update(file); hash.update(await readFile(join(root, file)));
  }
  return hash.digest("hex");
};
