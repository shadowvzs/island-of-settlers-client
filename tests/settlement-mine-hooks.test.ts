import { expect, it } from "vitest";

import { createIslandMineHooks } from "../src/app/settlement/island-mine-hooks";
import { getMineVertexField, ORE_CODE_STEP } from "../src/render-common/mine-field";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import { NO_MINE_ZONE, ORE, type WorldData } from "../src/shared/world/world-data";

it("refreshes cached visible ore after survey and depletion", () => {
  const world = { cellsX: 12, cellsZ: 12, mineZone: new Uint16Array(144).fill(NO_MINE_ZONE),
    oreAmount: new Uint8Array(144), mineZones: [{ id: 1, surveyed: false, ore: ORE.iron }] } as unknown as WorldData;
  world.mineZone[6 * 12 + 6] = 1; world.oreAmount[6 * 12 + 6] = 7;
  const field = getMineVertexField(world), vertex = 6 * 13 + 6;
  expect(field.ore[vertex]).toBe(0);
  let refreshes = 0;
  const renderer = { mapEdit: { refreshChunks: (chunks: unknown[], mineStones: boolean) => {
    expect(chunks.length).toBeGreaterThan(0); expect(mineStones).toBe(true); refreshes++;
  } } } as unknown as Pick<TerrainRenderer, "mapEdit">;
  const hooks = createIslandMineHooks(world, renderer);
  world.mineZones[0]!.surveyed = true; hooks.onSurveyDeposit(1);
  expect(field.ore[vertex]).toBe(ORE.iron * ORE_CODE_STEP); expect(field.amount[vertex]).toBe(7);
  world.oreAmount[6 * 12 + 6] = 0; hooks.onOreChanged(6 * 12 + 6);
  expect(field.amount[vertex]).toBe(0); expect(refreshes).toBe(2);
});
