import type { CharacterLodLevel, CharacterLodRecord } from "@workers/character-lods/lod-policy";
import type { ArmourManifest, ArmourRank, ThreeArmourPack } from "@workers/game-three-armour";
import type { GameWorkerRecord, ThreeWorkerPack } from "@workers/game-three-worker";
import { MeshStandardMaterial, type Object3D, SkinnedMesh } from "three";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createOwnedAssetCache, type OwnedAssetLease } from "./owned-asset-cache";
import { meshMaterials } from "./three-mesh-resources";
import { mergeCrowdLevelMeshes } from "./worker-crowd-body";
import type { WorkerPackAssets } from "./worker-pack-assets";

/** From this level on (C04 crowd levels: vertex colours, one skin) a body draws as one mesh. */
const CROWD_MERGE_LEVEL = 2;

/** One authored level of a body with its file resolved to an absolute URL. */
export interface WorkerLodFile { record: CharacterLodRecord; url: string }

/**
 * A loaded level file of one body type: its skinned meshes (geometry shared by every actor of
 * the type through the pack's model cache) in bind space, one skin, LOD0's joints and sockets.
 */
export interface WorkerLodTemplate {
  meshes: SkinnedMesh[];
  record: CharacterLodRecord;
  release(): void;
}

/** What a pooled actor may swap to: the level it was loaded as and the coarser authored files. */
export interface WorkerLodAccess {
  base: CharacterLodLevel;
  has(level: CharacterLodLevel): boolean;
  acquire(level: CharacterLodLevel): OwnedAssetLease<WorkerLodTemplate>;
}

interface LodSourceOptions {
  armour?: ThreeArmourPack;
  /** The armour folder the soldier level paths are relative to. */
  armourBase: string;
  /** Minimal drops the surface maps the preset never shows (the armour fallback values). */
  detailed: boolean;
  pack: ThreeWorkerPack;
  shared: WorkerPackAssets;
}

/** The pack keeps its manifest private; the lane reads it the way `worker-pack-assets` reads the caches. */
interface PackManifestView { loadManifest?(): Promise<{ workers: GameWorkerRecord[] }> }

/** The finest authored level that the preset allows (`lodMax`), or none when LOD0 composes at runtime. */
export const baseLodFile = (files: readonly WorkerLodFile[] | undefined, lodMax: CharacterLodLevel) =>
  files?.filter(file => file.record.level >= lodMax)
    .reduce<WorkerLodFile | undefined>((best, file) => !best || file.record.level < best.record.level ? file : best,
      undefined);

/**
 * C11: coarser authored levels a possession entry loads ahead of the camera move - the approach
 * level (LOD1) and the sun shadow proxy (LOD2). The base level itself is already loaded by the
 * body prewarm, and a preset may not show a finer one.
 */
export const explorationPrewarmLevels = (
  access: Pick<WorkerLodAccess, "base" | "has"> | undefined
): readonly CharacterLodLevel[] => {
  if (!access) return [];
  return ([1, 2] as const).filter(level => level > access.base && access.has(level));
};

const resolveFiles = (records: readonly CharacterLodRecord[] | undefined, base: string) =>
  records?.map(record => ({ record, url: new URL(record.model, base).href }));

const soldierRecords = (manifest: ArmourManifest, variant: string, rank: ArmourRank) => {
  for (const set of manifest.sets) {
    const body = set.bodies.find(candidate => candidate.id === variant);
    if (body) return body.lods?.[rank];
  }
  return undefined;
};

/** Minimal keeps albedo only: the same fallback the runtime applies to LOD0 armour there. */
const stripSurfaceMaps = (meshes: readonly SkinnedMesh[]) => {
  for (const mesh of meshes) for (const material of meshMaterials(mesh)) {
    if (!(material instanceof MeshStandardMaterial)) continue;
    material.normalMap = null; material.roughnessMap = null; material.metalnessMap = null;
    material.aoMap = null; material.roughness = .72; material.metalness = .15;
  }
};

