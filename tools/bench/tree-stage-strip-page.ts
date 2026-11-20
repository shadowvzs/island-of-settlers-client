import { InstancedBufferAttribute, InstancedMesh, Matrix4, Object3D, Vector3, Vector4 } from "three";

import { FOLIAGE_SEED } from "../../src/app/asset-seeds";
import { createIconStudio, STAGE_CENTRE } from "../../src/editor-icons/icon-studio";
import { createIslandTreeStageMesh } from "../../src/render-common/props/island-trees";
import type { PropMesh } from "../../src/render-common/props/mesh-builder";
import { PROP_MESH_SEED } from "../../src/render-common/props/prop-mesh-seed";
import { createPropMesh } from "../../src/render-common/props/prop-meshes";
import { getSeasonClass } from "../../src/render-common/seasonal-appearance/season-palettes";
import { createFoliageAtlas } from "../../src/render-common/trees/foliage-atlas";
import { loadHardwoodMeshPayload } from "../../src/render-common/trees/hardwood-mesh-loader";
import type { GrowthStage } from "../../src/render-common/trees/tree-model";
import { createPropDepthMaterial, createPropMaterial } from "../../src/renderers/three/three-prop-materials";
import { createPropGeometry } from "../../src/renderers/three/three-props";

/** A prop mesh variant (`variant`) or a tree growth stage mesh (`stage`, `form`). */
export interface StripMesh {
  form?: number;
  kind: number;
  stage?: GrowthStage;
  variant?: number;
}

/**
 * One image: the meshes stand side by side, seen along `view`, with the full or the core (Minimal) draw;
 * `time` (seconds) and `wind` (x, z) pose the wind sway for motion strips (default: calm, time 0);
 * `season` sets the season weights (autumn, dormant, spring, monsoon) on the kinds' season materials.
 */
export interface StripShot {
  core: boolean;
  meshes: StripMesh[];
  season?: [number, number, number, number];
  time?: number;
  view: [number, number, number];
  wind?: [number, number];
}

declare global {
  interface Window {
    __treeStrip?: (shots: StripShot[]) => Promise<string[]>;
  }
}

const INSTANCE_DATA = [0, 1, 1, 0];
const NO_TINT = [1, 1, 1];
const PIXELS = 900;
const STAGE_SEED = 4049;

const buildMesh = ({ form = 0, kind, stage, variant = 0 }: StripMesh): PropMesh =>
  stage === undefined ? createPropMesh(PROP_MESH_SEED, kind, variant)
    : createIslandTreeStageMesh(kind, stage, form, STAGE_SEED + kind);

type PropMaterial = ReturnType<typeof createPropMaterial>;

const createInstance = (mesh: PropMesh, core: boolean, x: number, material: PropMaterial) => {
  const geometry = createPropGeometry(mesh);
  geometry.setAttribute("instanceData", new InstancedBufferAttribute(new Float32Array(INSTANCE_DATA), 4));
  geometry.setAttribute("instanceTint", new InstancedBufferAttribute(new Float32Array(NO_TINT), 3));
  if (core && mesh.coreIndexCount !== undefined) geometry.setDrawRange(0, mesh.coreIndexCount);
  const instance = new InstancedMesh(geometry, material, 1);
  instance.setMatrixAt(0, new Matrix4().makeTranslation(x, 0, STAGE_CENTRE));
  instance.frustumCulled = false;
  return instance;
};

/** Lays the meshes out along x (each gets its own radius of room) around the stage centre. */
const layout = (meshes: PropMesh[]) => {
  const widths = meshes.map(mesh => Math.max(mesh.radius, .05) * 2.2);
  const total = widths.reduce((sum, width) => sum + width, 0);
  let x = STAGE_CENTRE - total / 2;
  return widths.map(width => { x += width; return x - width / 2; });
};

window.__treeStrip = async (shots) => {
  await loadHardwoodMeshPayload();
  const foliage = createFoliageAtlas(FOLIAGE_SEED);
  const images: string[] = [];
  for (const shot of shots) {
    const studio = createIconStudio(foliage, new Vector3(...shot.view).normalize(), PIXELS);
    studio.uniforms.uTime!.value = shot.time ?? 0;
    (studio.uniforms.uWind!.value as Float32Array).set(shot.wind ?? [0, 0]);
    studio.uniforms.uSeason = { value: new Vector4(...(shot.season ?? [0, 0, 0, 0])) };
    const meshes = shot.meshes.map(buildMesh);
    const main = new Object3D(), casters: Object3D[] = [];
    layout(meshes).forEach((x, index) => {
      const seasonClass = getSeasonClass(shot.meshes[index]!.kind);
      main.add(createInstance(meshes[index]!, shot.core, x,
        createPropMaterial(studio.uniforms, false, false, seasonClass)));
      casters.push(createInstance(meshes[index]!, shot.core, x,
        createPropDepthMaterial(studio.uniforms, false, seasonClass)));
    });
    images.push(studio.shoot({ casters, main }).toDataURL("image/png"));
  }
  return images;
};
