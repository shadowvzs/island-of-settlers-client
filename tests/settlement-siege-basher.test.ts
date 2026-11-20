import { describe, expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";
import { advanceSeconds, createBalanceSimulation, placeHostileSite } from "../tools/bench/garrison-balance-harness";

const troops = (count: number, type: "heavy" | "shield") =>
  Array.from({ length: count }, () => ({ hp: militaryHealth(type, 0), rank: 0, type }));

describe("siege door basher", () => {
  // Regression (medium colony, 30 soldiers, seed 4 after the 2026-10-13 tuning): the lowest-id soldier
  // was the only one allowed to bash an emptied door; arriving last from behind the fort, it waited
  // for ever behind the queue under the walls while the queue waited for it.
  it("lets the waiting soldier nearest the door bash an undefended fort's door", () => {
    const simulation = createBalanceSimulation(64, 4);
    const fort = placeHostileSite(simulation, 4, 40, 40);
    expect(simulation.registerMilitaryGarrison(fort.uid, [], 1, 200)).toBe(true);
    const outward = { x: fort.access.x - fort.x, z: fort.access.z - fort.z };
    const out = (distance: number): SettlementPoint =>
      ({ x: fort.x + outward.x / 2.5 * distance, z: fort.z + outward.z / 2.5 * distance });
    simulation.receiveTroops(troops(1, "heavy"));
    const [late] = simulation.militarySoldiers().map(soldier => soldier.actor);
    simulation.callOutMilitary(["heavy"], out(-9));
    advanceSeconds(simulation, 60);
    simulation.receiveTroops(troops(12, "shield"));
    simulation.callOutMilitary(["shield"], out(8));
    advanceSeconds(simulation, 60);
    const queue = simulation.militarySoldiers().filter(soldier => soldier.actor !== late).map(soldier => soldier.actor);
    simulation.siegeMilitary(queue, fort.uid);
    advanceSeconds(simulation, 20);
    simulation.siegeMilitary([late!], fort.uid);
    for (let second = 0; second < 240 && fort.militaryFaction !== 0; second++) simulation.update(1);
    expect(fort.militaryFaction).toBe(0);
  }, 60000);
});
