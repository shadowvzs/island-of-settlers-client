import { paintGround } from "../shared/world/editing/ground-paint";
import { plantTownCherries } from "../shared/world/editing/town-cherries";
import { setFogDisplay } from "../shared/world/fog-display";
import { applyExpeditionWorldTheme } from "../shared/world/generation/expedition-world-themes";
import { GROUND_VARIANT_COUNT, TILLED_SOIL_VARIANT, toGroundVariantTile } from "../shared/world/ground-variants";
import { FOG, type WorldData } from "../shared/world/world-data";
import type { AppParams } from "./app-params";
import { plantGarden } from "./plant-garden";

/**
 * Cache group of this island: everything that shapes its world and builds. The nation is part of it for a
 * generated home island (its homeland landscape affinity, NATION-TERRAIN).
 */
export const toIslandCacheGroup = (
  params: AppParams,
  fog: boolean,
  revealOre: boolean,
  map: string | null,
  nation?: string
) =>
  JSON.stringify({
    fog,
    garden: params.garden,
    island: params.island,
    map,
    ...(nation === undefined ? {} : { nation }),
    seed: params.seed,
    revealOre
  });

/** Dev review: a round patch of tilled garden soil, as the map editor's brush paints it. */
const paintTilledPatch = (world: WorldData, { radius, x, z }: { radius: number; x: number; z: number }) => {
  world.groundVariants ??= new Uint8Array(world.heights.length * GROUND_VARIANT_COUNT);
  paintGround(world, { material: toGroundVariantTile(TILLED_SOIL_VARIANT), radius, softness: 0.5, strength: 1, x, z });
};

export const prepareIslandWorld = (
  world: WorldData, params: AppParams, fog: boolean, revealOre: boolean, nation?: string
) => {
  setFogDisplay(world, fog);
  if (world.expeditionKind) world.fog.fill(FOG.visible);
  // Reveal ore is a reversible Development presentation override: keep the real survey flags
  // for saves and restore them when the switch is turned off again.
  if (world.surveyedBeforeReveal) {
    for (const [id, surveyed] of world.surveyedBeforeReveal) {
      const zone = world.mineZones.find(entry => entry.id === id);
      if (zone) zone.surveyed = surveyed;
    }
    delete world.surveyedBeforeReveal;
  }
  if (revealOre) {
    // Non-enumerable: this is a runtime presentation snapshot, not part of the world payload
    // compared and serialized by the map/save formats.
    Object.defineProperty(world, "surveyedBeforeReveal", {
      configurable: true,
      enumerable: false,
      value: world.mineZones.map(zone => [zone.id, zone.surveyed] as [number, boolean]),
      writable: true
    });
    world.mineZones.forEach(zone => { zone.surveyed = true; });
  }
  if (params.garden) plantGarden(world);
  if (params.groundPalette) world.groundPalette = { ...world.groundPalette, ...params.groundPalette };
  if (params.tilledPatch) paintTilledPatch(world, params.tilledPatch);
  if (params.expeditionTheme && !world.expeditionKind) {
    applyExpeditionWorldTheme(world, params.expeditionTheme, "adventure");
  }
  if (nation && !world.expeditionKind) plantTownCherries(world, nation);
};
