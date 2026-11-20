import { Group, type IUniform, type Vector4 } from "three";

import type { ContentBuilders } from "../../render-common/content-builders";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import type { PropInstances } from "../../render-common/props/prop-instances";
import { getSpringBloomRamp } from "../../render-common/seasonal-appearance/spring-bloom";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { SeasonalLeafFall } from "./seasonal-leaf-fall";
import type { SpringFlowerLayer } from "./spring-flower-layer";
import type { ChunkedPropMesh } from "./three-props";

export interface SeasonExtrasOptions {
  builders: ContentBuilders;
  isPresent: (sourceIndex: number) => boolean;
  /** Seasonal falling leaves pool; 0: none (Minimal). */
  leafCapacity: number;
  meshes: PropMesh[];
  propInstances: PropInstances;
  /** Spring meadow flower samples per cell; 0: none. */
  springFlowerSamples: number;
  uniforms: Record<string, IUniform>;
  world: WorldData;
  /** The flower layer is ready: the vegetation adds it to its culled, faded field cover. */
  onFlowers: (flowers: ChunkedPropMesh[], material: SpringFlowerLayer["material"]) => void;
}

/**
 * Season-only vegetation extras, each imported the first time its season shows (zero cost before, plan's
 * optional-feature rule): the spring meadow flowers and the seasonal falling leaves (P1).
 */
export const createSeasonExtras = (options: SeasonExtrasOptions) => {
  const { builders, meshes, uniforms, world } = options;
  const group = new Group();
  group.name = "season-extras";
  const season = uniforms.uSeason?.value as Vector4 | undefined;
  let flowers: SpringFlowerLayer | null = null;
  let leafFall: SeasonalLeafFall | null = null;
  let flowersRequested = false;
  let leavesRequested = false;

  const loadFlowers = async (samples: number) => {
    const [layerModule, instances] = await Promise.all([
      import("./spring-flower-layer"),
      builders.springFlowers?.(samples)
    ]);
    const built = instances ?? layerModule.buildSpringFlowersHere(world, samples);
    const layer = layerModule.createSpringFlowerLayer(world, meshes, built, uniforms, samples);
    for (const prop of layer.flowers) group.add(prop.mesh);
    options.onFlowers(layer.flowers, layer.material);
    flowers = layer;
  };

  const requestFlowers = () => {
    const samples = options.springFlowerSamples;
    if (flowersRequested || samples <= 0 || !season || season.z <= 0) return;
    flowersRequested = true;
    loadFlowers(samples).catch(error => console.warn("spring flowers", error));
  };

  const requestLeaves = () => {
    const capacity = options.leafCapacity;
    if (leavesRequested || capacity <= 0 || !season || season.x + season.y <= 0) return;
    leavesRequested = true;
    import("./seasonal-leaf-fall").then(({ createSeasonalLeafFall }) => {
      leafFall = createSeasonalLeafFall(options.propInstances, meshes, uniforms, capacity, options.isPresent);
      group.add(leafFall.mesh);
    }).catch(error => console.warn("seasonal leaves", error));
  };

  /** One frame: start loading what the season needs, open/close the flowers, move the falling leaves. */
  const update = (flowerFade: number, focus: { time: number; x: number; z: number }) => {
    requestFlowers();
    requestLeaves();
    leafFall?.update(focus.x, focus.z, focus.time);
    if (!flowers) return;
    const shown = flowerFade > 0 && getSpringBloomRamp(season?.z ?? 0) > 0;
    flowers.fade.value = flowerFade;
    for (const prop of flowers.flowers) prop.mesh.visible = shown;
  };

  /** Whether a culled cover mesh belongs to the spring flowers (the map editor rebuilds them separately). */
  const isFlower = (prop: ChunkedPropMesh) => flowers?.flowers.includes(prop) === true;

  const replaceRegion = (region: CellRegion) => flowers?.replaceRegion(region);

  return { group, isFlower, replaceRegion, update };
};
