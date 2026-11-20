import { CLIMBER_FOLIAGE_ATLAS } from "../../../render-common/plants/climber-foliage-atlas-manifest";
import { createFoliageAtlasAcquirer } from "./foliage-atlas-loader";

/** Shared, reference-counted climber foliage maps (card D04a) for High (`detailed`) or Minimal. */
export const acquireClimberFoliageAtlas = createFoliageAtlasAcquirer({
  high: {
    albedo: new URL("../../../../assets/textures/decorations/climber-foliage-high-albedo.ktx2", import.meta.url),
    normal: new URL("../../../../assets/textures/decorations/climber-foliage-high-normal.ktx2", import.meta.url),
    orm: new URL("../../../../assets/textures/decorations/climber-foliage-high-orm.ktx2", import.meta.url)
  },
  minimal: {
    albedo: new URL("../../../../assets/textures/decorations/climber-foliage-minimal-albedo.ktx2", import.meta.url),
    normal: null,
    orm: new URL("../../../../assets/textures/decorations/climber-foliage-minimal-orm.ktx2", import.meta.url)
  }
}, CLIMBER_FOLIAGE_ATLAS.tiles);
