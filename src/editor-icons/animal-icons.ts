import { createSheetCell, VIEWS } from "../animal-showcase/sheet-layouts";
import { createSheetRenderer } from "../animal-showcase/sheet-renderer";
import type { AnimalModels } from "../render-common/wildlife/model/animal-asset-loader";
import { LIFE_STAGE } from "../render-common/wildlife/wildlife-stages";

/**
 * Animal icons with the game's animal layer (the showcase sheet renderer: same models, rig, fur
 * material and sun shadows): an adult (as the editor places it) in a three quarter view.
 */
export const createAnimalIcons = (animals: AnimalModels) => {
  const canvas = document.createElement("canvas");
  const sheet = createSheetRenderer(canvas, animals);
  return {
    renderAnimal: (species: number) => {
      const cell = createSheetCell(species, LIFE_STAGE.adult, {
        antlers: 1,
        view: VIEWS.threeQuarter
      });
      sheet.render([[cell]]);
      return canvas;
    }
  };
};
