import { DRINK_MAKER_TYPE_ID, DRINK_PRODUCER_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { addJapaneseDistillery, addNubianToddyMaker, addVikingMeadery, isPressVatPart } from "./nation-drink-makers";
import { addJapaneseRiceYard, addNubianPalmYard, addVikingApiaryYard } from "./nation-drink-producers";
import { getNationDrinkSign, replaceDrinkSign } from "./nation-drink-signs";
import { adder } from "./nation-tavern-designs";
import type { AddPart } from "./roman-resource-workshops";

type BuildNation = Exclude<WorkerNation, "roman">;

/** The Roman vine rows east of the Vineyard house (the house walls end at x 0.39). */
const isVineRowPart = (part: BuildingPart) => !part.stock && part.position[0] > 0.6;

const PRODUCER_YARDS: Record<BuildNation, (part: AddPart, detailed: boolean) => void> = {
  japanese: addJapaneseRiceYard, nubian: addNubianPalmYard, viking: addVikingApiaryYard
};
const MAKER_YARDS: Record<BuildNation, (part: AddPart, detailed: boolean) => void> = {
  japanese: addJapaneseDistillery, nubian: addNubianToddyMaker, viking: addVikingMeadery
};

/**
 * Nation drink chain work places (owner, 2026-10-13): slot 5 becomes the Viking apiary, Japanese
 * rice farm or Nubian palm grove, slot 6 the meadery, sake distillery or toddy maker. The nation
 * kit has already rebuilt the house; this swaps the Roman vine rows / press vat for the nation's
 * work yard and the facade pictogram. Plot, envelope, door, worker exit, work point and stock slots stay canonical.
 */
export const applyNationDrinkDesign = (recipe: BuildingRecipe, id: number, nation: BuildNation, detailed: boolean) => {
  if (id !== DRINK_PRODUCER_TYPE_ID && id !== DRINK_MAKER_TYPE_ID) return recipe;
  const producer = id === DRINK_PRODUCER_TYPE_ID;
  const parts = recipe.parts.filter(part => !(producer ? isVineRowPart(part) : isPressVatPart(part)));
  (producer ? PRODUCER_YARDS : MAKER_YARDS)[nation](adder(parts), detailed);
  return { ...recipe, parts: replaceDrinkSign(parts, getNationDrinkSign(id, nation)!) };
};
