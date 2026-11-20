import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { KnipConfig } from "knip";

/** Browser-side tool code imports game modules by URL string (`"/src/…"`), which knip cannot follow. */
const BROWSER_IMPORT = /"\/(src\/[^"]+\.tsx?)"/g;

const listSources = (folder: string): string[] => readdirSync(folder, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(ts|mts|tsx)$/.test(entry.name))
  .map(entry => join(entry.parentPath, entry.name));

/** Workers start from `new Worker(new URL("…", import.meta.url))`; only workers the code starts count. */
const WORKER_URL = /new URL\("([^"]+\.ts)", import\.meta\.url\)/g;

const startedWorkers = () => {
  const workers = new Set<string>();
  for (const file of listSources("src")) {
    for (const match of readFileSync(file, "utf8").matchAll(WORKER_URL)) {
      workers.add(relative(".", resolve(dirname(file), match[1]!)));
    }
  }
  return [...workers];
};

const browserLoadedModules = () => {
  const modules = new Set<string>();
  for (const file of [...listSources("tools"), ...listSources("tests-ui")]) {
    for (const match of readFileSync(file, "utf8").matchAll(BROWSER_IMPORT)) modules.add(match[1]!);
  }
  return [...modules];
};

const config: KnipConfig = {
  entry: [
    // Dev-server pages (asset pipelines and reviews); not part of the build.
    "src/{animal-showcase,building-showcase,editor-icons}/main.ts",
    "src/campaign-ui-review/main.tsx",
    // Owner-facing index of the balance settings (docs/code-map.md).
    "src/shared/balance/index.ts",
    // The api's game bundle (tools/server/build-verifier.ts).
    "src/app/settlement/server-bundle.ts",
    "tools/**/*.{ts,mts}",
    "tests/**/*.test.ts",
    "tests-ui/**/*.spec.ts",
    ...browserLoadedModules(),
    ...startedWorkers()
  ],
  // `adb` drives the physical-phone benchmark; mount-lods borrows ../island-of-settlers-worker-generation's glTF tooling by path.
  ignoreBinaries: ["adb"],
  ignoreDependencies: [/^@gltf-transform\//, "meshoptimizer"],
  project: ["src/**/*.{ts,tsx}", "tools/**/*.{ts,mts}", "tests/**/*.ts", "tests-ui/**/*.ts"],
  // Duplicates are deliberate named aliases (e.g. ROAD_RESERVED_WIDTH = ROAD_STONE_WIDTH).
  rules: { duplicates: "warn" }
};

export default config;
