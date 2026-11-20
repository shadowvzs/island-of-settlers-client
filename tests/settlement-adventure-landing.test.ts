import { describe, expect, it, vi } from "vitest";

import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { chooseAdventureWorld } from "../src/shared/settlement/colony-world-choice";
import { militaryGroundPath } from "../src/shared/settlement/military-routing";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  ADVENTURE_ABOARD, ADVENTURE_GANGWAY, ADVENTURE_SHIP_PHASES, gatherSlot
} from "../src/shared/settlement/settlement-adventure-landing";
import { isMountedNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { groundPath } from "../src/shared/settlement/settlement-paths";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const createLanding = () => {
  const island = adventureOffers(1234).find(offer => offer.difficulty === "easy")!;
  const world = chooseAdventureWorld(island);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ homeBuilding: null, initialSettlers: 0, roads, world });
  return { island, simulation, world };
};

/** Open ground some 30 tiles inland from the landing shore that a soldier can walk to. */
const farReachablePoint = (simulation: ReturnType<typeof createSettlementSimulation>,
  world: ReturnType<typeof createLanding>["world"]) => {
  const shore = simulation.adventure()!.landing!.shore;
  const context = { actors: simulation.frames(), buildings: [], occupied: new Uint8Array(96 * 96),
    options: { world }, reservations: new Set<string>() } as never;
  for (let z = 2.5; z < world.cellsZ; z += 3) for (let x = 2.5; x < world.cellsX; x += 3) {
    const distance = Math.hypot(x - shore.x, z - shore.z);
    if (distance > 28 && distance < 34 && groundPath(context, shore, { x, z })) return { x, z };
  }
  throw new Error("No inland point");
};

