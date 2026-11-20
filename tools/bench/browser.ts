import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, firefox, webkit } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";

import { getChromeLaunchOptions } from "./chrome";

export const launchBrowser = (uncapped = false): Promise<Browser> =>
  chromium.launch(getChromeLaunchOptions(uncapped));

/** The JavaScript engines of the cross-browser checks: V8 (Chrome), SpiderMonkey (Firefox), JavaScriptCore. */
export type BrowserEngine = "chromium" | "firefox" | "webkit";

/**
 * A headless browser of `engine`: the system Chrome, or Playwright's Firefox / WebKit builds
 * (`npx playwright install firefox webkit`; hosts Playwright does not list may need
 * PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 and the libraries it names).
 */
export const launchEngine = (engine: BrowserEngine): Promise<Browser> => {
  if (engine === "chromium") return launchBrowser();
  return (engine === "firefox" ? firefox : webkit).launch({ headless: true });
};

const UNLOCK_ALL_ENV = "VITE_UNLOCK_ALL_BUILDINGS";

/** Sets `values` in process.env while `create` runs (Vite reads VITE_* when the server is created). */
const withEnv = async <T>(values: Record<string, string>, create: () => Promise<T>) => {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await create();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

interface DevServerOptions {
  /** Extra VITE_* build values (e.g. the local backend's URLs for online reviews). */
  env?: Record<string, string>;
  /** Fixed origin (the local backend allows only its configured CORS origins). */
  host?: string;
  port?: number;
  unlockAll?: boolean;
  /** Explicit retained optimizer cache for a benchmark; default is one temporary cache per server. */
  cacheDir?: string;
}

/**
 * A dev server for the bench tools. Every building is placeable whatever the player's level
 * (tools place level-locked buildings); `unlockAll: false` or ?unlockall=0 keeps the level gate.
 */
export const startDevServer = async (
  { cacheDir, env = {}, host, port, unlockAll = true }: DevServerOptions = {}
): Promise<{ server: ViteDevServer; url: string }> => {
  const values = { ...env, [UNLOCK_ALL_ENV]: unlockAll ? "1" : "0" };
  const temporaryCache = cacheDir ? undefined : await mkdtemp(join(tmpdir(), "island-bench-vite-"));
  let server: ViteDevServer;
  try {
    server = await withEnv(values, () => createServer({
      cacheDir: cacheDir ?? temporaryCache,
      logLevel: "error",
      server: { host, port: port ?? 5199, strictPort: port !== undefined }
    }));
  } catch (error) {
    if (temporaryCache) await rm(temporaryCache, { force: true, recursive: true });
    throw error;
  }
  const close = server.close.bind(server);
  let closing: Promise<void> | undefined;
  server.close = () => closing ??= (async () => {
    try { await close(); }
    finally { if (temporaryCache) await rm(temporaryCache, { force: true, recursive: true }); }
  })();
  try {
    await server.listen();
    // Settle startup work already queued by Vite; each caller can warm its own actual entry.
    await server.waitForRequestsIdle();
  } catch (error) {
    await server.close();
    throw error;
  }
  const url = server.resolvedUrls?.local[0] ?? `http://${host ?? "localhost"}:${port ?? 5199}/`;
  return { server, url };
};
