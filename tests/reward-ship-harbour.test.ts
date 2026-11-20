import { describe, expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { rewardShipLoads } from "../src/shared/settlement/reward-ship-loads";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import { edgeBaySettlement } from "./helpers/edge-bay-settlement";

type Simulation = ReturnType<typeof edgeBaySettlement>;
const HARBOUR = 39;
const troop = (type: EmigratedTroop["type"]): EmigratedTroop => ({ hp: militaryHealth(type, 1), rank: 0, type });

/** A finished harbour with idle ships (the development expedition grants them; it is cancelled at once). */
const harbourSettlement = () => {
  const simulation = edgeBaySettlement();
  const started = simulation.startDebugExpedition("colony");
  if (!started.ok) throw new Error(started.reason);
  expect(simulation.cancelColonyExpedition(started.id)).toBe(true);
  for (let step = 0; step < 100; step++) simulation.update(.05);
  return simulation;
};
const harbourUid = (simulation: Simulation) =>
  simulation.buildings().find(building => building.typeId === HARBOUR && building.construction === 1)!.uid;
const archers = (simulation: Simulation) =>
  simulation.militarySoldiers().filter(soldier => soldier.combat?.type === "archer").length;
/**
 * The harbour no longer stands as a finished harbour (as after a battle; demolition itself is blocked). The live
 * building is reset to a site, which is what every naval check reads.
 */
const withoutHarbour = (simulation: Simulation) => {
  const harbour = simulation.buildings().find(building => building.typeId === HARBOUR)!;
  (harbour as { construction: number }).construction = 0;
};

describe("reward ship (C12, plan item 35)", () => {
  it("blocks demolition of the harbour it sails to", () => {
    const simulation = harbourSettlement();
    const uid = harbourUid(simulation);
    expect(simulation.sendVisitorShip({ planks: 5 }, [], "reward", [], 30)).not.toBeNull();
    expect(simulation.demolishBuilding(uid)).toEqual({ ok: false,
      reason: "A reward ship is sailing to this harbour; wait until it has unloaded" });
  }, 120000);

  it("credits goods and soldiers to the home building when its harbour is gone", () => {
    const simulation = harbourSettlement();
    const planks = simulation.resourceTotal("planks"), before = archers(simulation);
    const id = simulation.sendVisitorShip({ planks: 5 }, [], "reward", [troop("archer"), troop("archer")], 30);
    expect(id).not.toBeNull();
    withoutHarbour(simulation);
    for (let step = 0; step < 40 && simulation.ships().some(ship => ship.id === id); step++) simulation.update(.05);
    expect(simulation.ships().some(ship => ship.id === id)).toBe(false);
    expect(simulation.resourceTotal("planks")).toBe(planks + 5);
    expect(archers(simulation)).toBe(before + 2);
  }, 120000);

  it("unloads at the harbour like any ship and lands its soldiers; a reload under way delivers once", () => {
    const simulation = harbourSettlement();
    const planks = simulation.resourceTotal("planks"), before = archers(simulation);
    const id = simulation.sendVisitorShip({ planks: 4 }, [], "reward", [troop("archer")], 5);
    const present = () => simulation.ships().some(ship => ship.id === id);
    let reloaded = false;
    for (let step = 0; step < 6000 && present(); step++) {
      simulation.update(.05);
      if (reloaded || simulation.ships().find(ship => ship.id === id)?.phase !== "sailing") continue;
      expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
      reloaded = true;
    }
    expect(reloaded).toBe(true);
    expect(present()).toBe(false);
    expect(simulation.resourceTotal("planks")).toBe(planks + 4);
    expect(archers(simulation)).toBe(before + 1);
  }, 120000);
});

describe("reward ship loads (C12)", () => {
  it("fills one deck per ship, soldiers first, and keeps every unit", () => {
    const troops = Array.from({ length: 30 }, () => troop("shield"));
    const loads = rewardShipLoads({ coins: 500, planks: 400 }, troops);
    expect(loads.length).toBeGreaterThan(1);
    expect(loads.flatMap(load => load.troops)).toHaveLength(30);
    const total = (ware: string) => loads.reduce((sum, load) => sum + (load.cargo[ware] ?? 0), 0);
    expect([total("coins"), total("planks")]).toEqual([500, 400]);
    expect(rewardShipLoads({ stone: 3 }, [])).toEqual([{ cargo: { stone: 3 }, troops: [] }]);
    expect(rewardShipLoads({}, [])).toEqual([]);
  });
});
