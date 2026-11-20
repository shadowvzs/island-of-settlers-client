import { createCacaoTreeMesh } from "./cacao-tree";
import type { DrinkCropFrame } from "./drink-crop-stages";
import { createPomegranateTreeMesh } from "./pomegranate-tree";
import { createTeaBerryPlantMesh } from "./tea-berry-plants";

export type NationalDrinkPlant = "tea" | "pomegranate" | "cacao" | "berries";
export type NationalPlantStage = "young" | "leafy" | "fruiting" | "ripe" | "picked";

/** One canonical authored crop for fields and the corresponding national workshop. */
export const createNationalDrinkPlantMesh = (kind: NationalDrinkPlant, stage: NationalPlantStage,
  detailed: boolean) => {
  if (kind === "cacao") return createCacaoTreeMesh(stage, detailed);
  if (kind === "pomegranate") return createPomegranateTreeMesh(stage, detailed);
  return createTeaBerryPlantMesh(kind, stage, detailed);
};

/** `step=1` remembers an established plant while its next harvest follows the vine's maintenance cycle. */
export const getNationalDrinkPlantStage = (frame: DrinkCropFrame): NationalPlantStage => {
  if (frame.state === "stubble" || (frame.harvest ?? 0) > .8) return "picked";
  if (frame.state === "ripe") return (frame.harvest ?? 0) > .45 ? "fruiting" : "ripe";
  if (!frame.step && frame.progress < .35) return "young";
  return frame.progress > .65 ? "fruiting" : "leafy";
};
