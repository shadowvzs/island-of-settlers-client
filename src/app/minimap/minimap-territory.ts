import { displayFogAt } from "../../shared/world/fog-display";
import type { WorldData } from "../../shared/world/world-data";

const toSrgbByte = (linear: number) => Math.round(255 * (
  linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055
));

/** Occupied visible cells only; underlying terrain remains readable through the player-colour mask. */
export const createTerritoryMask = (world: WorldData, owned: Uint8Array,
  color: readonly number[]) => {
  const data = new Uint8ClampedArray(world.cellsX * world.cellsZ * 4);
  const rgb = color.map(toSrgbByte);
  for (let cell = 0; cell < owned.length; cell++) {
    if (!owned[cell] || (world.fog && !displayFogAt(world, cell))) continue;
    const index = cell * 4;
    data[index] = rgb[0]!; data[index + 1] = rgb[1]!; data[index + 2] = rgb[2]!;
    data[index + 3] = 100;
  }
  return data;
};
