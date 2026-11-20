import { type CharacterLodLevel, TEAM_TINT_MATERIAL } from "@workers/character-lods/lod-policy";
import { type Material, Mesh, type MeshStandardMaterial, type Object3D, SkinnedMesh } from "three";

import {
  CHARACTER_LOD_HOLD_SECONDS,
  CHARACTER_SHADOW_PROXY_LOD,
  type CharacterTierPolicy,
  nextCharacterLod
} from "./character-tier-policy";
import type { OwnedAssetLease } from "./owned-asset-cache";
import { meshMaterials } from "./three-mesh-resources";
import { SHADOW_CASTER_LAYER } from "./three-shadows";
import { type BodyMaterialLookup, isTintedBodyMaterial } from "./worker-body-materials";
import { CrowdBodyMaterial } from "./worker-crowd-body";
import type { WorkerLodTemplate } from "./worker-lod-sources";

/** The swap contract an actor needs: its root, the level it was loaded as and the coarser files. */
export interface DetailedWorker {
  /** C02 (b): shared material of the actor's body type (absent in isolated fixtures). */
  bodyMaterial?: BodyMaterialLookup;
  /** Late LOD3 switch for bodies whose authored LOD3 is coarse up close (C04-fix). */
  lod3Pixels?: number;
  lods?: { acquire(level: CharacterLodLevel): OwnedAssetLease<WorkerLodTemplate>; base: CharacterLodLevel;
    has(level: CharacterLodLevel): boolean };
  root: Object3D;
}

/** One instantiated level: skinned meshes bound to the actor's skeleton, plus its own tint clone. */
interface LevelInstance {
  lease: OwnedAssetLease<WorkerLodTemplate>;
  meshes: SkinnedMesh[];
  ownMaterials: Material[];
}

const LEVELS: readonly CharacterLodLevel[] = [0, 1, 2, 3];
/** No level casts the sun shadow. */
const NO_CASTER = -1;
const MAIN_LAYER_MASK = 1;
const CASTER_LAYER_MASK = 1 << SHADOW_CASTER_LAYER;
let reportedMismatch = false;

/** Main camera layer when drawn, the light camera's layer when it casts. */
const layerMask = (displayed: boolean, casting: boolean) =>
  (displayed ? MAIN_LAYER_MASK : 0) | (casting ? CASTER_LAYER_MASK : 0);

const tintMaterial = (meshes: readonly Mesh[]) => {
  for (const mesh of meshes) for (const material of meshMaterials(mesh))
    if (material.name === TEAM_TINT_MATERIAL) return material as MeshStandardMaterial;
  return undefined;
};

/**
 * Runtime level of detail of one skinned actor (C05). The actor keeps the skeleton, bones, sockets,
 * clips and procedural layers of its loaded base body; a coarser level only exchanges the drawn
 * skinned meshes for the authored file's meshes, bound to the same skeleton (identical joints and
 * inverse binds), so tools, cargo and mounts stay anchored. Levels load lazily on first demand and
 * stay cached for the actor's life; the hysteresis of the policy plus a short hold stops flicker.
 *
 * Sun shadow (R02/C07): a casting actor draws its LOD2 proxy into the shadow map. From LOD2 down
 * the shown meshes cast; a finer shown level keeps the LOD2 instance on the caster layer only, so
 * the main camera never sees it. Until that proxy has loaded, the shown meshes cast.
 */
