import { createBirdManager } from "../render-common/birds/bird-manager";
import { createButterflyManager } from "../render-common/butterflies/butterfly-manager";
import type { CameraState } from "../render-common/camera-state";
import { createCritterManager } from "../render-common/critters/critter-manager";
import { createIslandHomes } from "../render-common/island-homes";
import { profileStep } from "../render-common/load-profile";
import type { TerrainRenderer } from "../render-common/renderer-contract";
import type { createWorkerGroup } from "../render-common/workers/worker-group";
import type { LoadedGameSave } from "../shared/settlement/game-save";
import type { CellRegion } from "../shared/world/grid-geometry";
import type { WorldData } from "../shared/world/world-data";
import { createIslandSound } from "./audio/island-sound";
import type { createEnvironmentController } from "./environment-controller";
import { createIslandAnimals } from "./island-animals";
import { connectWildlifeCollision } from "./island-collision";
import { connectCritterDebugHook, connectCritterSetting } from "./island-critters";
import { connectIslandDisturbance } from "./island-disturbance";
import { createIslandFelling } from "./island-felling";
import { createIslandGrowth } from "./island-growth";
import { removeHarvestedTree } from "./island-tree-removal";
import type { StartMap } from "./map-editor/map-startup";
import { createNavDebugOverlay } from "./nav-debug/nav-debug-overlay";
import type { GameRuntimeState } from "./settlement/game-session";
import type { IslandSettlement } from "./settlement/island-settlement";

interface IslandWildlifeOptions {
  camera: CameraState;
  environment: ReturnType<typeof createEnvironmentController>;
  getSettlement: () => IslandSettlement | undefined;
  minimap: { refresh: () => void };
  nav: Parameters<typeof createIslandAnimals>[1];
  navDebug: boolean;
  renderer: TerrainRenderer;
  restoredGame: LoadedGameSave | null;
  startMap: StartMap | null;
  viewport: HTMLElement;
  workers: ReturnType<typeof createWorkerGroup>;
  world: WorldData;
}

/**
 * The island's living layers: animals, birds, butterflies, critters, ambient sound, tree growth and felling,
 * restored from a saved runtime, plus the animal homes and the Playwright wildlife hooks.
 */
export const createIslandWildlife = (options: IslandWildlifeOptions) => {
  const {
    camera, environment, getSettlement, minimap, nav, navDebug, renderer, restoredGame, startMap, viewport, workers,
    world
  } = options;
  const isMatureTree = (id: number) => felling.isStanding(id) && !growth.isGrowing(id);
  const animals = profileStep("animals (habitat, population)", () =>
    createIslandAnimals(world, nav, (restoredGame?.runtime as GameRuntimeState | undefined)?.animals,
      startMap?.loaded?.animals ?? [], { isMatureTree })
  );
  const birds = profileStep("birds", () => createBirdManager(world, {
    getBuildings: () => getSettlement()?.simulation.buildings() ?? [],
    getBuildingNation: () => getSettlement()?.simulation.playerNation() ?? "roman"
  }));
  const butterflies = profileStep("butterflies", () =>
    createButterflyManager(world, birds.habitat)
  );
  const critters = profileStep("critters", () =>
    createCritterManager(world, {
      getWorkers: () => workers.frames.filter((frame) => frame.visible !== false),
      habitat: birds.habitat,
      getBuildings: () => getSettlement()?.simulation.buildings() ?? [],
      getBuildingNation: () => getSettlement()?.simulation.playerNation() ?? "roman",
      isTreeStanding: (id) => felling.isStanding(id),
      nav
    })
  );
  void renderer.prepareCritters?.(critters.presentSpecies());
  /** A map edit can give a colony new homes: their species load before they are met. */
  const critterHomes = {
    refreshHomes: (cells: CellRegion) => {
      critters.refreshHomes(cells);
      void renderer.prepareCritters?.(critters.presentSpecies());
    }
  };
  const fish = { setEnabled: (enabled: boolean) => renderer.setFishSchoolsEnabled?.(enabled) };
  const whales = { setEnabled: (enabled: boolean) => renderer.setWhalesEnabled?.(enabled) };
  const critterSetting = connectCritterSetting({ birds, butterflies, critters, fish, whales });
  const disposeCritterHooks = connectCritterDebugHook(critters, renderer);
  connectWildlifeCollision(workers, animals.manager, critters);
  const sound = profileStep("sound", () =>
    createIslandSound({ camera, getHour: () => environment.getControls().hour, world })
  );
  const growth = createIslandGrowth(world, (id) => felling.isStanding(id));
  growth.onGrown(animals.manager.onTreeGrown);
  const felling = createIslandFelling({
    camera,
    canFell: (id) => !growth.isGrowing(id),
    isGrown: growth.isGrown,
    onFelled: connectIslandDisturbance({ animals, birds, critters, sound, world }),
    onRemoved: (id) => {
      const region = removeHarvestedTree(world, renderer, id);
      growth.remove([id]);
      homes.noteProps([id]);
      if (region) homes.refresh(region);
      minimap.refresh();
    },
    project: renderer.projectToViewport,
    world
  });
  if (restoredGame?.runtime) {
    const runtime = restoredGame.runtime as GameRuntimeState;
    growth.loadState(runtime.growth); felling.loadState(runtime.felling);
    if (runtime.environment) environment.loadState(runtime.environment);
    if (runtime.viewMode) renderer.setViewMode(runtime.viewMode);
    const { centerX, centerZ, tilt, yaw, zoom } = runtime.camera;
    Object.assign(camera, { centerX, centerZ, zoom, yaw, tilt });
  }
  if (import.meta.env.DEV) window.__fellNearestTree = felling.fellNearest;
  if (import.meta.env.DEV)
    window.__killNearestAnimal = () => animals.killNearest(camera.centerX, camera.centerZ);
  if (import.meta.env.DEV)
    window.__threatAnimals = (x, z, intensity) =>
      animals.manager.onThreat({ intensity, position: { x, z } });
  if (import.meta.env.DEV) window.__listAnimals = () =>
    animals.manager.listLiving().map(({ species, x, z }) => ({ species, x, z }));
  if (import.meta.env.DEV) window.__wildlife = animals.manager;
  const navOverlay = navDebug
    ? createNavDebugOverlay(viewport, animals.manager, camera, renderer.projectToViewport)
    : null;
  const homes = createIslandHomes({
    animals: animals.manager,
    birds,
    butterflies,
    critters: critterHomes,
    isTreeStanding: felling.isStanding,
    world
  });
  if (import.meta.env.DEV) window.__homesStats = homes.stats;
  return {
    animals,
    birds,
    butterflies,
    critterSetting,
    critters,
    dispose: () => {
      navOverlay?.dispose();
      disposeCritterHooks();
      sound.dispose();
      if (import.meta.env.DEV) {
        delete window.__fellNearestTree;
        delete window.__killNearestAnimal;
        delete window.__threatAnimals;
        delete window.__listAnimals;
        delete window.__wildlife;
        delete window.__homesStats;
      }
    },
    felling,
    growth,
    homes,
    sound
  };
};
