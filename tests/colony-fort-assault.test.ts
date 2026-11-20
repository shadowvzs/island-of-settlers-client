import { describe, expect, it, vi } from "vitest";

import { FORT_COLLAPSE_SECONDS, BUILDING_STRUCTURE_HP } from "../src/shared/balance/military";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import { FORT_REMOVAL_SECONDS, fortFlames, structureDamage } from "../src/shared/settlement/fort-assault-rules";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/** Colony forts are destroyed, never captured (owner decision 2026-10-13). */
type Simulation = ReturnType<typeof createSettlementSimulation>;
// Archers shoot the walls on every layout since BUG-04 (sweep: colony-fort-archers.slow.test.ts).
const easy = colonyIslandOffers(1234).find(entry => entry.difficulty === "easy")!;

const colony = (troops: readonly MilitaryTroopType[]) => {
  const world = chooseColonyWorld(easy);
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 2,
    initialStock: {}, now: () => 5000, roads, world });
  const landed = troops.map(type => ({ hp: 150, rank: 1, type }));
  expect(simulation.startColony({ island: easy, landed: {}, troops: landed }).ok).toBe(true);
  return simulation;
};

const hostileForts = (simulation: Simulation) =>
  simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
const structureOf = (simulation: Simulation, uid: number) =>
  simulation.militaryDoors().find(door => door.building === uid)?.structure;
const playerIds = (simulation: Simulation) => simulation.militarySoldiers()
  .filter(soldier => (soldier.combat?.faction ?? 0) === 0).map(soldier => soldier.actor);

/** Kills the garrison of the fort nearest the harbour (as if its defenders fell) and sets its wall HP. */
const emptyNearestFort = (simulation: Simulation, hp: number) => {
  const home = simulation.headquarters;
  const fort = hostileForts(simulation).sort((a, b) =>
    Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0]!;
  const saved = simulation.saveState();
  const guards = new Set(saved.military!.soldiers.filter(soldier => soldier.building === fort.uid)
    .map(soldier => soldier.actor));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !guards.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !guards.has(actor.uid));
  saved.military!.combat!.doors.find(door => door.building === fort.uid)!.structure!.hp = hp;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  return fort;
};

const advance = (simulation: Simulation, seconds: number, until?: () => boolean) => {
  for (let tick = 0; tick < seconds * 10; tick++) {
    simulation.update(.1);
    if (until?.()) return true;
  }
  return false;
};

describe("colony fort destruction rules", () => {
  it("maps wall hit points to the fort sizes, smallest to largest", () => {
    expect([1, 2, 4, 9].map(typeId => BUILDING_STRUCTURE_HP[typeId])).toEqual([10_000, 20_000, 35_000, 50_000]);
  });

  it("adds a flame for every 20 % of hit points lost", () => {
    const flames = [50_000, 40_001, 40_000, 30_000, 20_000, 10_000, 1, 0]
      .map(hp => fortFlames({ hp, maximum: 50_000 }));
    expect(flames).toEqual([0, 0, 1, 2, 3, 4, 4, 5]);
  });

  it("hurts walls with the soldier damage rules (rank bonus, glancing blows at half)", () => {
    const never = () => 1;
    expect(structureDamage("heavy", 0, true, never)).toBeCloseTo(structureDamage("shield", 0, true, never) * 1.8);
    expect(structureDamage("shield", 1, true, never)).toBeCloseTo(structureDamage("shield", 0, true, never) * 1.2);
    expect(structureDamage("archer", 0, false, never)).toBeCloseTo(structureDamage("archer", 0, true, never) / 2);
  });
});

