import { resolve } from "node:path";
import { build, type Metafile } from "esbuild";

/** Client package root: the bundle's input paths are relative to it. */
export const CLIENT_ROOT = resolve(import.meta.dirname, "../..");

let graph: Promise<Metafile> | null = null;

/** The module graph of the server's game bundle (`server-bundle.ts`), built once per test worker. */
export const serverBundleGraph = () => graph ??= build({
  absWorkingDir: CLIENT_ROOT, bundle: true, entryPoints: ["src/app/settlement/server-bundle.ts"], format: "esm",
  logLevel: "silent", metafile: true, platform: "node", write: false
}).then(result => result.metafile);
