import type { CharacterLodLevel } from "@workers/character-lods/lod-policy";
import type { ArmourRank, ThreeArmourPack } from "@workers/game-three-armour";
import { shareWorkerSkeletons } from "@workers/game-three-skeletons";
import type { ThreeWorkerPack } from "@workers/game-three-worker";
import {
  AnimationMixer, type Material, Mesh, type Object3D, SkinnedMesh
} from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";

import { loadWorkerBody } from "../../render-common/workers/worker-appearance";
import { workerBodyNation } from "../../render-common/workers/worker-body-nation";
import { DEFAULT_WORKER_COLOR, getWorkerColorHex } from "../../render-common/workers/worker-colors";
import { type WorkerAppearance, type WorkerNation } from "../../render-common/workers/worker-unit";
import { CHARACTER_LOD3_LATE_PIXELS } from "./character-tier-policy";
import { createOwnedAssetCache, type OwnedAssetLease } from "./owned-asset-cache";
import {
  type BodyMaterialLookup, type BodyMaterials, createBodyMaterials
} from "./worker-body-materials";
import type { CrowdBodySource } from "./worker-gpu-instances";
import {
  baseLodFile, createWorkerLodSources, type WorkerLodAccess, type WorkerLodFile
} from "./worker-lod-sources";
import { createWorkerPackAssets, type WorkerPackAssets } from "./worker-pack-assets";

type LoadedWorker = Awaited<ReturnType<ThreeWorkerPack["load"]>>;
type BodyRank = ArmourRank | "civilian";
/** A loaded body type: its source model, the level chain every actor swaps within and its GPU crowd source. */
interface BodyEntry {
  crowd?: CrowdBodySource;
  lods?: WorkerLodAccess;
  /** C02 (b): one shared material per source material × tint colour for every actor of the type. */
  materials?: BodyMaterials;
  source: LoadedWorker;
}
interface BodySource {
  entry: BodyEntry;
  lease: OwnedAssetLease<BodyEntry>;
}
/**
 * An actor instance: the pack's worker plus the C05 swap contract (absent without level files), the
 * C06 crowd source of its body type (absent without an authored LOD3) and its shared body materials.
 */
export type PooledWorker = LoadedWorker & {
  bodyMaterial: BodyMaterialLookup;
  crowd?: CrowdBodySource;
  lod3Pixels?: number;
  lods?: WorkerLodAccess;
};

/** C06: what the GPU crowd bakes and instances for one body type (shared by its actors). */
const crowdBodySource = (key: string, source: LoadedWorker, access: WorkerLodAccess): CrowdBodySource => ({
  acquireLevel3: () => access.acquire(3),
  clips: source.clips,
  cloneRig: () => {
    const rig = clone(source.root);
    shareWorkerSkeletons(rig);
    return rig;
  },
  key
});

/**
 * A body type kept loaded before its actor exists (C11 possession entry): the finest level's shared
 * source root, its authored coarser level access, and the one release that drops the body lease.
 */
export interface WorkerBodyPrewarm {
  lods?: WorkerLodAccess;
  release: () => void;
  root: Object3D;
}

/** C05 authored levels: where the soldier files live, the preset's finest level and its map policy. */
export interface WorkerLodOptions {
  armourBase: string;
  detailed: boolean;
  lodMax: CharacterLodLevel;
  soldierLodMax: CharacterLodLevel;
}

const bodyKey = (appearance: WorkerAppearance, rank?: ArmourRank) =>
  `${appearance.nation}/${appearance.variant}/${rank ?? "civilian"}`;

/** The Japanese linen bodies and Maya centurions keep LOD2 until the late LOD3 edge (C04-fix). */
const lateLod3 = (appearance: WorkerAppearance, rank?: ArmourRank) =>
  (rank !== undefined && appearance.nation === "japanese" && appearance.variant.includes("linen")) ||
  (appearance.nation === "maya" && rank === "centurion");

const parseBodyKey = (key: string) => {
  const [nation, variant, rank] = key.split("/") as [WorkerNation, string, BodyRank];
  return { nation, rank, variant };
};

