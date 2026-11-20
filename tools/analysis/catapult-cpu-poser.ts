import { registerHooks } from "node:module";

/** Renderer asset URLs stay inert during CPU rig analysis; native posing code is unchanged. */
export const loadCatapultCpuPoser = async () => {
  const hooks = registerHooks({ load(url, context, next) {
    if (url.endsWith("/render-common/workers/worker-assets.ts"))
      return { format: "module", shortCircuit: true, source: 'export const WORKER_ASSET_BASE = "http://cpu-audit.invalid/workers/";' };
    if (/\.(png|jpe?g|webp|svg|glb|ktx2|ogg|woff2?)(\?|$)/.test(url))
      return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
    const loaded = next(url, context);
    if (typeof loaded.source === "string" && loaded.source.includes("import.meta.glob"))
      return { ...loaded, source: loaded.source.replaceAll("import.meta.glob", "(() => ({}))") };
    return loaded;
  } });
  try {
    return { ...await import("../../src/renderers/three/three-worker"), restore: () => hooks.deregister() };
  } catch (error) { hooks.deregister(); throw error; }
};
