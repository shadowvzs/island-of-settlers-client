import { createAnimalManager } from "../render-common/wildlife/animal-manager";
import type { AnimalManagerOptions } from "../render-common/wildlife/manager/animal-manager-state";
import type { AnimalSaveState } from "../render-common/wildlife/manager/animal-save";
import type { NavWorld } from "../render-common/wildlife/nav/nav-query";
import { DMath } from "../shared/math/deterministic-math";
import type { AuthoredAnimal } from "../shared/world/authored-animals";
import type { WorldData } from "../shared/world/world-data";

/** Felling noise: animals nearby become alert, close ones flee. */
const FELLING_THREAT = 0.65;

/**
 * The island's animals for the app (always shown: they are hunted later): felling hooks (the
 * region loses a tree, the axe scares nearby animals) and the info box line. The navigation is built
 * in a loading worker (pool-builders islandNav). `options.isMatureTree` tells the wildlife which
 * tree props stand mature (felling and growth state).
 */
export const createIslandAnimals = (
  world: WorldData,
  nav: NavWorld,
  saved?: AnimalSaveState,
  authored: readonly AuthoredAnimal[] = [],
  options: AnimalManagerOptions = {}
) => {
  const manager = createAnimalManager(world, nav, saved, authored, options);

  const onTreeFelled = (tree: number) => {
    manager.onTreeFelled(tree);
    const position = { x: world.props.x[tree]!, z: world.props.z[tree]! };
    manager.onThreat({ intensity: FELLING_THREAT, position });
  };

  /** Kills the living animal nearest to (x, z) (debug / scripted views); its slot or -1. */
  const killNearest = (x: number, z: number) => {
    let nearest = -1;
    let best = Infinity;
    for (const animal of manager.listLiving()) {
      const distance = DMath.hypot(animal.x - x, animal.z - z);
      if (distance >= best) continue;
      best = distance;
      nearest = animal.id;
    }
    if (nearest >= 0) manager.killAnimal(nearest);
    return nearest;
  };

  return {
    describe: () =>
      `${manager.countDrawn()} / ${manager.countAlive()} in ${manager.countHomeRegions()} regions`,
    killNearest,
    manager,
    onAnimalFled: manager.onAnimalFled,
    onAnimalKilled: manager.onAnimalKilled,
    onTreeFelled,
    update: manager.update
  };
};
