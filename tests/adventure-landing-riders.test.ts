import { describe, expect, it, vi } from "vitest";

import { SHIP_DECK } from "../src/render-common/ships/ship-deck-layout";
import { SAILING_SHIP_SCALE } from "../src/render-common/ships/ship-dimensions";
import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { chooseAdventureWorld } from "../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { ADVENTURE_BEACH, ADVENTURE_GANGWAY } from "../src/shared/settlement/settlement-adventure-landing";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { landingBodies, landingClearance, stillLanding } from "./helpers/landing-clearance";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

type Simulation = ReturnType<typeof createSettlementSimulation>;
const STEP = .05;

const createLanding = () => {
  const island = adventureOffers(1234).find(offer => offer.difficulty === "easy")!;
  const world = chooseAdventureWorld(island);
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ homeBuilding: null, initialSettlers: 0, roads, world });
  return { island, simulation, world };
};

/** `foot` foot soldiers and two riders (six and two: room on deck for one horse, the other waits below). */
const mixedLanding = (foot = 6) => {
  const landing = createLanding();
  const troops = Array.from({ length: foot + 2 }, (_, index) => ({ hp: 100, rank: 0,
    type: index < foot ? "heavy" as const : "cavalry" as const }));
  expect(landing.simulation.startAdventure({ island: landing.island, troops }).ok).toBe(true);
  const own = landing.simulation.militarySoldiers().filter(soldier => !soldier.combat?.faction);
  const riders = new Set(own.filter(soldier => soldier.combat!.type === "cavalry").map(soldier => soldier.actor));
  return { ...landing, ids: new Set(own.map(soldier => soldier.actor)), riders };
};

const leastClearance = (simulation: Simulation, ids: ReadonlySet<number>) => {
  const bodies = landingBodies(simulation, ids);
  let least = Infinity;
  for (const [index, body] of bodies.entries())
    for (const other of bodies.slice(index + 1)) least = Math.min(least, landingClearance(body, other));
  return least;
};

const body = (simulation: Simulation, uid: number) => simulation.frames().find(actor => actor.uid === uid)!;

describe("riders' horses on the adventure landing ship (owner, 2026-10-15)", () => {
  it("stands a horse on deck where there is room, held by its rider; the other waits below", () => {
    const { ids, riders, simulation, world } = mixedLanding();
    const horses = simulation.horseFrames();
    expect(horses).toHaveLength(1);
    expect(horses[0]!.y).toBeCloseTo(world.seaLevel + SAILING_SHIP_SCALE * SHIP_DECK.floorY);
    const holder = body(simulation, horses[0]!.leader!);
    expect(riders.has(holder.uid)).toBe(true);
    expect(holder.visible).toBe(true);
    expect(Math.hypot(holder.x - horses[0]!.x, holder.z - horses[0]!.z)).toBeLessThan(1.7);
    expect([...riders].filter(uid => !body(simulation, uid).visible)).toHaveLength(1);
    expect(leastClearance(simulation, ids)).toBeGreaterThanOrEqual(0);
  });

  it("rides each rider down the gangway and on over the beach (owner, 2026-10-15), without overlapping", () => {
    const { ids, riders, simulation } = mixedLanding();
    const rodeDown = new Set<number>(), dismounted = new Set<number>();
    let landed = Infinity, least = Infinity;
    for (let time = 0; time < 40; time += STEP) {
      simulation.update(STEP);
      least = Math.min(least, leastClearance(simulation, ids));
      for (const uid of riders) {
        const rider = body(simulation, uid);
        if (rider.phase === ADVENTURE_GANGWAY && rider.mounted) rodeDown.add(uid);
        if ([ADVENTURE_BEACH, "militaryLeaving"].includes(rider.phase) && !rider.mounted) dismounted.add(uid);
      }
      // No horse is led: the only horses drawn stand on deck.
      expect(simulation.horseFrames().filter(horse => horse.visible !== false && horse.moving)).toHaveLength(0);
      if (landed === Infinity && !stillLanding(simulation, ids)) landed = time;
    }
    expect(landed).toBeLessThan(20);
    expect(least).toBeGreaterThanOrEqual(0);
    expect(rodeDown).toEqual(riders);
    expect(dismounted.size).toBe(0);
    for (const uid of riders) expect(body(simulation, uid)).toMatchObject({ mounted: true, phase: "militaryField" });
    expect(simulation.horseFrames()).toHaveLength(0);
  }, 60000);

  it("resumes a landing saved with a horse on deck and a rider riding down", () => {
    // Four foot soldiers: both horses stand on deck.
    const { ids, riders, simulation } = mixedLanding(4);
    expect(simulation.horseFrames()).toHaveLength(2);
    // One rider on horseback on his way off, the other's horse still standing on deck.
    const riding = () => [...riders].some(uid => body(simulation, uid).mounted) && simulation.horseFrames().length > 0;
    for (let step = 0; step < 1200 && !riding(); step++) simulation.update(STEP);
    expect(riding()).toBe(true);
    const saved = simulation.saveState();
    const loaded = createLanding().simulation;
    expect(loaded.loadState(saved).ok).toBe(true);
    for (const uid of riders) {
      const before = body(simulation, uid), after = body(loaded, uid);
      expect(Boolean(after.mounted)).toBe(Boolean(before.mounted));
      expect(after).toMatchObject({ phase: before.phase, x: before.x, z: before.z });
    }
    // A loaded game lists every horse actor; the hidden mounts are drawn with their riders.
    const shown = (game: Simulation) => game.horseFrames().filter(horse => horse.visible !== false)
      .map(horse => horse.id);
    expect(shown(loaded)).toEqual(shown(simulation));
    for (let step = 0; step < 800 && stillLanding(loaded, ids); step++) {
      loaded.update(STEP);
      expect(leastClearance(loaded, ids)).toBeGreaterThanOrEqual(0);
    }
    expect(stillLanding(loaded, ids)).toBe(false);
  }, 60000);
});