export const createWorkerDetail = (worker: DetailedWorker, presetPolicy: CharacterTierPolicy) => {
  const { lods } = worker;
  const base: CharacterLodLevel = lods?.base ?? 0;
  // The loaded base is the finest level this body may show (Minimal soldiers start at LOD2).
  // Read live: the player's Character detail cap (C12) may coarsen it without a reload.
  const effectiveLodMax = () => Math.max(base, presetPolicy.lodMax) as CharacterLodLevel;
  const baseMeshes: Mesh[] = [];
  worker.root.traverse(object => { if (object instanceof Mesh) baseMeshes.push(object); });
  const baseVisible = baseMeshes.map(mesh => mesh.visible);
  const skeleton = baseMeshes.find((mesh): mesh is SkinnedMesh => mesh instanceof SkinnedMesh)?.skeleton;
  const instances: (LevelInstance | undefined)[] = [undefined, undefined, undefined, undefined];
  const pending: (OwnedAssetLease<WorkerLodTemplate> | undefined)[] = [undefined, undefined, undefined, undefined];
  const failed = [false, false, false, false];
  let shown = base;
  let wanted = base;
  let since = -Infinity;
  let disposed = false;
  let casting = false;
  /** C06: the GPU crowd draws the body; the shown level stays hidden (its caster role is unchanged). */
  let gpuDrawn = false;

  /** The level drawn into the sun shadow map (NO_CASTER when the actor does not cast). */
  const casterLevel = (): CharacterLodLevel | typeof NO_CASTER => {
    if (!casting) return NO_CASTER;
    if (!lods || !skeleton || shown >= CHARACTER_SHADOW_PROXY_LOD) return shown;
    const proxy = reachable(CHARACTER_SHADOW_PROXY_LOD);
    return instances[proxy] ? proxy : shown;
  };

  /** Visibility and layers of every level from the shown and the casting level. */
  const applyLevels = () => {
    const caster = casterLevel();
    const baseMask = layerMask(shown === base && !gpuDrawn, caster === base);
    for (const mesh of baseMeshes) mesh.layers.mask = baseMask;
    for (const level of LEVELS) {
      const instance = instances[level];
      if (!instance) continue;
      const displayed = level === shown && !gpuDrawn, casts = level === caster;
      for (const mesh of instance.meshes) {
        mesh.visible = displayed || casts;
        mesh.layers.mask = layerMask(displayed, casts);
      }
    }
  };

  const show = (level: CharacterLodLevel, time: number) => {
    if (level === shown) return;
    if (shown === base) baseMeshes.forEach((mesh, index) => { baseVisible[index] = mesh.visible; });
    baseMeshes.forEach((mesh, index) => { mesh.visible = level === base && baseVisible[index]!; });
    shown = level;
    since = time;
    applyLevels();
  };

  /** C02 (b): a tinted material is the body type's shared colour variant; others stay shared. */
  const ownMaterial = (material: Material, own: Material[], tint: MeshStandardMaterial | undefined) => {
    if (!isTintedBodyMaterial(material)) return material;
    const color = tint?.color ??
      (material instanceof CrowdBodyMaterial ? material.tint : (material as MeshStandardMaterial).color);
    if (worker.bodyMaterial) return worker.bodyMaterial(material, color);
    // Isolated fixtures without a body pool keep the per-actor clone.
    const clone = material.clone();
    if (clone instanceof CrowdBodyMaterial) clone.tint.copy(color);
    else (clone as MeshStandardMaterial).color.copy(color);
    own.push(clone);
    return clone;
  };

  const instantiate = (template: WorkerLodTemplate, lease: OwnedAssetLease<WorkerLodTemplate>): LevelInstance => {
    const ownMaterials: Material[] = [];
    const tint = tintMaterial(baseMeshes);
    const meshes = template.meshes.map(source => {
      const material = Array.isArray(source.material)
        ? source.material.map(entry => ownMaterial(entry, ownMaterials, tint))
        : ownMaterial(source.material, ownMaterials, tint);
      const mesh = new SkinnedMesh(source.geometry, material);
      mesh.name = source.name;
      mesh.frustumCulled = source.frustumCulled;
      mesh.position.copy(source.position);
      mesh.quaternion.copy(source.quaternion);
      mesh.scale.copy(source.scale);
      mesh.visible = false;
      const parent = source.parent?.name ? worker.root.getObjectByName(source.parent.name) : undefined;
      (parent ?? worker.root).add(mesh);
      mesh.bind(skeleton!, source.bindMatrix);
      return mesh;
    });
    return { lease, meshes, ownMaterials };
  };

  const compatible = (template: WorkerLodTemplate) => {
    const bones = template.meshes[0]?.skeleton.bones;
    const matches = !!bones && !!skeleton && bones.length === skeleton.bones.length &&
      bones.every((bone, index) => bone.name === skeleton.bones[index]!.name);
    if (!matches && !reportedMismatch) {
      reportedMismatch = true;
      console.warn(`Character LOD${template.record.level} rig differs from its base body; level skipped`);
    }
    return matches;
  };

  const request = (level: CharacterLodLevel) => {
    if (!lods || pending[level] || failed[level]) return;
    const lease = lods.acquire(level);
    pending[level] = lease;
    lease.promise.then(template => {
      pending[level] = undefined;
      if (disposed || !compatible(template)) { failed[level] = !disposed; lease.release(); return; }
      instances[level] = instantiate(template, lease);
      if (wanted === level && level !== shown) show(level, since);
      else applyLevels();
    }, (error: unknown) => {
      pending[level] = undefined;
      failed[level] = true;
      lease.release();
      if (!disposed) console.warn(`Character LOD${level} could not load`, error);
    });
  };

  /** The nearest level to `target` the body has a file for (or its base), searching coarser first. */
  const reachable = (target: CharacterLodLevel): CharacterLodLevel => {
    if (!lods || target <= base) return base;
    for (let offset = 0; offset <= 3; offset++) {
      const coarser = (target + offset) as CharacterLodLevel;
      if (coarser <= 3 && lods.has(coarser) && !failed[coarser]) return coarser;
      const finer = (target - offset) as CharacterLodLevel;
      if (finer <= base) return base;
      if (lods.has(finer) && !failed[finer]) return finer;
    }
    return base;
  };

  /** A caster finer than LOD2 loads its LOD2 proxy (once; a failed file falls back to the shown level). */
  const requestProxy = () => {
    if (!lods || !skeleton || shown >= CHARACTER_SHADOW_PROXY_LOD) return;
    const proxy = reachable(CHARACTER_SHADOW_PROXY_LOD);
    if (proxy > shown && !instances[proxy]) request(proxy);
  };

  return {
    /** The drawn level. */
    level: () => shown,
    /** C11: a view jump applies the target level at once; the hold only stops walking flicker. */
    refresh: () => { since = -Infinity; },
    /** C06: the instanced crowd draws the body instead of the shown level's skinned meshes. */
    setGpuDrawn: (on: boolean) => {
      if (on === gpuDrawn) return;
      gpuDrawn = on;
      applyLevels();
    },
    /** Whether this actor draws into the sun shadow map (the crowd's per-frame budget decides). */
    setCaster: (on: boolean) => {
      if (on) requestProxy();
      if (on === casting) return;
      casting = on;
      applyLevels();
    },
    /** `pixels`: projected height in device pixels this frame; `time`: presentation seconds. */
    update: (pixels: number, time: number) => {
      if (!lods || !skeleton) return;
      const target = nextCharacterLod(shown, pixels, presetPolicy, worker.lod3Pixels, effectiveLodMax());
      if (target === shown) { wanted = shown; return; }
      if (time - since < CHARACTER_LOD_HOLD_SECONDS) return;
      const level = reachable(target);
      wanted = level;
      if (level === shown) return;
      if (level === base || instances[level]) { show(level, time); return; }
      since = time;
      request(level);
    },
    dispose: () => {
      disposed = true;
      for (const instance of instances) {
        if (!instance) continue;
        for (const mesh of instance.meshes) mesh.removeFromParent();
        for (const material of instance.ownMaterials) material.dispose();
        instance.lease.release();
      }
      for (const lease of pending) lease?.release();
      instances.fill(undefined);
      pending.fill(undefined);
    }
  };
};

export type WorkerDetail = ReturnType<typeof createWorkerDetail>;