describe("colony fort destruction in the simulation", () => {
  it("melee, riders and archers attack an emptied fort's walls; never capture it", () => {
    const simulation = colony(["shield", "heavy", "archer", "archer", "cavalry"]);
    const fort = emptyNearestFort(simulation, 6000);
    expect(simulation.siegeMilitary(playerIds(simulation), fort.uid)).toBe(true);
    const struck = advance(simulation, 150, () => (structureOf(simulation, fort.uid)?.hp ?? 0) < 6000);
    expect(struck).toBe(true);
    const archers = new Set(simulation.militarySoldiers().filter(soldier => soldier.combat?.type === "archer")
      .map(soldier => soldier.actor));
    let wallArrows = false;
    advance(simulation, 120, () => {
      wallArrows ||= simulation.militaryArrows().some(arrow => archers.has(arrow.shooter) && arrow.wall === fort.uid);
      return structureOf(simulation, fort.uid)!.hp === 0;
    });
    expect(wallArrows).toBe(true);
    expect(structureOf(simulation, fort.uid)).toMatchObject({ hp: 0 });
    expect(fort.militaryFaction).toBe(1);
    // At 0 HP every attacker stops.
    expect(simulation.militarySoldiers().some(soldier => soldier.combat?.siege === fort.uid)).toBe(false);
  }, 120_000);

  it("burns 5 s, collapses, leaves a ruin 5 s and frees the plot; timers survive save/load", () => {
    const simulation = colony(["shield", "shield", "heavy"]);
    const fort = emptyNearestFort(simulation, 1);
    simulation.siegeMilitary(playerIds(simulation), fort.uid);
    expect(advance(simulation, 150, () => structureOf(simulation, fort.uid)?.hp === 0)).toBe(true);
    advance(simulation, 2);
    const fallen = structureOf(simulation, fort.uid)!.fallen!;
    expect(fallen).toBeGreaterThan(1.5);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(structureOf(simulation, fort.uid)!.fallen).toBeCloseTo(fallen);
    advance(simulation, FORT_COLLAPSE_SECONDS - fallen + .5);
    expect(simulation.buildings().some(building => building.uid === fort.uid)).toBe(true);
    advance(simulation, FORT_REMOVAL_SECONDS - FORT_COLLAPSE_SECONDS);
    expect(simulation.buildings().some(building => building.uid === fort.uid)).toBe(false);
    expect(simulation.isOccupied(fort.x, fort.z)).toBe(false);
  }, 120_000);

  it("keeps the besiegers of a cleared fort in the field instead of sending them home", () => {
    const simulation = colony(["shield", "shield", "heavy"]);
    const fort = emptyNearestFort(simulation, 1);
    simulation.siegeMilitary(playerIds(simulation), fort.uid);
    expect(advance(simulation, 150, () => structureOf(simulation, fort.uid)?.hp === 0)).toBe(true);
    // Winners of a door duel still point at the fort they fought at.
    const saved = simulation.saveState(), ours = new Set(playerIds(simulation));
    for (const body of saved.actors) if (ours.has(body.uid)) body.building = fort.uid;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(simulation, FORT_REMOVAL_SECONDS + 1);
    expect(simulation.buildings().some(building => building.uid === fort.uid)).toBe(false);
    const phases = simulation.frames().filter(body => ours.has(body.uid)).map(body => body.phase);
    expect(phases).toEqual(["militaryField", "militaryField", "militaryField"]);
  }, 120_000);

  it("is conquered once every fort has collapsed", () => {
    const simulation = colony(["shield", "heavy"]);
    const saved = simulation.saveState();
    for (const door of saved.military!.combat!.doors) if (door.structure) {
      door.structure.hp = 0; door.structure.fallen = FORT_COLLAPSE_SECONDS - 1;
    }
    const guards = new Set(saved.military!.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) > 0)
      .map(soldier => soldier.actor));
    saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !guards.has(soldier.actor));
    saved.actors = saved.actors.filter(actor => !guards.has(actor.uid));
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(simulation, .5);
    expect(simulation.colony()?.status).toBe("contested");
    advance(simulation, 1);
    expect(simulation.colony()?.status).toBe("conquered");
    advance(simulation, FORT_REMOVAL_SECONDS);
    expect(hostileForts(simulation)).toHaveLength(0);
  }, 60_000);

  it("gives the forts of older saves walls (attacked instead of captured)", () => {
    const simulation = colony(["shield"]);
    const saved = simulation.saveState();
    for (const door of saved.military!.combat!.doors) delete door.structure;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(simulation, 1);
    for (const fort of hostileForts(simulation))
      expect(structureOf(simulation, fort.uid)).toEqual({ hp: BUILDING_STRUCTURE_HP[fort.typeId], maximum: BUILDING_STRUCTURE_HP[fort.typeId] });
  }, 60_000);

  it("rejects broken wall saves", () => {
    const simulation = colony(["shield"]);
    const saved = simulation.saveState();
    saved.military!.combat!.doors.find(door => door.structure)!.structure!.hp = -5;
    expect(simulation.loadState(saved).ok).toBe(false);
  }, 60_000);
});
