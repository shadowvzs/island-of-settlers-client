import { VERGE_FOLIAGE_ATLAS } from "../../../render-common/road-verges/verge-foliage-atlas-manifest";
import { createFoliageAtlasAcquirer } from "./foliage-atlas-loader";

/** Shared, reference-counted road-verge foliage maps (card V-R02a) for High (`detailed`) or Minimal. */
export const acquireVergeFoliageAtlas = createFoliageAtlasAcquirer({
  high: {
    albedo: new URL("../../../../assets/textures/decorations/verge-foliage-high-albedo.ktx2", import.meta.url),
    normal: new URL("../../../../assets/textures/decorations/verge-foliage-high-normal.ktx2", import.meta.url),
    orm: new URL("../../../../assets/textures/decorations/verge-foliage-high-orm.ktx2", import.meta.url)
  },
  minimal: {
    albedo: new URL("../../../../assets/textures/decorations/verge-foliage-minimal-albedo.ktx2", import.meta.url),
    normal: null,
    orm: new URL("../../../../assets/textures/decorations/verge-foliage-minimal-orm.ktx2", import.meta.url)
  }
}, VERGE_FOLIAGE_ATLAS.tiles);
