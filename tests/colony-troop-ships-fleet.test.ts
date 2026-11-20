import { describe, expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import { edgeBaySettlement } from "./helpers/edge-bay-settlement";

type Simulation = ReturnType<typeof edgeBaySettlement>;
const troop = (type: EmigratedTroop["type"]): EmigratedTroop => ({ hp: militaryHealth(type, 1), rank: 1, type });

/** A finished harbour with idle ships (the development expedition grants them; it is cancelled at once). */
const harbourWithShips = () => {
  const simulation = edgeBaySettlement();
  const started = simulation.startDebugExpedition("colony");
  if (!started.ok) throw new Error(started.reason);
  expect(simulation.cancelColonyExpedition(started.id)).toBe(true);
  return { simulation };
};
const soldiersOfType = (simulation: Simulation, type: EmigratedTroop["type"]) =>
  simulation.militarySoldiers().filter(soldier => soldier.combat?.type === type).length;
/** Runs until `done`, saving and loading once while the ship is under way. */
const runWithReload = (simulation: Simulation, underWay: () => boolean, done: () => boolean) => {
  let reloaded = false;
  for (let step = 0; step < 6000 && !done(); step++) {
    simulation.update(.05);
    if (reloaded || !underWay()) continue;
    expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
    reloaded = true;
  }
  expect(reloaded).toBe(true);
};

describe("colony troop ships in the fleet", () => {
  it("an idle home ship fetches a freed colony's soldiers and wares and lands them at the harbour", () => {
    const { simulation } = harbourWithShips();
    for (let step = 0; step < 400; step++) simulation.update(.05);
    const coal = simulation.resourceTotal("coal"), archers = soldiersOfType(simulation, "archer");
    const id = simulation.fetchFromColony({ expeditionId: 99, voyageSeconds: 5 },
      { cargo: { coal: 7 }, troops: [troop("archer"), troop("archer")] });
    expect(id).not.toBeNull();
    const ship = () => simulation.ships().find(entry => entry.id === id)!;
    runWithReload(simulation, () => ship().phase === "away", () => ship().phase === "idle" &&
      soldiersOfType(simulation, "archer") === archers + 2);
    expect(simulation.resourceTotal("coal")).toBe(coal + 7);
    expect(simulation.militarySoldiers().filter(soldier => soldier.combat?.type === "archer")
      .every(soldier => soldier.combat!.faction === 0)).toBe(true);
  }, 120000);

  it("a troop ship from home lands its soldiers at the colony harbour as stored soldiers", () => {
    const { simulation } = harbourWithShips();
    const heavy = soldiersOfType(simulation, "heavy");
    const id = simulation.sendVisitorShip({}, [], "troops", [troop("heavy"), troop("heavy"), troop("heavy")]);
    expect(id).not.toBeNull();
    const visitor = () => simulation.ships().find(entry => entry.id === id);
    expect(visitor()).toMatchObject({ name: "Troop ship", passengerTroops: { heavy: 3 } });
    runWithReload(simulation, () => visitor()?.phase === "sailing", () => !visitor());
    expect(soldiersOfType(simulation, "heavy")).toBe(heavy + 3);
  }, 120000);
});
