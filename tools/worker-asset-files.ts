import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

interface GltfResources {
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}
/** C04 authored levels of detail (`lods` in both manifests); `model` is relative to the manifest. */
interface LodRecord { model: string }
interface TripoManifest {
  props: Record<string, string>;
  fisherBoatActions?: string;
  workers: (Record<string, unknown> & { lods?: LodRecord[] })[];
}
interface ArmourManifest {
  sets: { bodies: (Record<string, unknown> & { lods?: Record<string, LodRecord[]> })[] }[];
}
interface MountManifest {
  horse: { coat: { mask: string }; model: string };
  riders: { animations: string; model: string }[];
}

const readJson = (folder: string, file: string): unknown =>
  JSON.parse(readFileSync(join(folder, file), "utf8"));

const assetPath = (base: string, uri: string) => {
  const decoded = decodeURIComponent(uri);
  const file = posix.normalize(posix.join(base, decoded));
  if (posix.isAbsolute(decoded) || /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    file === ".." || file.startsWith("../")) {
    throw new Error(`Worker asset escapes its game_ready root: ${uri}`);
  }
  return file;
};

const linkedResources = (folder: string, file: string): GltfResources | undefined => {
  if (file.endsWith(".gltf")) return readJson(folder, file) as GltfResources;
  if (!file.endsWith(".glb")) return;
  const bytes = readFileSync(join(folder, file));
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Invalid worker GLB: ${file}`);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")) as GltfResources;
};

const tripoFiles = (folder: string) => {
  const manifest = readJson(folder, "tripo/manifest.json") as TripoManifest;
  const keys = ["model", "modelMinimal", "neutralBody", "animations", "animationOverrides"];
  return ["tripo/manifest.json", ...manifest.workers.flatMap(worker => [
    ...keys.flatMap(key => typeof worker[key] === "string" ? [assetPath("tripo", worker[key])] : []),
    ...(manifest.fisherBoatActions && typeof worker.variant === "string"
      ? [assetPath("tripo", `${manifest.fisherBoatActions}${worker.variant}.glb`)] : []),
    ...(worker.lods ?? []).map(lod => assetPath("tripo", lod.model))]),
  ...Object.values(manifest.props).map(file => assetPath("tripo", file))];
};

const armourFiles = (folder: string) => {
  const manifest = readJson(folder, "armour/manifest.json") as ArmourManifest;
  const keys = ["models", "files", "modelsMinimal", "filesMinimal", "layers", "layersMinimal"];
  return ["armour/manifest.json", ...manifest.sets.flatMap(set => set.bodies.flatMap(body => {
    const files = keys.flatMap(key => Object.values(body[key] as Record<string, string> ?? {}));
    const lods = Object.values(body.lods ?? {}).flat().map(lod => lod.model);
    return [...files, ...lods].map(file => assetPath("armour", file));
  }))];
};

const mountFiles = (folder: string) => {
  const manifest = readJson(folder, "mounts/manifest.json") as MountManifest;
  return ["mounts/manifest.json", ...[manifest.horse.model, manifest.horse.coat.mask,
    ...manifest.riders.flatMap(rider => [rider.model, rider.animations])]
    .map(file => assetPath("mounts", file))];
};

/** The authoritative shipped worker files; private pilots and old unreferenced exports stay out. */
export const workerAssetFiles = (folder: string): string[] => {
  const files = new Set<string>();
  const pending = [...tripoFiles(folder), ...armourFiles(folder), ...mountFiles(folder)];
  while (pending.length) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const resources = linkedResources(folder, file);
    for (const resource of [...resources?.buffers ?? [], ...resources?.images ?? []]) {
      if (!resource.uri || resource.uri.startsWith("data:")) continue;
      pending.push(assetPath(posix.dirname(file), resource.uri));
    }
  }
  return [...files].sort();
};