describe("adventure landing traffic", () => {
  it.each([false, true])("lands cavalry last in stable order (reload: %s)", reload => {
    const { island, simulation } = createLanding();
    const troops = [
      { hp: 100, rank: 0, type: "cavalry" as const },
      { hp: 100, rank: 0, type: "heavy" as const },
      { hp: 100, rank: 1, type: "cavalry" as const },
      { hp: 100, rank: 1, type: "archer" as const },
      { hp: 100, rank: 2, type: "cavalry" as const },
      { hp: 100, rank: 2, type: "shield" as const }
    ];
    expect(simulation.startAdventure({ island, troops }).ok).toBe(true);
    let active = simulation;
    if (reload) {
      // Until the first soldier has crossed the deck and is on the gangway.
      const onGangway = () => active.frames().some(actor => actor.phase === ADVENTURE_GANGWAY);
      for (let step = 0; step < 200 && !onGangway(); step++) active.update(.05);
      const saved = active.saveState();
      const types = new Map(saved.military!.soldiers.map(soldier => [soldier.actor, soldier.combat?.type]));
      // An older save gave cavalry the first expired turns; repair only the aboard queue.
      for (const actor of saved.actors.filter(body => body.phase === ADVENTURE_ABOARD))
        actor.timer = types.get(actor.uid) === "cavalry" ? -1 : 10;
      const aboard = saved.actors.filter(actor => actor.phase === ADVENTURE_ABOARD);
      saved.actors = [
        ...aboard.filter(actor => types.get(actor.uid) === "cavalry"),
        ...aboard.filter(actor => types.get(actor.uid) !== "cavalry"),
        ...saved.actors.filter(actor => actor.phase !== ADVENTURE_ABOARD)
      ];
      const walking = saved.actors.filter(actor => actor.phase === ADVENTURE_GANGWAY);
      expect(walking.length).toBeGreaterThan(0);
      active = createLanding().simulation;
      expect(active.loadState(saved).ok).toBe(true);
      for (const actor of walking)
        expect(active.frames().find(body => body.uid === actor.uid)).toMatchObject({
          phase: actor.phase, timer: actor.timer, x: actor.x, y: actor.y, z: actor.z
        });
    }
    const soldiers = active.militarySoldiers().filter(soldier => soldier.combat?.faction === 0);
    const identities = new Map(soldiers.map(soldier =>
      [soldier.actor, `${soldier.combat!.type}:${soldier.rank}`]));
    const landed = new Set<number>(), arrivals: string[] = [];
    for (let step = 0; step < 2400 && landed.size < soldiers.length; step++) {
      active.update(.05);
      for (const actor of active.frames()) {
        if (!identities.has(actor.uid) || landed.has(actor.uid) || ADVENTURE_SHIP_PHASES.includes(actor.phase))
          continue;
        landed.add(actor.uid);
        arrivals.push(identities.get(actor.uid)!);
      }
    }
    expect(arrivals).toEqual(["heavy:0", "archer:1", "shield:2", "cavalry:0", "cavalry:1", "cavalry:2"]);
  }, 60000);

  it("keeps gathering places spaced, reachable and away from the shore exit", () => {
    const { island, simulation, world } = createLanding();
    expect(simulation.startAdventure({ island, troops: [] }).ok).toBe(true);
    const shore = simulation.adventure()!.landing!.shore;
    const context = { actors: simulation.frames(), buildings: [], occupied: new Uint8Array(96 * 96),
      options: { world }, reservations: new Set<string>() } as never;
    const slots = Array.from({ length: 12 }, (_, index) => gatherSlot(context, shore, index));
    for (const [index, slot] of slots.entries()) {
      expect(Math.hypot(slot.x - shore.x, slot.z - shore.z)).toBeGreaterThanOrEqual(6);
      expect(groundPath(context, shore, slot)).not.toBeNull();
      expect(isMountedNavigationClear(context, slot)).toBe(true);
      for (const previous of slots.slice(0, index))
        expect(Math.hypot(previous.x - slot.x, previous.z - slot.z)).toBeGreaterThanOrEqual(2.6);
    }
    for (let index = 0; index < 5; index++)
      expect(militaryGroundPath(context, slots[0]!, gatherSlot(context, shore, index, true), true)).not.toBeNull();
  }, 60000);

  it.each(["mixed", "cavalry"] as const)("clears a full %s landing and accepts a later rally", kind => {
    const { island, simulation, world } = createLanding();
    const count = kind === "cavalry" ? 50 : 30;
    const troops = Array.from({ length: count }, (_, index) => ({ hp: 125, rank: 1,
      type: kind === "cavalry" || index % 6 === 0 ? "cavalry" as const : "heavy" as const }));
    expect(simulation.startAdventure({ island, troops }).ok).toBe(true);
    for (let step = 0; step < 80; step++) simulation.update(.05);
    const saved = simulation.saveState();
    const loaded = createLanding().simulation;
    expect(loaded.loadState(saved).ok).toBe(true);
    const ids = new Set(loaded.militarySoldiers().filter(soldier => soldier.combat?.faction === 0)
      .map(soldier => soldier.actor));
    // Riders ride on off the narrow beach (owner 2026-10-15): 50 take about a minute and a half.
    for (let step = 0; step < 4800; step++) loaded.update(.05);
    const bodies = loaded.frames().filter(actor => ids.has(actor.uid));
    expect(bodies).toHaveLength(count);
    expect(bodies.every(actor => !["adventureAboard", "adventureGangway"].includes(actor.phase))).toBe(true);
    expect(loaded.saveState().adventure!.landing!.ashore).toBe(count);
    expect(loaded.commandMilitary([...ids], world.start, "move")).toBe(true);
    const goals = new Map(loaded.militarySoldiers().filter(soldier => ids.has(soldier.actor))
      .map(soldier => [soldier.actor, soldier.combat!.destination!]));
    expect([...goals.values()].every(Boolean)).toBe(true);
    for (let step = 0; step < 2400; step++) loaded.update(.05);
    const rallied = loaded.frames().filter(actor => ids.has(actor.uid));
    expect(rallied).toHaveLength(count);
    expect(rallied.every(actor => actor.phase === "militaryField")).toBe(true);
    const remainingOrders = loaded.militarySoldiers().filter(soldier => ids.has(soldier.actor) &&
      soldier.combat?.destination);
    expect(remainingOrders).toHaveLength(0);
  }, 60000);

  it("sends soldiers still aboard to the banner after they walk ashore", () => {
    const { island, simulation, world } = createLanding();
    const troops = Array.from({ length: 30 }, (_, index) => ({ hp: 90, rank: 0,
      type: index % 6 === 0 ? "cavalry" as const : "heavy" as const }));
    expect(simulation.startAdventure({ island, troops }).ok).toBe(true);
    expect(simulation.plantMilitaryRally(world.start)).toBe(true);
    for (let step = 0; step < 2400; step++) simulation.update(.05);
    const ids = new Set(simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 0)
      .map(soldier => soldier.actor));
    const bodies = simulation.frames().filter(actor => ids.has(actor.uid));
    expect(bodies).toHaveLength(30);
    expect(bodies.every(actor => actor.phase === "militaryField")).toBe(true);
    expect(bodies.every(actor => Math.hypot(actor.x - world.start.x, actor.z - world.start.z) < 10)).toBe(true);
  }, 60000);

  it("keeps soldiers ashore and still aboard from the banner once it is cancelled", () => {
    const { island, simulation, world } = createLanding();
    const troops = Array.from({ length: 20 }, () => ({ hp: 90, rank: 0, type: "heavy" as const }));
    expect(simulation.startAdventure({ island, troops }).ok).toBe(true);
    const banner = farReachablePoint(simulation, world);
    expect(simulation.plantMilitaryRally(banner)).toBe(true);
    for (let step = 0; step < 300; step++) simulation.update(.05);
    const phases = () => simulation.frames().filter(actor => actor.job === "Soldier").map(actor => actor.phase);
    expect(phases().some(phase => ADVENTURE_SHIP_PHASES.includes(phase))).toBe(true);
    expect(phases().some(phase => !ADVENTURE_SHIP_PHASES.includes(phase))).toBe(true);
    for (let step = 0; step < 200; step++) simulation.update(.05);
    const shore = simulation.adventure()!.landing!.shore;
    const marching = simulation.militarySoldiers().filter(soldier => soldier.combat?.destination)
      .map(soldier => soldier.actor);
    expect(marching.length).toBeGreaterThan(0);
    simulation.cancelMilitaryRally();
    expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
    for (let step = 0; step < 2400; step++) simulation.update(.05);
    // Those marching to the banner went back to gathering places on the beach, as later arrivals did.
    const context = { actors: simulation.frames(), buildings: [], occupied: new Uint8Array(96 * 96),
      options: { world }, reservations: new Set<string>() } as never;
    const slots = Array.from({ length: 40 }, (_, index) => gatherSlot(context, shore, index));
    const atSlot = (actor: { x: number; z: number }) =>
      slots.some(slot => Math.hypot(slot.x - actor.x, slot.z - actor.z) < 1.5);
    const gathered = simulation.frames().filter(actor => marching.includes(actor.uid));
    expect(gathered.every(actor => actor.phase === "militaryField" && atSlot(actor))).toBe(true);
    const own = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 0);
    expect(own.every(soldier => !soldier.combat?.destination)).toBe(true);
    const ids = new Set(own.map(soldier => soldier.actor));
    const bodies = simulation.frames().filter(actor => ids.has(actor.uid));
    expect(bodies).toHaveLength(20);
    expect(bodies.every(actor => Math.hypot(actor.x - banner.x, actor.z - banner.z) > 10)).toBe(true);
  }, 60000);
});