/** Parse each original body once; every settler keeps an independent skeleton, mixer and tunic. */
export const createWorkerBodyPool = (
  pack: ThreeWorkerPack,
  armour?: ThreeArmourPack,
  shared: WorkerPackAssets = createWorkerPackAssets(pack),
  lodOptions?: WorkerLodOptions
) => {
  const lods = lodOptions ? createWorkerLodSources({ pack, armour, shared, ...lodOptions }) : undefined;
  /** The base body: the preset's finest authored level, else today's LOD0 composition. */
  const loadSource = (nation: WorkerNation, variant: string, rank: BodyRank, base?: WorkerLodFile) => {
    if (base) return pack.load(nation, variant, base.url);
    if (rank !== "civilian" && armour) return armour.loadSoldier(nation, variant, rank);
    return pack.load(nation, variant);
  };
  const loadBody = async (key: string): Promise<BodyEntry> => {
    const { nation, rank, variant } = parseBodyKey(key);
    const bodyNation = workerBodyNation(nation, variant);
    const soldierRank = rank === "civilian" ? undefined : rank;
    const files = await lods?.files(bodyNation, variant, soldierRank);
    // Without authored level files (isolated fixtures) the loaded body is the source itself.
    const base = lods && lodOptions
      ? baseLodFile(files, soldierRank ? lodOptions.soldierLodMax : lodOptions.lodMax)
      : undefined;
    const source = await loadSource(bodyNation, variant, rank, base);
    try {
      shared.retainBody(source);
    } catch (error) {
      source.dispose();
      throw error;
    }
    const access = lods && files?.length
      ? lods.access(bodyNation, variant, soldierRank, base?.record.level ?? 0, files) : undefined;
    const crowd = access?.has(3) ? crowdBodySource(key, source, access) : undefined;
    return { crowd, lods: access, materials: createBodyMaterials(), source };
  };
  const bodies = createOwnedAssetCache<BodyEntry>(
    loadBody,
    // The last instance of this body type also drops its share of the pack textures and clips.
    body => {
      shared.releaseBody(body.source);
      body.source.dispose();
      body.materials?.dispose();
    }
  );
  let instances = 0;
  const acquireBody = async (appearance: WorkerAppearance, rank?: ArmourRank): Promise<BodySource> => {
    // Keep shared pack entries while any type is loading, even before it registers its source.
    const done = shared.beginLoad();
    let lease: OwnedAssetLease<BodyEntry> | undefined;
    try {
      lease = bodies.acquire(bodyKey(appearance, rank));
      return { entry: await lease.promise, lease };
    } catch (error) {
      lease?.release();
      throw error;
    } finally {
      done();
    }
  };
  return {
    async load(appearance: WorkerAppearance, rank?: ArmourRank): Promise<PooledWorker> {
      const { entry, lease } = await loadWorkerBody(appearance, body => acquireBody(body, rank));
      const { source } = entry;
      const materials = entry.materials!;
      const root = clone(source.root) as LoadedWorker["root"];
      const defaultColor = getWorkerColorHex(DEFAULT_WORKER_COLOR);
      try {
        shareWorkerSkeletons(root);
        root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          const materialFor = (material: Material) => materials.get(material, defaultColor);
          object.material = Array.isArray(object.material)
            ? object.material.map(materialFor) : materialFor(object.material);
        });
      } catch (error) {
        lease.release();
        throw error;
      }
      const mixer = new AnimationMixer(root);
      instances++;
      const setTeamColor = (color: string | number) => root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const materialFor = (material: Material) => materials.get(material, color);
        object.material = Array.isArray(object.material)
          ? object.material.map(materialFor) : materialFor(object.material);
      });
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true; instances--;
        mixer.stopAllAction(); mixer.uncacheRoot(root); root.removeFromParent();
        root.traverse(object => { if (object instanceof SkinnedMesh) object.skeleton.dispose(); });
        // The last unit of this nation/body/rank releases its shared materials, geometry and textures.
        lease.release();
      };
      return { bodyMaterial: materials.get, root, mixer, clips: source.clips, crowd: entry.crowd,
        entry: source.entry, lods: entry.lods,
        lod3Pixels: lateLod3(appearance, rank) ? CHARACTER_LOD3_LATE_PIXELS : undefined,
        setTeamColor, dispose };
    },
    /** C11: loads one body type without an actor, kept alive until the possession view releases it. */
    async prewarm(appearance: WorkerAppearance, rank?: ArmourRank): Promise<WorkerBodyPrewarm> {
      const { entry, lease } = await acquireBody(appearance, rank);
      let released = false;
      return {
        lods: entry.lods,
        release: () => { if (released) return; released = true; lease.release(); },
        root: entry.source.root
      };
    },
    stats: () => {
      const { assets, ...cache } = bodies.stats();
      return { ...cache, instances, lodTemplates: lods?.stats().assets ?? 0, originalBodies: assets };
    },
    dispose: () => { bodies.dispose(); lods?.dispose(); }
  };
};
