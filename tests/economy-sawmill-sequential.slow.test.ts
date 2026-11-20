import { SAWMILL_RECIPES } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

it("pays all four sequential sawmill upgrades and converts finite supplies through all five recipes", () => {
  const { advance, building, simulation, total } = workshopUpgradeFixture(33, {
    logs: 3, hardwoodLogs: 7, cedarLogs: 8, walnutLogs: 9, mahoganyLogs: 10,
    marble: 2, limestone: 3, basalt: 4, granite: 5
  });
  const sawmill = () => simulation.buildings().find(entry => entry.uid === building.uid)!;
  const planksBefore = total("planks");
  for (const [level, recipe] of SAWMILL_RECIPES.entries()) {
    if (level) {
      expect(simulation.setProductionMode(building.uid, recipe.output)).toBe(false);
      expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
      // Preserve actual in-flight upgrade receipts through an authoritative reload.
      advance(2);
      expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
      advance(450, () => sawmill().workshopUpgrade?.level === level);
      expect(sawmill().workshopUpgrade).toEqual({ level });
    }
    expect(simulation.setProductionMode(building.uid, recipe.output)).toBe(true);
    const expectedOutput = level ? 3 : planksBefore + 3;
    advance(450, () => total(recipe.output) === expectedOutput && total(recipe.input) === 0);
    expect(total(recipe.output)).toBe(expectedOutput);
    expect(total(recipe.input)).toBe(0);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    expect(total(recipe.output)).toBe(expectedOutput);
  }
  for (const ware of ["marble", "limestone", "basalt", "granite"])
    expect(total(ware)).toBe(0);
  expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(false);
  expect(simulation.population().people - simulation.settlerBirths()).toBe(40);
}, 30000);

it.each(SAWMILL_RECIPES.slice(0, -1))(
  "keeps committed $output while new selection returns old stock and an in-flight delivery physically", recipe => {
    const index = SAWMILL_RECIPES.indexOf(recipe), next = SAWMILL_RECIPES[index + 1]!;
    const { advance, building, simulation, total } = workshopUpgradeFixture(33, {
      [recipe.input]: 1, [next.input]: 3
    });
    building.workshopUpgrade = { level: ([1, 2, 3, 4] as const)[index]! };
    building.input[recipe.input] = 3;
    const before = total(recipe.output);
    expect(simulation.setProductionMode(building.uid, recipe.output)).toBe(true);
    advance(120, () => simulation.frames().some(actor => actor.job === "Carpenter" &&
      actor.phase === "work" && actor.productionOutput === recipe.output));
    expect(simulation.frames().some(actor => actor.job === "Carpenter" && actor.phase === "work")).toBe(true);
    expect(simulation.transferWare(simulation.headquarters.uid, building.uid, recipe.input, 1)).toBe(true);
    advance(.5);
    expect(simulation.frames().some(actor => actor.delivery?.destination === building.uid &&
      actor.delivery.ware === recipe.input)).toBe(true);
    expect(simulation.setProductionMode(building.uid, next.output)).toBe(true);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    let physicalReturn = false, returnReloaded = false;
    for (let tick = 0; tick < 9000; tick++) {
      simulation.update(.05);
      const returning = simulation.frames().find(actor => actor.delivery?.sourceInput &&
        actor.delivery.source === building.uid && actor.delivery.ware === recipe.input &&
        actor.phase === "pickupTransfer");
      physicalReturn ||= Boolean(returning);
      if (returning && !returnReloaded) {
        expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
        returnReloaded = true;
      }
      if (total(next.output) === 3 && simulation.headquarters.inventory[recipe.input] === 3) break;
    }
    expect(physicalReturn && returnReloaded).toBe(true);
    expect(total(recipe.output)).toBe(before + 1);
    expect(total(recipe.input)).toBe(3);
    expect(simulation.headquarters.inventory[recipe.input]).toBe(3);
    expect(total(next.output)).toBe(3);
    expect(total(next.input)).toBe(0);
  }, 30000
);

it.each([0, 1, 2, 3].flatMap(level => ["cancel", "demolish"].map(action => ({ action, level }))))(
  "$action during paid upgrade hammering from tier$level preserves exact materials/tools after reload", ({ action, level }) => {
    const next = SAWMILL_RECIPES[level + 1]!;
    const stone = ["marble", "limestone", "basalt", "granite"][level]!;
    const fees = { [next.input]: level + 4, [stone]: level + 2 };
    const { advance, building, simulation, total } = workshopUpgradeFixture(33, fees);
    building.workshopUpgrade = { level: ([0, 1, 2, 3] as const)[level]! };
    expect(simulation.setProductionMode(building.uid, SAWMILL_RECIPES[level]!.output)).toBe(true);
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
    advance(450, () => (building.workshopUpgrade?.progress ?? 0) > 0);
    expect(building.workshopUpgrade?.progress).toBeGreaterThan(0);
    if (action === "cancel") expect(simulation.cancelWorkshopUpgrade(building.uid)).toBe(true);
    else expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    advance(300);
    for (const [ware, quantity] of Object.entries(fees)) expect(total(ware)).toBe(quantity);
    expect(simulation.headquarters.inventory.hammer).toBe(1);
    if (action === "demolish") expect(simulation.headquarters.inventory.saw).toBe(1);
    else expect(simulation.buildings().find(entry => entry.uid === building.uid)?.workshopUpgrade?.level ?? 0).toBe(level);
    expect(simulation.population().people - simulation.settlerBirths()).toBe(40);
  }, 30000
);
