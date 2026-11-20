import type {
  ScriptNatureListener, ScriptNatureSource
} from "../../shared/script-world/nature/nature-source";
import type { createIslandAnimals } from "../island-animals";
import type { createIslandGrowth } from "../island-growth";

/**
 * The island's nature managers as the map script's source (TRG3b): the wildlife slots, removals and tree growth
 * stages are forwarded to the listener the island's script adapter registers. Built by `createIslandResources`,
 * so the client island and the server bundle's headless island wire the same source.
 */
export const createIslandScriptNature = (
  animals: ReturnType<typeof createIslandAnimals>, growth: ReturnType<typeof createIslandGrowth>
): ScriptNatureSource => {
  const { manager } = animals;
  let listener: ScriptNatureListener | undefined;
  manager.onAnimalRemoved(slot => listener?.animalRemoved(slot));
  growth.onStage((id, stage) => listener?.treeStage(id, stage));
  const { pinCells, ...wildlife } = manager.script;
  return {
    listen: next => { listener = next; },
    pinWildlife: pinCells,
    wildlife
  };
};
