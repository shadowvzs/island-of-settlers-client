import type { ClimberFoliageTileId } from "../../../src/render-common/plants/climber-foliage-atlas-layout";
import type { UvPoint } from "../../../src/render-common/plants/foliage-atlas-layout";
import { type FoliageTileRecipe, IDENTITY_PLACEMENT, paintElement, type TilePainter } from "./foliage-canvas";
import { paintIvyCluster, paintIvyLeaf } from "./ivy-art";
import { BUD_PIVOT, paintOpenRose, paintRoseBloomCluster, paintRoseBud, paintRoseCalyx } from "./rose-flower-art";
import { paintCompoundLeaf, paintRoseLeafSpray, roseLeafletElement, TINTED_ROSE_LEAF } from "./rose-leaf-art";
import { petalElement, TINTED_PETAL } from "./rose-petal-art";
import { paintStem } from "./stem-art";

const LEAF_PIVOT: UvPoint = [0.5, 0.035];
const CENTRE: UvPoint = [0.5, 0.5];

const paintSingleLeaflet = (painter: TilePainter) => {
  paintElement(painter, roseLeafletElement({ frame: { angle: 0.03, length: 0.86, origin: [0.5, 0.1] }, salt: 211,
    style: TINTED_ROSE_LEAF, teeth: 26, width: 0.31 }));
  paintStem(painter, { curve: [[0.5, 0.035], [0.5, 0.07], [0.502, 0.115]], radius: [0.012, 0.009], salt: 211,
    style: { base: TINTED_ROSE_LEAF.base, roughness: 0.5, tint: 1, translucency: 0.3 }, shadow: 0 });
};

const paintPetal = (painter: TilePainter, inner: boolean) => paintElement(painter, petalElement({
  clawFade: inner ? 0.75 : 1, cup: inner ? 0.1 : 0.035, depth: inner ? 0.22 : 0.05,
  frame: { angle: 0, length: inner ? 0.7 : 0.92, origin: [0.5, inner ? 0.12 : 0.04] }, salt: inner ? 307 : 301,
  shadow: 0, style: TINTED_PETAL, width: inner ? 0.6 : 0.48
}));

/** Painter and attachment pivot of every tile, in the order of CLIMBER_FOLIAGE_TILES. */
export const FOLIAGE_TILE_RECIPES: Record<ClimberFoliageTileId, FoliageTileRecipe> = {
  "rose-compound-leaf-5": { paint: painter => paintCompoundLeaf(painter, { angle: 0, leaflets: 5, length: 0.93,
    origin: LEAF_PIVOT, salt: 11, style: TINTED_ROSE_LEAF }), pivot: LEAF_PIVOT },
  "rose-compound-leaf-7": { paint: painter => paintCompoundLeaf(painter, { angle: 0, leaflets: 7, length: 0.93,
    origin: LEAF_PIVOT, salt: 23, style: TINTED_ROSE_LEAF }), pivot: LEAF_PIVOT },
  "rose-leaflet": { paint: paintSingleLeaflet, pivot: LEAF_PIVOT },
  "rose-petal-outer": { paint: painter => paintPetal(painter, false), pivot: [0.5, 0.04] },
  "rose-petal-inner": { paint: painter => paintPetal(painter, true), pivot: [0.5, 0.12] },
  "rose-bud": { paint: painter => paintRoseBud(painter, { ...IDENTITY_PLACEMENT, origin: BUD_PIVOT,
    pivot: BUD_PIVOT }, 401), pivot: BUD_PIVOT },
  "rose-calyx": { paint: painter => paintRoseCalyx(painter, 503), pivot: CENTRE },
  "rose-open-head": { paint: painter => paintOpenRose(painter, IDENTITY_PLACEMENT, 601), pivot: CENTRE },
  "ivy-juvenile-3-lobed": { paint: painter => paintIvyLeaf(painter, "juvenile-3", 701), pivot: LEAF_PIVOT },
  "ivy-juvenile-5-lobed": { paint: painter => paintIvyLeaf(painter, "juvenile-5", 709), pivot: LEAF_PIVOT },
  "ivy-adult-cordate": { paint: painter => paintIvyLeaf(painter, "adult", 719), pivot: LEAF_PIVOT },
  "ivy-cluster-4": { paint: painter => paintIvyCluster(painter, 4, 811), pivot: [0.5, 0.03] },
  "ivy-cluster-7": { paint: painter => paintIvyCluster(painter, 7, 823), pivot: [0.5, 0.03] },
  "rose-leaf-spray": { paint: painter => paintRoseLeafSpray(painter, 907), pivot: [0.5, 0.03] },
  "rose-bloom-cluster": { paint: painter => paintRoseBloomCluster(painter, 1009), pivot: [0.5, 0.03] },
  reserved: { paint: () => undefined, pivot: CENTRE }
};
