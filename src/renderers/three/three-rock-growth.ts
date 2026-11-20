import { type BufferGeometry, type Group, Matrix4, Mesh, type Object3D, type RawShaderMaterial, Vector3 } from "three";

import type { GrowPivot } from "../../render-common/map-edit/map-edit-builds";
import type { RockMeshData } from "../../render-common/rocks/rock-mesh";

/** Seconds a returning stone takes to grow from its seed size to full size. */
const GROW_SECONDS = 1.6;
/** Size it starts at (a small stone breaking the surface, not a point). */
const START_SCALE = .15;

interface GrowingStone {
  meshes: readonly Object3D[];
  onGrown: () => void;
  pivot: GrowPivot;
  /** Render time of its first frame; set on the next update. */
  start?: number;
}

const smoothstep = (value: number) => value * value * (3 - 2 * value);

const growthMatrix = new Matrix4();
const footOffset = new Matrix4();
const growthSize = new Vector3();

/** Scale about the stone's foot: the geometry stays in world space, so lighting and fog read true. */
const setGrowth = (stone: GrowingStone, scale: number) => {
  const { x, y, z } = stone.pivot;
  growthMatrix.makeTranslation(x, y, z).scale(growthSize.setScalar(scale))
    .multiply(footOffset.makeTranslation(-x, -y, -z));
  for (const mesh of stone.meshes) mesh.matrix.copy(growthMatrix);
};

/**
 * Every respawning stone source (quarry boulder, material deposit) grows in the same way: its meshes
 * scale up about its foot over GROW_SECONDS, then `onGrown` runs and they are left at full size.
 * Nothing runs while no stone is growing.
 */
export const createStoneGrowIn = () => {
  const growing: GrowingStone[] = [];
  const track = (meshes: readonly Object3D[], pivot: GrowPivot, onGrown: () => void = () => {}) => {
    for (const mesh of meshes) mesh.matrixAutoUpdate = false;
    const stone = { meshes, onGrown, pivot };
    setGrowth(stone, START_SCALE);
    growing.push(stone);
  };
  const finish = (stone: GrowingStone) => {
    for (const mesh of stone.meshes) {
      mesh.matrix.identity();
      mesh.matrixAutoUpdate = true;
    }
    stone.onGrown();
  };
  const update = (time: number) => {
    for (let index = growing.length - 1; index >= 0; index--) {
      const stone = growing[index]!;
      stone.start ??= time;
      const progress = Math.min(1, Math.max(0, (time - stone.start) / GROW_SECONDS));
      if (progress >= 1) {
        growing.splice(index, 1);
        finish(stone);
        continue;
      }
      setGrowth(stone, START_SCALE + (1 - START_SCALE) * smoothstep(progress));
    }
  };
  return { track, update };
};

/**
 * Respawned quarry boulders: one short lived mesh (and shadow caster) per returning stone grows in,
 * then hands over to the static meadow stones (`onGrown`) and is disposed.
 */
export const createThreeRockGrowth = (
  layers: { casters: Group; group: Group },
  materials: { depth: RawShaderMaterial; main: RawShaderMaterial },
  toGeometry: (data: RockMeshData) => BufferGeometry
) => {
  const growIn = createStoneGrowIn();
  const grow = (data: RockMeshData, pivot: GrowPivot, onGrown: () => void) => {
    const main = new Mesh(toGeometry(data), materials.main);
    const caster = new Mesh(main.geometry, materials.depth);
    main.frustumCulled = false;
    caster.frustumCulled = false;
    layers.group.add(main);
    layers.casters.add(caster);
    growIn.track([main, caster], pivot, () => {
      onGrown();
      main.removeFromParent();
      caster.removeFromParent();
      main.geometry.dispose();
    });
  };
  return { grow, update: growIn.update };
};
