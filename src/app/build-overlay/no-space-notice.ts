import { getNationBuildingDefinition } from "../../render-common/buildings/nation-building-text";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { normalizeTurns } from "../settlement/building-plot";
import type { FitSelection } from "./building-fit-spots";

/**
 * The notice when the selected building fits nowhere in the territory (nation-aware name). Mines
 * only fit on a free surveyed deposit, so they ask for a survey instead of space.
 */
export const noSpaceMessage = (typeId: number, nation: WorkerNation) => {
  const building = getNationBuildingDefinition(typeId, nation);
  if (building.style === "mine")
    return `No free surveyed deposit for ${building.name}: send a Geologist to survey one first`;
  return `No space for ${building.name} in your territory`;
};

/** Tells "no space" once per selected building and footprint orientation. */
export const createNoSpaceNotice = (notify: (typeId: number) => void) => {
  let typeId = -1;
  const told = new Set<number>();
  return (selection: FitSelection | null, noSpace: boolean) => {
    if (selection?.typeId !== typeId) { typeId = selection?.typeId ?? -1; told.clear(); }
    if (!selection || !noSpace) return;
    const orientation = normalizeTurns(selection.rotation) % 2;
    if (told.has(orientation)) return;
    told.add(orientation);
    notify(selection.typeId);
  };
};
