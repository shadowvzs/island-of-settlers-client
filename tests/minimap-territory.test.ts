import { expect, it } from "vitest";

import { createTerritoryMask } from "../src/app/minimap/minimap-territory";
import { playerColorFromHex } from "../src/render-common/settlement/player-color";
import type { WorldData } from "../src/shared/world/world-data";

it("tints owned revealed cells with player colour without revealing hidden or unowned cells", () => {
  const world = { cellsX: 2, cellsZ: 2, fog: new Uint8Array([2, 2, 0, 1]) } as WorldData;
  const pixels = createTerritoryMask(world, new Uint8Array([1, 0, 1, 1]), playerColorFromHex("#c62828"));
  expect(Array.from(pixels.slice(0, 4))).toEqual([198, 40, 40, 100]);
  expect(Array.from(pixels.slice(4, 12))).toEqual(Array.from({ length: 8 }, () => 0));
  expect(Array.from(pixels.slice(12, 16))).toEqual([198, 40, 40, 100]);
});
