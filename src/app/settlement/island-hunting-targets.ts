import type { ResourceTarget } from "../../shared/settlement/settlement-types";
import type { createIslandAnimals } from "../island-animals";

type IslandAnimalManager = ReturnType<typeof createIslandAnimals>["manager"];

/** The same living population used by native hunting; pending spawns and carcasses are excluded. */
export const isLivingIslandAnimal = (manager: IslandAnimalManager, id: number) => manager.isLiving(id);

/**
 * Read-only, on-demand inspection snapshot (dormant animals at their routine pose included). Does
 * not spawn, reserve, move or wake animals.
 */
export const getIslandHuntingTargets = (manager: IslandAnimalManager): ResourceTarget[] =>
  manager.listHuntableSnapshot();
