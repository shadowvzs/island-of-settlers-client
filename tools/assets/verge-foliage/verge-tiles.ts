import type { VergeFoliageTileId } from "../../../src/render-common/road-verges/verge-foliage-atlas-layout";
import { type FoliageTileRecipe, paintElement, type TilePainter } from "../climber-foliage/foliage-canvas";
import { paintStem, type Point } from "../climber-foliage/stem-art";
import { GREEN_STALK, paintCloverFlower, paintDaisyHead, paintDandelionHead, paintFlowerStalk, paintGrassSeedhead,
  paintPlantainSpike, paintYarrowUmbel } from "./verge-flower-art";
import { daisyLeafElement, dandelionLeafElement, grassBladeElement, paintCloverLeaf, paintYarrowLeaf,
  plantainLeafElement, VERGE_PETIOLE } from "./verge-leaf-art";

const LEAF_PIVOT: Point = [0.5, 0.035];
const CENTRE: Point = [0.5, 0.5];

/** Plantain leaf with its channelled petiole: the blade starts a third of the way up. */
const paintPlantainLeaf = (painter: TilePainter, origin: Point, angle: number, length: number, salt: number) => {
  const insertion: Point = [origin[0] + Math.sin(angle) * length * 0.3, origin[1] + Math.cos(angle) * length * 0.3];
  paintStem(painter, { curve: [origin, [(origin[0] + insertion[0]) / 2, (origin[1] + insertion[1]) / 2], insertion],
    radius: [length * 0.019, length * 0.015], salt, shadow: 0.12, style: VERGE_PETIOLE });
  paintElement(painter, plantainLeafElement({ angle, length: length * 0.7, origin: insertion }, salt));
};

/** Radial rosette seen from above (Minimal whole-plant cards). */
const paintRosette = (painter: TilePainter, count: number, leaf: (angle: number, index: number) => void) => {
  for (let index = 0; index < count; index += 1) leaf(index / count * Math.PI * 2 + index * 0.37, index);
};

const paintFanOfBlades = (painter: TilePainter, salt: number) => {
  for (let blade = 0; blade < 9; blade += 1) {
    const spread = (blade - 4) / 4;
    paintElement(painter, grassBladeElement({ angle: spread * 0.42, length: 0.8 + 0.14 * Math.cos(blade * 1.7),
      origin: [0.5 + spread * 0.04, 0.035] }, 0.05, -spread * 0.12, salt + blade));
  }
};

const paintDaisyClump = (painter: TilePainter, salt: number) => {
  for (const [index, angle] of [-0.9, -0.45, 0.4, 0.85].entries()) {
    paintElement(painter, daisyLeafElement({ angle, length: 0.36, origin: [0.5, 0.04] }, salt + index));
  }
  for (const [index, [x, top]] of ([[0.3, 0.68], [0.55, 0.8], [0.74, 0.6]] as const).entries()) {
    paintStem(painter, { curve: [[0.5, 0.04], [(0.5 + x) / 2, top * 0.5], [x, top]], radius: [0.012, 0.009],
      salt: salt + index, shadow: 0.1, style: GREEN_STALK });
    paintDaisyHead(painter, [x, top + 0.04], 0.1, salt + index * 3);
  }
};

/** Painter and attachment pivot of every verge tile, in the order of VERGE_FOLIAGE_TILES. */
export const VERGE_TILE_RECIPES: Record<VergeFoliageTileId, FoliageTileRecipe> = {
  "plantain-leaf": { paint: painter => paintPlantainLeaf(painter, LEAF_PIVOT, 0, 0.93, 11), pivot: LEAF_PIVOT },
  "plantain-spike": { paint: painter => paintPlantainSpike(painter, 23), pivot: LEAF_PIVOT },
  "dandelion-leaf": { paint: painter => paintElement(painter, dandelionLeafElement({ angle: 0, length: 0.93,
    origin: LEAF_PIVOT }, 31)), pivot: LEAF_PIVOT },
  "dandelion-head": { paint: painter => paintDandelionHead(painter, CENTRE, 0.46, 41), pivot: CENTRE },
  "flower-stalk": { paint: painter => paintFlowerStalk(painter, 47), pivot: LEAF_PIVOT },
  "clover-leaf": { paint: painter => paintCloverLeaf(painter, LEAF_PIVOT, [0.5, 0.56], 0.3, 53), pivot: LEAF_PIVOT },
  "clover-flower": { paint: painter => paintCloverFlower(painter, [0.5, 0.66], 0.28, 59), pivot: LEAF_PIVOT },
  "grass-blades": { paint: painter => paintFanOfBlades(painter, 61), pivot: LEAF_PIVOT },
  "grass-seedhead": { paint: painter => paintGrassSeedhead(painter, 67), pivot: LEAF_PIVOT },
  "daisy-head": { paint: painter => paintDaisyHead(painter, CENTRE, 0.46, 71), pivot: CENTRE },
  "daisy-leaf": { paint: painter => paintElement(painter, daisyLeafElement({ angle: 0, length: 0.93,
    origin: LEAF_PIVOT }, 73)), pivot: LEAF_PIVOT },
  "yarrow-leaf": { paint: painter => paintYarrowLeaf(painter, { angle: 0, length: 0.9, origin: LEAF_PIVOT }, 79),
    pivot: LEAF_PIVOT },
  "yarrow-umbel": { paint: painter => paintYarrowUmbel(painter, 83), pivot: CENTRE },
  "plantain-rosette": { paint: painter => paintRosette(painter, 7, (angle, index) =>
    paintPlantainLeaf(painter, CENTRE, angle, 0.4 + 0.03 * (index % 3), 89 + index)), pivot: CENTRE },
  "dandelion-rosette": { paint: painter => {
    paintRosette(painter, 9, (angle, index) => paintElement(painter, dandelionLeafElement({ angle,
      length: 0.42 + 0.04 * (index % 2), origin: CENTRE }, 97 + index)));
    paintDandelionHead(painter, CENTRE, 0.12, 101);
  }, pivot: CENTRE },
  "daisy-clump": { paint: painter => paintDaisyClump(painter, 103), pivot: LEAF_PIVOT }
};
