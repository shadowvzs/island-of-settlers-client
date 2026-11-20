import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { extname, join, posix, resolve } from "node:path";

/**
 * KTX2 reachability audit for the worker generator's `game_ready/`.
 *
 * The game build copies only manifest/GLB-reachable files. This tool reports the other side:
 * which KTX2 textures actually ship, which files in `game_ready/` are unreferenced, and which
 * references are missing. It never converts textures; conversion stays in the generator.
 *
 * Usage:
 *   npx tsx tools/assets/ktx2-audit.ts [--check] [--prune]
 *   WORKER_REPO=/path/to/island-of-settlers-worker-generation npx tsx tools/assets/ktx2-audit.ts
 */

const gameRoot = resolve(import.meta.dirname, "../../..");
const workerRepo = resolve(process.env.WORKER_REPO ?? join(gameRoot, "island-of-settlers-worker-generation"));
const gameReady = join(workerRepo, "game_ready");
const check = process.argv.includes("--check");
const prune = process.argv.includes("--prune");

if (!existsSync(gameReady)) throw new Error(`Worker game_ready folder not found: ${gameReady}`);

const normalize = (path: string) => posix.normalize(path);
const inside = (root: string, path: string) => {
  const full = resolve(root, path);
  return full === root || full.startsWith(`${root}/`) ? full : null;
};

const referenced = new Set<string>();
const missing = new Set<string>();
const textures = new Map<string, number>();

const read = (path: string) => {
  const full = inside(gameReady, path);
  if (!full || !existsSync(full) || !statSync(full).isFile()) {
    missing.add(normalize(path));
    return null;
  }
  return readFileSync(full);
};

/** Image URIs of a .gltf JSON or a .glb binary, relative to the model's folder. */
const imageUris = (path: string, bytes: Buffer) => {
  try {
    if (path.endsWith(".glb")) {
      const length = bytes.readUInt32LE(12);
      const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
      return (gltf.images ?? []).flatMap((image: { uri?: string }) =>
        image.uri && !image.uri.startsWith("data:") ? [decodeURIComponent(image.uri)] : []);
    }
    if (path.endsWith(".gltf")) {
      const gltf = JSON.parse(bytes.toString("utf8"));
      return (gltf.images ?? []).flatMap((image: { uri?: string }) =>
        image.uri && !image.uri.startsWith("data:") ? [decodeURIComponent(image.uri)] : []);
    }
  } catch (error) {
    throw new Error(`Cannot read model ${path}: ${String(error)}`, { cause: error });
  }
  return [];
};

/** Add a referenced file; for models, follow their image URIs. */
const add = (path: string) => {
  const normalized = normalize(path);
  if (referenced.has(normalized)) return;
  referenced.add(normalized);
  const bytes = read(normalized);
  if (!bytes) return;
  for (const uri of imageUris(normalized, bytes))
    add(posix.join(posix.dirname(normalized), uri));
};

const json = (path: string) => JSON.parse(read(path)!.toString("utf8")) as Record<string, unknown>;

const collectArmour = () => {
  const manifest = json("armour/manifest.json") as {
    sets: { bodies: {
      files: Record<string, string>; models: Record<string, string>;
      filesMinimal?: Record<string, string>; modelsMinimal?: Record<string, string>;
      layers?: Record<string, string>; layersMinimal?: Record<string, string>;
      lods?: Record<string, { model: string }[]>;
    }[] }[];
  };
  for (const set of manifest.sets) for (const body of set.bodies) {
    for (const path of [...Object.values(body.models), ...Object.values(body.files),
      ...Object.values(body.modelsMinimal ?? {}), ...Object.values(body.filesMinimal ?? {}),
      ...Object.values(body.layers ?? {}), ...Object.values(body.layersMinimal ?? {}),
      ...Object.values(body.lods ?? {}).flat().map(lod => lod.model)])
      add(posix.join("armour", path));
  }
};

const collectTripo = () => {
  const manifest = json("tripo/manifest.json") as {
    props: Record<string, string>; workers: {
      animations: string; animationOverrides?: string; lods?: { model: string }[]; model: string;
      modelMinimal?: string; neutralBody?: string;
    }[];
  };
  for (const worker of manifest.workers) {
    add(`tripo/${worker.model}`);
    add(`tripo/${worker.animations}`);
    for (const path of [worker.modelMinimal, worker.neutralBody, worker.animationOverrides])
      if (path) add(`tripo/${path}`);
    for (const lod of worker.lods ?? []) add(posix.join("tripo", lod.model));
  }
  for (const prop of Object.values(manifest.props)) add(posix.join("tripo", prop));
};

const collectMounts = () => {
  const manifest = json("mounts/manifest.json") as {
    horse: { coat: { mask: string }; model: string };
    riders: { animations: string; model: string }[];
  };
  add(`mounts/${manifest.horse.model}`);
  add(`mounts/${manifest.horse.coat.mask}`);
  for (const rider of manifest.riders) {
    add(`mounts/${rider.model}`);
    add(`mounts/${rider.animations}`);
  }
};

const walk = (folder: string) => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && extname(entry.name) === ".ktx2")
      textures.set(normalize(path.slice(gameReady.length + 1)), statSync(path).size);
  }
};

collectArmour();
collectTripo();
collectMounts();
walk(gameReady);

const shipped = [...referenced].filter(path => path.endsWith(".ktx2")).sort();
const unused = [...textures.keys()].filter(path => !referenced.has(path)).sort();
const missingList = [...missing].sort();
const totalBytes = shipped.reduce((sum, path) => sum + (textures.get(path) ?? 0), 0);
const unusedBytes = unused.reduce((sum, path) => sum + (textures.get(path) ?? 0), 0);

console.log(`worker repo: ${workerRepo}`);
console.log(`shipped KTX2: ${shipped.length} (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
console.log(`unreferenced KTX2: ${unused.length} (${(unusedBytes / 1024 / 1024).toFixed(2)} MiB)`);
for (const path of unused) console.log(`  unused ${path}`);
console.log(`missing references: ${missingList.length}`);
for (const path of missingList) console.log(`  missing ${path}`);

if (prune) {
  for (const path of unused) {
    unlinkSync(join(gameReady, path));
    console.log(`pruned ${path}`);
  }
}

if (check && (missingList.length || unused.length)) process.exitCode = 1;
