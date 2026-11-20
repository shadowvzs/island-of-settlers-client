import { type IUniform, Scene, type Vector2 } from "three";

import { createVertexFog } from "../../render-common/chunk-sampling";
import { profileStep } from "../../render-common/load-profile";
import type { PresentationScheduler } from "../../render-common/presentation-scheduler";
import type { RendererInput } from "../../render-common/renderer-contract";
import { buildWaterWeeds } from "../../render-common/water/water-weeds";
import { buildWaterfallMesh } from "../../render-common/water/waterfall-mesh";
import { isLedgeFall } from "../../shared/world/generation/river-falls";
import type { Waterfall } from "../../shared/world/world-data";
import { type AnimalDrawOptions, createThreeAnimals } from "./three-animals";
import { createThreeBirds } from "./three-birds";
import { createThreeButterflies } from "./three-butterflies";
import { createThreeCameraRig } from "./three-camera";
import { createThreeClouds } from "./three-clouds";
import { createThreeCritters } from "./three-critters";
import { createThreeFishSchools } from "./three-fish-schools";
import { createThreeRain } from "./three-rain";
import { createThreeRipples } from "./three-ripples";
import { createThreeWaterWeeds } from "./three-water-weeds";
import { createThreeWaterfalls } from "./three-waterfalls";
import { createThreeWhales, type WhaleDrawOptions } from "./three-whales";

type AmbientInput = Pick<RendererInput, "animals" | "world"> & {
  /** Animal coat detail and season (preset and cosmetic winter). */
  animalDraw: AnimalDrawOptions;
  background: number;
  /** Most fish of the FISH-SCHOOLS layer (0: none, e.g. presets without the refraction capture). */
  fishSchools: number;
  groundHeight: (x: number, z: number) => number;
  /** Spray mist over the small cascade ledges too (off on Minimal: mist only at real waterfalls). */
  ledgeMist: boolean;
  onLightning?: () => void;
  /** Leftover frame time: critter species met after the first frame build there. */
  presentation: PresentationScheduler;
  scene: Scene;
  shadowScene: Scene;
  uniforms: Record<string, IUniform>;
  viewport: Vector2;
  /** The decorative whale's detail (QualityPreset.whales) and whether it casts a sun shadow. */
  whales: WhaleDrawOptions;
};

/** The falls that throw spray mist: all of them, or only the real waterfalls (no cascade ledges). */
const getMistFalls = (falls: Waterfall[], ledgeMist: boolean) =>
  ledgeMist ? falls : falls.filter((fall) => !isLedgeFall(fall));

/**
 * Nature drawn outside the main scene: waterfalls, underwater weeds, weather, wildlife and the
 * camera rig that frames them.
 */
export const createRendererAmbient = ({
  animalDraw,
  animals: animalModels,
  background,
  fishSchools: fishBudget,
  groundHeight,
  ledgeMist,
  onLightning,
  presentation,
  scene,
  shadowScene,
  uniforms,
  viewport,
  whales: whaleDraw,
  world
}: AmbientInput) => {
  /** Waterfalls draw after the scene (transparent, not in the refraction pass). */
  const waterfalls = profileStep("three waterfalls", () =>
    createThreeWaterfalls(buildWaterfallMesh(world), getMistFalls(world.waterfalls, ledgeMist), uniforms)
  );
  waterfalls.group.visible = world.waterfalls.length > 0;
  const waterfallScene = new Scene().add(waterfalls.group);
  /** Underwater weeds draw only into the refraction pass (seen through the water). */
  const weeds = profileStep("three water weeds", () =>
    createThreeWaterWeeds(buildWaterWeeds(world, createVertexFog(world)), uniforms)
  );
  const weedScene = new Scene().add(weeds.mesh);
  /** Fish likewise draw only into the refraction pass (seen through the water, never above it). */
  const fishSchools = fishBudget > 0
    ? profileStep("three fish schools", () =>
      createThreeFishSchools(world, uniforms, fishBudget, animalDraw.visualWinter))
    : null;
  if (fishSchools) weedScene.add(...fishSchools.meshes);
  const cameraRig = createThreeCameraRig(groundHeight);
  const rain = createThreeRain(uniforms, viewport, onLightning);
  const clouds = createThreeClouds(uniforms, background);
  scene.add(clouds.root);
  /** Birds draw after the scene: never in the refraction pass, still in the sun shadows. */
  const birds = profileStep("three birds", () => createThreeBirds(uniforms));
  const butterflies = profileStep("three butterflies", () => createThreeButterflies(uniforms));
  /** Critters and their water rings likewise (after the water: it hides what is under it). */
  const critters = profileStep("three critters", () =>
    createThreeCritters(uniforms, animalDraw.visualWinter, !animalDraw.furDetail, presentation)
  );
  const ripples = createThreeRipples(uniforms);
  /** The rare whale (hidden between its surfacings) and its water, likewise after the water. */
  const whales = profileStep("three whales", () => createThreeWhales(uniforms, world, whaleDraw));
  const birdScene = new Scene().add(birds.mesh, butterflies.mesh, ...critters.meshes, ripples.mesh,
    ...whales.meshes);
  shadowScene.add(birds.caster, butterflies.caster, ...critters.casters, ...whales.casters);
  /** Animals likewise stay out of the refraction pass (they never stand in water). */
  const animals = profileStep("three animals", () =>
    createThreeAnimals(uniforms, animalModels, animalDraw)
  );
  const animalScene = new Scene().add(...animals.meshes);
  return {
    animals, animalScene, birdScene, birds, butterflies, cameraRig, clouds, critters, fishSchools, rain, ripples,
    waterfallScene, waterfalls, weeds, weedScene, whales
  };
};
