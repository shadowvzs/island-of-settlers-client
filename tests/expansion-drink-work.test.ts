import { expect, it } from "vitest";
import type { BuildingFirstNation } from "../src/render-common/workers/worker-nation";
import { drinkWorkstation } from "../src/shared/settlement/settlement-drink-work";
import { NATION_DRINK_CHAINS } from "../src/shared/settlement/nation-drinks";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

const NATIONS: BuildingFirstNation[] = ["chinese", "persian", "maya", "indigenous"];

it.each(NATIONS)("%s maker reaches its visible bench, faces its tools and completes the existing 16 second work", nation => {
  const { simulation, advance, building: original } = workshopUpgradeFixture(6, { grapes: 1, water: 4 });
  expect(simulation.setPlayerNation(nation)).toBe(true);
  const building = simulation.buildings().find(entry => entry.uid === original.uid)!;
  const chain = NATION_DRINK_CHAINS[nation];
  advance(120, () => simulation.frames().some(actor => actor.uid === building.worker && actor.phase === "work"));
  const actor = simulation.frames().find(actor => actor.uid === building.worker)!;
  expect(actor?.phase).toBe("work");
  const station = drinkWorkstation(building, nation)!;
  expect(actor.visible).toBe(true);
  expect(actor.x).toBeCloseTo(station.point.x, 5);
  expect(actor.z).toBeCloseTo(station.point.z, 5);
  expect(actor.yaw).toBeCloseTo(station.yaw, 5);
  expect(actor.timer).toBeGreaterThan(15.8);
  expect(actor.timer).toBeLessThanOrEqual(16);
  advance(80, () => (simulation.headquarters.inventory[chain.drink] ?? 0) > 0);
  expect(simulation.headquarters.inventory[chain.drink]).toBe(1);
});
