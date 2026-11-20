import type { IUniform } from "three";

import { createVertexFog } from "../../render-common/chunk-sampling";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { buildSpringFlowerInstances } from "../../render-common/props/spring-flowers";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createPropMaterial } from "./three-prop-materials";
import { createThreePropMeshes, groupByMesh } from "./three-props";
import { CULL_CHUNK_CELLS, listCullChunks } from "./three-visibility";

/**
 * Spring meadow flowers (lazy: imported once a spring look first shows; summer pays nothing). Chunk-culled
 * instanced flower meshes with their own grass fade, so Minimal (which draws no field cover) still gets the
 * spring meadow at gameplay zoom. The prop shader opens each flower with the spring weight (SPRING_BLOOM).
 */
export const createSpringFlowerLayer = (
  world: WorldData,
  meshes: PropMesh[],
  instances: PropInstances,
  uniforms: Record<string, IUniform>,
  samplesPerCell: number
) => {
  const fade: IUniform<number> = { value: 1 };
  const material = createPropMaterial(uniforms, true, false, 0, true);
  material.uniforms.uGrassFade = fade;
  const flowers = createThreePropMeshes(meshes, instances, world.cellsX, { depth: null, main: material });

  /** Map editor: the spring flowers of the edited region again (same cell streams as a full build). */
  const replaceRegion = (region: CellRegion) => {
    const rebuilt = buildSpringFlowerInstances(world, createVertexFog(world), samplesPerCell, region);
    const chunks = listCullChunks(region, Math.ceil(world.cellsX / CULL_CHUNK_CELLS));
    const byMesh = groupByMesh(rebuilt);
    for (const prop of flowers) prop.replaceChunks(chunks, rebuilt, byMesh.get(prop.meshId) ?? []);
  };

  return { fade, flowers, material, replaceRegion };
};

export type SpringFlowerLayer = ReturnType<typeof createSpringFlowerLayer>;

/** The island's spring flowers on the main thread (tools and builders without the worker job). */
export const buildSpringFlowersHere = (world: WorldData, samplesPerCell: number) =>
  buildSpringFlowerInstances(world, createVertexFog(world), samplesPerCell);
