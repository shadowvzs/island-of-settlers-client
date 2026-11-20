import type { IUniform, Vector4 } from "three";

import { createLeafParticles } from "../../render-common/felling/leaf-particles";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getMeshKind } from "../../render-common/props/prop-meshes";
import { getSeasonLeafFall, SEASON_LEAF_FALL } from "../../render-common/seasonal-appearance/season-leaf-fall";
import { getSeasonClass } from "../../render-common/seasonal-appearance/season-palettes";
import { TREE_KIND_SET } from "./three-impostors";
import { createLeafParticleMesh } from "./three-leaf-particles";

/** Crown sample of one broadleaf tree: where its falling leaves start. */
interface LeafTree {
  canopyHeight: number;
  canopyRadius: number;
  sourceIndex: number;
  x: number;
  y: number;
  z: number;
}

/** The island's broadleaf trees (season class > 0, not shrubs), with their crown height and radius. */
const collectLeafTrees = (instances: PropInstances, meshes: readonly PropMesh[]) => {
  const trees: LeafTree[] = [];
  for (let index = 0; index < instances.count; index++) {
    const meshId = instances.meshIds[index]!;
    const kind = getMeshKind(meshId);
    const mesh = meshes[meshId];
    if (!mesh || !TREE_KIND_SET.has(kind) || getSeasonClass(kind) === 0) continue;
    const scale = instances.scale[index]!;
    trees.push({
      canopyHeight: mesh.height * scale * 0.72,
      canopyRadius: mesh.radius * scale * 0.7,
      sourceIndex: instances.sourceIndex[index]!,
      x: instances.x[index]!,
      y: instances.y[index]!,
      z: instances.z[index]!
    });
  }
  return trees;
};

/**
 * P1 seasonal falling leaves (lazy: imported once autumn or the leaf drop first shows; never on Minimal, which
 * has no weather particles). One instanced draw of the felling leaf mesh: leaves drift down from the broadleaf
 * crowns near the view focus, tinted by the season like the felling leaves.
 */
export const createSeasonalLeafFall = (
  instances: PropInstances,
  meshes: readonly PropMesh[],
  uniforms: Record<string, IUniform>,
  capacity: number,
  isPresent: (sourceIndex: number) => boolean
) => {
  const trees = collectLeafTrees(instances, meshes);
  const particles = createLeafParticles(capacity, Math.random);
  const leaves = createLeafParticleMesh(capacity, uniforms);
  const season = uniforms.uSeason?.value as Vector4 | undefined;
  let nearby: LeafTree[] = [];
  let nearbyX = Number.NaN, nearbyZ = Number.NaN;
  let lastTime = Number.NaN;
  let owed = 0;

  /** The trees within reach of the focus, refreshed when the focus moved a few cells. */
  const refreshNearby = (x: number, z: number) => {
    if (Math.hypot(x - nearbyX, z - nearbyZ) < SEASON_LEAF_FALL.refreshCells) return;
    nearbyX = x;
    nearbyZ = z;
    const reach = SEASON_LEAF_FALL.radiusCells;
    nearby = trees.filter(tree => Math.abs(tree.x - x) < reach && Math.abs(tree.z - z) < reach);
  };

  const spawnLeaf = () => {
    const tree = nearby[Math.floor(Math.random() * nearby.length)];
    if (!tree || !isPresent(tree.sourceIndex)) return;
    particles.spawn({
      count: 1, ground: tree.y, radius: tree.canopyRadius, size: tree.canopyRadius * SEASON_LEAF_FALL.leafSize,
      x: tree.x, y: tree.y + tree.canopyHeight, z: tree.z
    });
  };

  /** One frame at the view focus: new leaves at the season's fall rate, then the simulation and the draw. */
  const update = (focusX: number, focusZ: number, time: number) => {
    const delta = Number.isFinite(lastTime) ? Math.min(0.1, Math.max(0, time - lastTime)) : 0;
    lastTime = time;
    const fall = season ? getSeasonLeafFall({ autumn: season.x, dormant: season.y, spring: season.z }) : 0;
    refreshNearby(focusX, focusZ);
    owed = fall > 0 && nearby.length > 0 ? owed + fall * SEASON_LEAF_FALL.leavesPerSecond * delta : 0;
    for (; owed >= 1; owed -= 1) spawnLeaf();
    particles.update(delta);
    leaves.update(particles.particles);
  };

  return { mesh: leaves.mesh, update };
};

export type SeasonalLeafFall = ReturnType<typeof createSeasonalLeafFall>;
