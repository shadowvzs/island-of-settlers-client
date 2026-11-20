import { HEIGHT_TO_V } from "../src/render-common/birds/bird-view";
import { createCamera } from "../src/render-common/camera-state";
import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import {
  createCritterManager,
  type CritterManagerOptions
} from "../src/render-common/critters/critter-manager";
import { computeEnvironment } from "../src/render-common/environment";
import { createClearFog, getIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { sampleSkinSurface } from "../src/render-common/rocks/rock-skin";
import { createWorldRockTerrain } from "../src/render-common/rocks/rock-terrain";
import { createSkinFields } from "../src/render-common/rocks/skin-relief";
import { createRockColliders } from "../src/render-common/wildlife/nav/world-colliders";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { FOG, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

type CritterTheme = "meadow" | "snowy";

/** Generation options of the critter tests' world (preload them with `preloadWorlds`). */
export const critterWorldOptions = (seed = 1234, theme: CritterTheme = "meadow") => ({
  ...DEFAULT_WORLD_OPTIONS,
  cellsX: 128,
  cellsZ: 128,
  erosionDroplets: 6000,
  rivers: 2,
  seed,
  theme
});

/** A small river island with the fog lifted (the critter tests' world). */
export const createCritterWorld = (seed = 1234, theme: CritterTheme = "meadow") => {
  const world = cachedWorld(critterWorldOptions(seed, theme));
  world.fog.fill(FOG.visible);
  return world;
};

/** A hoof may sink this far into the rendered skin (world units). */
const HOOF_DEPTH = 0.1;
/**
 * Inside the rendered rock, measured independently of the critters' cover grid: the sculpted
 * skin's surface above the ground, or a placed rock's footprint.
 */
export const createRockVolume = (world: WorldData) => {
  const terrain = createWorldRockTerrain(world, createClearFog(world));
  const fields = createSkinFields(world.seed);
  const circles = getIslandRocks(world, terrain).flatMap(createRockColliders);
  return (x: number, z: number) => {
    const skin = sampleSkinSurface(terrain, fields, x, z)[1] - terrain.height(x, z);
    if (skin > HOOF_DEPTH) return true;
    return circles.some((circle) => Math.hypot(circle.x - x, circle.z - z) < circle.radius);
  };
};

export const colonyIndex = (name: string) =>
  CRITTER_COLONIES.findIndex((colony) => colony.name === name);

/**
 * A camera that shows the ground point (x, z) in the middle of the screen: its height lifts it
 * up the screen, so the camera centre (a point at height 0) moves towards the viewer.
 */
export const createView = (world: WorldData, x: number, z: number, zoom = 2) => {
  const height = Math.max(0, sampleSmooth(world, world.heights, x, z));
  const shift = (height * HEIGHT_TO_V) / Math.SQRT2;
  const camera = createCamera(x - shift, z - shift, zoom);
  camera.viewportWidth = 1600;
  camera.viewportHeight = 900;
  return camera;
};

interface RecordedFrame {
  count: number;
  species: number[];
  x: number[];
  y: number[];
  z: number[];
}

/** Runs the critters around a point for `seconds` and records every frame. */
export const runAt = (
  target: WorldData,
  x: number,
  z: number,
  seconds: number,
  hour = 12,
  options: CritterManagerOptions = {}
) => {
  const manager = createCritterManager(target, options);
  const camera = createView(target, x, z);
  const environment = computeEnvironment(target.sun, hour, 0);
  const frames: RecordedFrame[] = [];
  for (let time = 0; time <= seconds; time += 1 / 30) {
    const frame = manager.update(time, camera, environment);
    frames.push({
      count: frame.count,
      species: Array.from(frame.species.subarray(0, frame.count)),
      x: Array.from(frame.x.subarray(0, frame.count)),
      y: Array.from(frame.y.subarray(0, frame.count)),
      z: Array.from(frame.z.subarray(0, frame.count))
    });
  }
  return { frames, manager };
};
