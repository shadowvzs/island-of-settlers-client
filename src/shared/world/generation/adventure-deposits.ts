import { BUILD, MATERIAL, MATERIAL_COUNT, NO_MINE_ZONE, type WorldData } from "../world-data";

/** Adventures have natural mountains, without exploitable deposits or painted mining clearings. */
export const clearAdventureDeposits = (world: WorldData) => {
  world.mineZones = []; world.mineZone.fill(NO_MINE_ZONE); world.oreAmount.fill(0);
  for (let cell = 0; cell < world.buildClass.length; cell++) {
    if (world.buildClass[cell] === BUILD.mine) world.buildClass[cell] = BUILD.none;
    if (world.buildCap[cell] === BUILD.mine) world.buildCap[cell] = BUILD.none;
  }
  let ground: number = MATERIAL.grass;
  if (world.expeditionTheme === "desert") ground = MATERIAL.sand;
  if (world.expeditionTheme === "winter") ground = MATERIAL.snow;
  for (let offset = 0; offset < world.splat.length; offset += MATERIAL_COUNT) {
    const mine = world.splat[offset + MATERIAL.mine]!;
    world.splat[offset + MATERIAL.mine] = 0;
    world.splat[offset + ground] = Math.min(255, world.splat[offset + ground]! + mine);
  }
};
