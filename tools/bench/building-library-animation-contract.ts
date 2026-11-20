import { MONUMENT_TYPE_ID } from "../../src/render-common/buildings/monument-definition";

/** Compare exported clips with every native model, including its actual flag and equipment clips. */
export const buildingLibraryAnimationNames = (nation: string,
  buildings: readonly { id: number; clips: readonly string[] }[]) => buildings.flatMap(building => {
  if (building.id === MONUMENT_TYPE_ID) {
    if (building.clips.length) throw new Error("The Monument library model must remain static");
  } else if (["construction", "door", "working"].some(name => !building.clips.includes(name)))
    throw new Error(`Building ${building.id} is missing a required native animation`);
  if (new Set(building.clips).size !== building.clips.length)
    throw new Error(`Building ${building.id} has duplicate animation names`);
  return building.clips.map(name => `${nation}_${building.id}_${name}`);
});
