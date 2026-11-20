import { mountAssetPaths, type MountManifest } from "../render-common/mounts/mount-assets";

interface WorkerEntry { animations: string; model: string; modelMinimal?: string; nation: string }
interface ArmourBody {
  animations: string; files: Record<string, string>; models: Record<string, string>;
  filesMinimal?: Record<string, string>; modelsMinimal?: Record<string, string>;
  layers?: Record<string, string>; layersMinimal?: Record<string, string>;
}
interface ArmourSet { bodies: ArmourBody[]; nation: string }

/** External KTX2 images in the GLB JSON chunk; embedded images need no further request. */
export const glbImageUris = (buffer: ArrayBuffer): string[] => {
  if (buffer.byteLength < 20) return [];
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(16, true) !== 0x4e4f534a) return [];
  const length = header.getUint32(12, true);
  if (length > buffer.byteLength - 20) return [];
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  return (json.images ?? []).flatMap((image: { uri?: string }) =>
    image.uri && !image.uri.startsWith("data:") ? [image.uri] : []);
};

/** Warm HTTP cache serially without constructing meshes or retaining their bytes. */
export const prefetchVoyageAssets = async (
  nation: string,
  detailed: boolean,
  current: () => boolean,
  enemyNation?: string
) => {
  const assetBase = new URL("./workers/", document.baseURI).href;
  const read = async (path: string) => {
    const response = await fetch(new URL(path, assetBase), { priority: "low" });
    if (!response.ok) throw new Error(`Voyage asset ${path}: ${response.status}`);
    return response;
  };
  const workers = await (await read("tripo/manifest.json")).json() as { workers: WorkerEntry[] };
  const armour = await (await read("armour/manifest.json")).json() as { sets: ArmourSet[] };
  const mounts = await (await read("mounts/manifest.json")).json() as MountManifest;
  const nations = new Set(enemyNation ? [nation, enemyNation] : [nation]);
  const paths = new Set<string>();
  const add = (path: string) => paths.add(new URL(path, assetBase).href);
  add("basis/basis_transcoder.js");
  add("basis/basis_transcoder.wasm");
  for (const worker of workers.workers.filter(worker => nations.has(worker.nation))) {
    add(`tripo/${!detailed ? worker.modelMinimal ?? worker.model : worker.model}`);
    add(`tripo/${worker.animations}`);
  }
  for (const set of armour.sets.filter(set => nations.has(set.nation))) for (const body of set.bodies) {
    add(new URL(body.animations, new URL("armour/", assetBase)).href);
    const models = detailed ? body.models : { ...body.models, ...body.modelsMinimal };
    const files = detailed ? body.files : { ...body.files, ...body.filesMinimal };
    const layers = detailed ? body.layers : { ...body.layers, ...body.layersMinimal };
    for (const file of [...Object.values(models), ...Object.values(files), ...Object.values(layers ?? {})])
      add(`armour/${file}`);
  }
  // Cavalry (adventure garrisons): horse, coat mask and the riders, at the active detail level.
  const mountBase = new URL("mounts/", assetBase);
  for (const path of mountAssetPaths(mounts, nations, detailed)) add(new URL(path, mountBase).href);
  let failed = false;
  for (const path of paths) {
    if (!current()) return false;
    try {
      const url = new URL(path, assetBase);
      const bytes = await (await read(path)).arrayBuffer();
      if (!path.endsWith(".glb")) continue;
      for (const uri of glbImageUris(bytes)) paths.add(new URL(uri, url).href);
    } catch (error) {
      failed = true;
      console.warn("Voyage asset warming failed", error);
    }
  }
  return !failed;
};
