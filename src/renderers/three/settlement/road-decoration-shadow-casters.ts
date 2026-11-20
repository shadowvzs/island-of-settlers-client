import {
  DoubleSide,
  Group,
  InstancedMesh,
  type Material,
  MeshBasicMaterial,
  MeshDepthMaterial,
  type Scene,
  type Texture
} from "three";

import { SHADOW_NEAR_CASTER_LAYER } from "../three-shadows";

/** Below this opacity a transparent part (glass, lantern panes) casts no sun shadow. */
const CASTING_OPACITY = .9;

interface CutoutSource extends Material {
  alphaMap?: Texture | null;
  map?: Texture | null;
}

/** Alpha-tested parts (leaf cards, petals) keep their cut-out; everything else draws solid depth. */
const cutoutTexture = (material: CutoutSource) => {
  if (material.alphaTest <= 0) return null;
  return material.alphaMap ?? material.map ?? null;
};

/** Transparent see-through parts and overview billboards never cast. */
export const castsDecorationShadow = (mesh: InstancedMesh) => {
  if (!mesh.castShadow || mesh.userData.plantOverview) return false;
  const material = mesh.material as Material;
  return !material.transparent || material.opacity >= CASTING_OPACITY;
};

/**
 * D07b: decoration batches cast into the island sun map. Each casting batch mesh gets a depth twin
 * in the static shadow scene that shares its geometry, instance matrices and bounds (one upload,
 * no copies); the twin sits on the near-caster layer, so only the single iso map and the detailed
 * possessed cascades draw it. The decoration LOD is the projected-size gate: "near" and "far" mesh
 * batches are flagged `castShadow` (near from 70 px, 220 px for large plants; plants with an overview
 * card stay far only from about 35 px; both tiers inside the LOD's triangle budgets), "overview"
 * items and billboards never cast, like characters below their caster pixels. Depth materials: the
 * part's own `customDepthMaterial` (foliage flutter, crown impostors),
 * else a cached alpha-test twin of a cut-out material, else one shared solid depth material.
 */
export const createRoadDecorationShadowCasters = (shadowScene: Scene) => {
  const root = new Group();
  root.name = "road-decoration-shadow-casters";
  root.matrixAutoUpdate = false;
  shadowScene.add(root);
  // The depth target's colour attachment is never read: depth only, both faces (thin leaves, petals).
  const solid = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  const cutouts = new Map<Material, MeshDepthMaterial>();
  const casters = new Map<InstancedMesh, InstancedMesh>();

  const cutoutDepth = (material: CutoutSource, texture: Texture) => {
    const cached = cutouts.get(material);
    if (cached) return cached;
    const created = new MeshDepthMaterial({ alphaTest: material.alphaTest, map: texture, side: DoubleSide });
    cutouts.set(material, created);
    // An evicted template frees its materials: its depth twin goes with it.
    material.addEventListener("dispose", () => {
      if (cutouts.get(material) !== created) return;
      cutouts.delete(material);
      created.dispose();
    });
    return created;
  };

  const depthFor = (mesh: InstancedMesh): Material => {
    if (mesh.customDepthMaterial) return mesh.customDepthMaterial;
    const material = mesh.material as CutoutSource;
    const texture = cutoutTexture(material);
    return texture ? cutoutDepth(material, texture) : solid;
  };

  /** Mirrors the source's draw count and bounds after its instance matrices were written. */
  const sync = (mesh: InstancedMesh) => {
    const caster = casters.get(mesh);
    if (!caster) return;
    caster.count = mesh.count;
    caster.boundingBox = mesh.boundingBox;
    caster.boundingSphere = mesh.boundingSphere;
  };

  const add = (mesh: InstancedMesh) => {
    if (casters.has(mesh) || !castsDecorationShadow(mesh)) return;
    const caster = new InstancedMesh(mesh.geometry, depthFor(mesh), 0);
    caster.instanceMatrix = mesh.instanceMatrix;
    caster.name = `${mesh.name}/sun-caster`;
    caster.matrixAutoUpdate = false;
    caster.layers.set(SHADOW_NEAR_CASTER_LAYER);
    casters.set(mesh, caster);
    root.add(caster);
    sync(mesh);
  };

  /** Called with the source mesh before it is disposed; the shared attribute is freed with it. */
  const remove = (mesh: InstancedMesh) => {
    const caster = casters.get(mesh);
    if (!caster) return;
    casters.delete(mesh);
    caster.removeFromParent();
  };

  const dispose = () => {
    casters.clear();
    root.clear();
    root.removeFromParent();
    solid.dispose();
    for (const depth of cutouts.values()) depth.dispose();
    cutouts.clear();
  };

  return {
    add,
    dispose,
    remove,
    /** Receipt: casting batch meshes and the instances they draw into the sun map. */
    statistics: () => {
      let instances = 0;
      for (const caster of casters.values()) instances += caster.count;
      return { casterMeshes: casters.size, casterInstances: instances };
    },
    sync
  };
};

export type RoadDecorationShadowCasters = ReturnType<typeof createRoadDecorationShadowCasters>;