const skinnedMeshes = (root: Object3D) => {
  const meshes: SkinnedMesh[] = [];
  root.traverse(object => { if (object instanceof SkinnedMesh) meshes.push(object); });
  return meshes;
};

/**
 * Resolves and loads the C04 level files of civilian and soldier bodies. Level records come from
 * the two manifests (`lods` per worker, `lods[rank]` per armour body); templates are one shared
 * clone per body type and level, alive while any actor shows or caches that level.
 */
export const createWorkerLodSources = ({ armour, armourBase, detailed, pack, shared }: LodSourceOptions) => {
  const manifest = () => (pack as unknown as PackManifestView).loadManifest?.();
  const fileLists = new Map<string, Promise<WorkerLodFile[] | undefined>>();
  const bodyKey = (nation: WorkerNation, variant: string, rank?: ArmourRank) =>
    `${nation}/${variant}/${rank ?? "civilian"}`;

  const lookup = async (nation: WorkerNation, variant: string, rank?: ArmourRank) => {
    if (rank) {
      if (!armour) return undefined;
      return resolveFiles(soldierRecords(await armour.loadManifest(), variant, rank), armourBase);
    }
    const workers = (await manifest())?.workers;
    const entry = workers?.find(worker => worker.nation === nation && worker.variant === variant);
    return resolveFiles(entry?.lods, pack.baseURL);
  };

  /** Level files of one body, cached per body type; `undefined` when it has no authored chain. */
  const files = (nation: WorkerNation, variant: string, rank?: ArmourRank) => {
    const key = bodyKey(nation, variant, rank);
    let pending = fileLists.get(key);
    if (!pending) {
      pending = lookup(nation, variant, rank).catch(() => undefined);
      fileLists.set(key, pending);
    }
    return pending;
  };

  const loadTemplate = async (key: string): Promise<WorkerLodTemplate> => {
    const [nation, variant, rank, level] = key.split("/") as [WorkerNation, string, string, string];
    const list = await files(nation, variant, rank === "civilian" ? undefined : rank as ArmourRank);
    const file = list?.find(candidate => candidate.record.level === Number(level));
    if (!file) throw new Error(`No LOD${level} file for ${nation}/${variant}/${rank}`);
    const model = await pack.loadSharedModel(file.url, variant);
    const releaseAssets = shared.retainProp(model.scene);
    const meshes = skinnedMeshes(model.scene);
    if (!detailed) stripSurfaceMaps(meshes);
    const skeletons = new Set(meshes.map(mesh => mesh.skeleton));
    const merged = file.record.level >= CROWD_MERGE_LEVEL ? mergeCrowdLevelMeshes(meshes) : null;
    // The merged body joins its parts' parent, so an actor's copy finds the same named parent.
    if (merged) meshes[0]!.parent!.add(merged);
    return {
      meshes: merged ? [merged] : meshes,
      record: file.record,
      release: () => {
        if (merged) {
          merged.removeFromParent();
          merged.geometry.dispose();
          meshMaterials(merged).forEach(material => material.dispose());
        }
        skeletons.forEach(skeleton => skeleton.dispose());
        releaseAssets();
        model.release();
      }
    };
  };
  const templates = createOwnedAssetCache<WorkerLodTemplate>(loadTemplate, template => template.release());

  /** The swap contract for actors loaded as `base` of this body type. */
  const access = (
    nation: WorkerNation, variant: string, rank: ArmourRank | undefined,
    base: CharacterLodLevel, list: readonly WorkerLodFile[] | undefined
  ): WorkerLodAccess => {
    const key = bodyKey(nation, variant, rank);
    const levels = new Set((list ?? []).map(file => file.record.level));
    return {
      base,
      has: level => level > base && levels.has(level),
      acquire: level => templates.acquire(`${key}/${level}`)
    };
  };

  return {
    access,
    files,
    stats: templates.stats,
    dispose: () => { templates.dispose(); fileLists.clear(); }
  };
};

export type WorkerLodSources = ReturnType<typeof createWorkerLodSources>;
