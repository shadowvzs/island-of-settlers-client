/// <reference types="vitest/config" />
import { join, resolve } from "node:path";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig, type Plugin } from "vite";

import { SLOW_TEST_FILES } from "./tests/slow-test-files.ts";
import { catalogValidationPlugin } from "./tools/catalog-validation-plugin.ts";
import { cssPreloadLifecyclePlugin } from "./tools/css-preload-lifecycle-plugin.ts";
import { jsonImportAttributesPlugin } from "./tools/json-import-attributes-plugin.ts";
import { isDevOnlyPage, isLoopbackPeer, PRODUCTION_ENTRIES } from "./tools/page-entries.ts";
import { gameSourceFolders, sourceVersionPlugin } from "./tools/source-version-plugin.ts";
import { basisFolder, workerAssetsPlugin } from "./tools/worker-assets-plugin.ts";

/** Worker repository inside the game workspace; a separate worker worktree can be selected for isolated reviews. */
const WORKER_REPO = resolve(import.meta.dirname, process.env.WORKER_REPO ?? "../island-of-settlers-worker-generation");
/** The single content catalog (`@shared/catalog`, the same path as tsconfig.json). */
const SHARED_CATALOG = resolve(import.meta.dirname, "../island-of-settlers-shared/src/catalog/index.ts");
/** Computer faction build programs (`@shared/catalog/ai/<module>`): simulation data, loaded with the simulation. */
const SHARED_CATALOG_AI = resolve(import.meta.dirname, "../island-of-settlers-shared/src/catalog/ai");
/** Tuning sidecar modules (`@shared/catalog/tuning/<table>`): loaded with their consumers, never with the core. */
const SHARED_CATALOG_TUNING = resolve(import.meta.dirname, "../island-of-settlers-shared/src/catalog/tuning");
/** Balance tables and formulas (`@shared/catalog/balance`): economy data, loaded with the simulation chunk. */
const SHARED_CATALOG_BALANCE = resolve(import.meta.dirname, "../island-of-settlers-shared/src/catalog/balance/index.ts");
/** Building sidecar modules (`@shared/catalog/building-data/<table>`): simulation data, loaded with their consumers. */
const SHARED_CATALOG_BUILDING_DATA = resolve(import.meta.dirname,
  "../island-of-settlers-shared/src/catalog/building-data");
/** New heavy test files opt into the slow project by name (tests/slow-test-files.ts). */
const SLOW_TEST_PATTERN = "tests/**/*.slow.test.ts";

/** Dev-only pages are reachable only from a loopback socket, never a LAN client behind a spoofed Host. */
const devOnlyPageGuard = (): Plugin => ({
  name: "dev-only-page-guard",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!isDevOnlyPage(request.url) || isLoopbackPeer(request.socket.remoteAddress)) return next();
      response.statusCode = 404;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Not found");
    });
  }
});

export default defineConfig({
  base: "./",
  plugins: [
    devOnlyPageGuard(),
    catalogValidationPlugin(),
    cssPreloadLifecyclePlugin(),
    jsonImportAttributesPlugin(),
    lingui({ macroTransform: true }),
    workerAssetsPlugin({
      basis: basisFolder(import.meta.dirname),
      gameReady: join(WORKER_REPO, "game_ready")
    }),
    sourceVersionPlugin(gameSourceFolders(import.meta.dirname, WORKER_REPO))
  ],
  build: {
    // The release audit reads this to prove the player graph cannot reach admin/dev chunks.
    manifest: true,
    rollupOptions: {
      // Player, administrator page and the authenticated map editor ship; showcase/lab/icon pages stay
      // dev-server tools. Admin chunks are dynamic imports off the admin entry only.
      input: Object.fromEntries(Object.entries(PRODUCTION_ENTRIES)
        .map(([name, file]) => [name, resolve(import.meta.dirname, file)]))
    },
    target: "es2023"
  },
  // React windows load lazily; pre-bundle React up front so a late `react-dom` import in a lazy chunk
  // cannot make Vite re-optimise mid-session and load a second React copy (cold-cache dev failure).
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "@lingui/react"] },
  resolve: {
    // The sidecar prefixes come first: the first matching alias wins.
    alias: {
      "@shared/catalog/ai": SHARED_CATALOG_AI,
      "@shared/catalog/balance": SHARED_CATALOG_BALANCE,
      "@shared/catalog/building-data": SHARED_CATALOG_BUILDING_DATA,
      "@shared/catalog/tuning": SHARED_CATALOG_TUNING,
      "@shared/catalog": SHARED_CATALOG,
      "@workers": join(WORKER_REPO, "src")
    },
    // One copy of the engine: the generator's modules must share the game's three.
    dedupe: ["three"]
  },
  // Keep file watching for fresh modules on manual refresh, without interrupting the game.
  server: {
    // Dev/test surfaces exist only on this machine; LAN exposure needs an explicit `--host` override.
    fs: { allow: [import.meta.dirname, WORKER_REPO] },
    hmr: false,
    host: "127.0.0.1",
    watch: { ignored: ["**/.claude/**"] }
  },
  preview: { host: "127.0.0.1" },
  worker: { format: "es" },
  // TEST-01: `npm test` runs the fast `unit` project; `test:slow` the heavy files; `test:all` both.
  test: {
    environment: "node",
    // CAT8: the simulation reads every nation's building navigation sidecars (loaded before a game starts).
    // Critter GLBs (lazy-critters) and the hardwood tree payload (lazy-hardwood) are fetched per island at run
    // time; tests read them from disk.
    setupFiles: ["tests/setup/biome-grass-payload.ts", "tests/setup/building-navigation.ts",
      "tests/setup/critter-models.ts", "tests/setup/hardwood-mesh-payload.ts"],
    projects: [
      {
        extends: true,
        test: {
          exclude: [SLOW_TEST_PATTERN, ...SLOW_TEST_FILES],
          include: ["tests/**/*.test.ts"],
          // One module graph per worker: shares cached worlds across files (fixed leaks first).
          isolate: false,
          name: "unit",
          unstubEnvs: true,
          unstubGlobals: true
        }
      },
      {
        extends: true,
        test: {
          hookTimeout: 60_000,
          include: [SLOW_TEST_PATTERN, ...SLOW_TEST_FILES],
          name: "slow",
          testTimeout: 60_000
        }
      }
    ]
  }
});
