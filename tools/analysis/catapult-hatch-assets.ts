import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as ThreeTypes from "three";
import type { GLTFLoader as LoaderType } from "three/addons/loaders/GLTFLoader.js";

import { type ArmourRank,ThreeArmourPack } from "../../../island-of-settlers-worker-generation/src/game-three-armour";
import { shareWorkerSkeletons } from "../../../island-of-settlers-worker-generation/src/game-three-skeletons";
import type { GameWorkerRecord, ThreeWorkerPack } from "../../../island-of-settlers-worker-generation/src/game-three-worker";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";

type AuditDocument = Awaited<ReturnType<Awaited<ReturnType<typeof createRetargetIO>>["read"]>>;

/** Native glTF scene/skin/clip loader, with texture payloads omitted only for CPU geometry analysis. */
export const createHatchAuditAssets = async (options: {
  armourFolder?: string;
  motionPilots?: boolean;
  transformModel?: (document: AuditDocument, path: string) => void;
} = {}) => {
  const ready = resolve("../island-of-settlers-worker-generation/game_ready");
  const manifestFolder = options.motionPilots ? "foot-calibration-pilots" : "tripo";
  const tripo = pathToFileURL(`${ready}/${manifestFolder}/`).href;
  // Use the generator's Three instance, just as its native armour attachment helpers do.
  const workerModules = new URL("../../../island-of-settlers-worker-generation/node_modules/three/", import.meta.url);
  const { AnimationMixer } = await import(new URL("build/three.module.js", workerModules).href) as typeof ThreeTypes;
  const { GLTFLoader } = await import(new URL("examples/jsm/loaders/GLTFLoader.js", workerModules).href) as { GLTFLoader: typeof LoaderType };
  const io = await createRetargetIO(), loader = new GLTFLoader();
  const manifest = JSON.parse(await readFile(`${ready}/${manifestFolder}/manifest.json`, "utf8"));
  const assets = new Map<string, string>();
  const model = async (url: string) => {
    const path = fileURLToPath(new URL(url, tripo)), bytes = await readFile(path);
    assets.set(path.slice(ready.length + 1), createHash("sha256").update(bytes).digest("hex"));
    const document = await io.read(path);
    options.transformModel?.(document, path);
    for (const texture of document.getRoot().listTextures()) texture.dispose();
    for (const extension of document.getRoot().listExtensionsUsed())
      if (extension.extensionName === "EXT_meshopt_compression") extension.dispose();
    const decoded = await io.writeBinary(document);
    return loader.parseAsync(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength), "");
  };
  const entryFor = (nation: string, variant: string): GameWorkerRecord => {
    const entry = manifest.workers.find((record: GameWorkerRecord) => record.nation === nation && record.variant === variant);
    if (!entry) throw new Error(`Missing native worker ${nation}/${variant}`);
    return entry;
  };
  const pack = {
    async load(nation: string, variant: string, path?: string) {
      const entry = entryFor(nation, variant);
      const [gltf, common, override] = await Promise.all([model(path ?? entry.model), model(entry.animations),
        entry.animationOverrides ? model(entry.animationOverrides) : undefined]);
      const clips = [...new Map([...common.animations, ...override?.animations ?? []].map(clip => [clip.name, clip])).values()];
      shareWorkerSkeletons(gltf.scene);
      return { root: gltf.scene, clips, mixer: new AnimationMixer(gltf.scene), entry,
        setTeamColor: () => {}, dispose: () => {} };
    },
    loadModel: model,
    async loadSharedModel(url: string) { return { ...await model(url), release: () => {} }; },
    async resolveSourceBody(nation: string, variant: string) {
      const entry = entryFor(nation, variant);
      return entry.sourceBody ? manifest.workers.find((record: GameWorkerRecord) => record.variant === entry.sourceBody) : entry;
    }
  } as unknown as ThreeWorkerPack;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let url = input as string;
    if (input instanceof URL) url = input.href;
    else if (typeof input !== "string") url = input.url;
    if (url.startsWith("file:")) return new Response(await readFile(fileURLToPath(url)), { status: 200 });
    return fetchOriginal(input, init);
  };
  return {
    assets,
    pack,
    restore: () => { globalThis.fetch = fetchOriginal; },
    async civilian(nation: GameWorkerRecord["nation"], variant: string, minimal: boolean) {
      const entry = entryFor(nation, variant);
      return pack.load(nation, variant, minimal ? entry.modelMinimal ?? entry.model : entry.model);
    },
    async soldier(nation: GameWorkerRecord["nation"], variant: string, rank: ArmourRank, minimal: boolean) {
      return new ThreeArmourPack(pathToFileURL(`${ready}/${options.armourFolder ?? "armour"}/`).href,
        pack, minimal).loadSoldier(nation, variant, rank);
    }
  };
};
