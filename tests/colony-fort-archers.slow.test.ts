import { describe, expect, it, vi } from "vitest";

import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * BUG-04: field archers shoot the walls of an emptied colony fort on every layout. Before the fix
 * they stood beyond bow reach of the visible hall (places measured from the larger plot, ring
 * corners) or, given a group place cut off from the fort, never left the harbour storage.
 * Layouts (each failed before): easy 4 and 7 (small camps), 2 and 9 (fortresses), 3 and 21 (stranded
 * archers); hard 1. A wider scratch sweep (24 layouts per difficulty) shot on all 72.
 */
const LAYOUTS = [
  { difficulty: "easy", seed: 4 }, { difficulty: "easy", seed: 7 }, { difficulty: "easy", seed: 2 },
  { difficulty: "easy", seed: 9 }, { difficulty: "easy", seed: 3 }, { difficulty: "easy", seed: 21 },
  { difficulty: "hard", seed: 1 }
] as const;
// Riders march apart from the foot group (and their mounts must stay claimed in the save).
const ARMY: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "archer"];

type Simulation = ReturnType<typeof createSettlementSimulation>;
type SavedSoldier = NonNullable<ReturnType<Simulation["saveState"]>["military"]>["soldiers"][number];

const colony = (layout: (typeof LAYOUTS)[number]) => {
  const island = colonyIslandOffers(layout.seed).find(entry => entry.difficulty === layout.difficulty)!;
  const world = chooseColonyWorld(island);
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 2,
    initialStock: {}, now: () => 5000, roads, world });
  const troops = ARMY.map(type => ({ hp: 150, rank: 1, type }));
  expect(simulation.startColony({ island, landed: {}, troops }).ok).toBe(true);
  return simulation;
};

const nearestFort = (simulation: Simulation) => {
  const home = simulation.headquarters;
  return simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0).sort((a, b) =>
    Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0]!;
};

/** Saves, keeps only the soldiers `keep` accepts (with their bodies and mounts), and loads again. */
const keepSoldiers = (simulation: Simulation, keep: (soldier: SavedSoldier) => boolean) => {
  const saved = simulation.saveState();
  const dropped = saved.military!.soldiers.filter(soldier => !keep(soldier));
  const removed = new Set(dropped.flatMap(soldier => [soldier.actor, soldier.combat?.mount ?? -1]));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !removed.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !removed.has(actor.uid));
  expect(simulation.loadState(saved)).toEqual({ ok: true });
};

const soldierOf = (simulation: Simulation, id: number) =>
  simulation.militarySoldiers().find(soldier => soldier.actor === id);
const wallHp = (simulation: Simulation, uid: number) =>
  simulation.militaryDoors().find(door => door.building === uid)!.structure!.hp;

describe("field archers at an emptied colony fort (BUG-04)", () => {
  it.each(LAYOUTS)("$difficulty seed $seed: archers damage the walls", (layout) => {
    const simulation = colony(layout);
    const fort = nearestFort(simulation);
    keepSoldiers(simulation, soldier => soldier.building !== fort.uid);
    const army = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0)
      .map(soldier => soldier.actor);
    // The whole army is ordered (archers march with the group), then the melee soldiers go home:
    // every blow at the walls comes from an archer.
    expect(simulation.siegeMilitary(army, fort.uid)).toBe(true);
    const melee = army.filter(id => soldierOf(simulation, id)?.combat?.type !== "archer");
    expect(simulation.commandMilitary(melee, simulation.headquarters.access, "move")).toBe(true);
    expect(melee.map(id => soldierOf(simulation, id)?.combat?.siege)).toEqual([undefined, undefined]);
    const start = wallHp(simulation, fort.uid);
    let struck = false;
    for (let tick = 0; tick < 900 && !struck; tick++) {
      simulation.update(.1);
      struck = wallHp(simulation, fort.uid) < start;
    }
    expect(struck).toBe(true);
  });
});
