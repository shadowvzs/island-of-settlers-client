import { expect, it } from "vitest";

import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { economyColonyFixture } from "./helpers/economy-colony-fixture";

it.each(MATERIAL_BUILDING_GROUPS)("gathers and processes finite $logs/$stone on its own colony pair", group => {
  const { simulation } = economyColonyFixture(group);
  const total = (ware: string) => simulation.buildings().reduce((sum, building) => sum +
    (building.inventory[ware] ?? 0) + (building.input[ware] ?? 0) + (building.output[ware] ?? 0), 0) +
    simulation.frames().reduce((sum, actor) => sum + (actor.ware === ware ? actor.wareUnits ?? 1 : 0), 0);
  for (let tick = 0; tick < 12000; tick++) {
    simulation.update(.05);
    if (total(group.planks) === 1 && total(group.stone) === 2) break;
  }
  expect(total(group.logs)).toBe(0);
  expect(total(group.planks)).toBe(1);
  expect(total(group.stone)).toBe(2);
  expect(simulation.marbleDeposits().reduce((sum, source) => sum + source.remaining, 0)).toBe(0);
  expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  for (let tick = 0; tick < 1200; tick++) simulation.update(.05);
  expect(total(group.logs) + total(group.planks)).toBe(1);
  expect(total(group.stone)).toBe(2);
  expect(simulation.population().people - simulation.settlerBirths()).toBe(12);
}, 30000);
