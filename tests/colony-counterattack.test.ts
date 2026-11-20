import { describe, expect, it, vi } from "vitest";

import { COUNTERATTACK_GARRISON_MINIMUM, FIRST_RAID_SHIP_SECONDS } from "../src/shared/balance/colonies";
import { type ColonyDifficulty,colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { colonyCounterattackError, raidShipId } from "../src/shared/settlement/settlement-colony-counterattack";
import {
  raidApproachDistance, raidApproachSeconds, raidDepartureDistance
} from "../src/shared/settlement/settlement-raid-ship-course";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { FactionAiMode } from "../src/shared/world/scenario-faction-ai";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * Colony counterattacks (owner decisions 2026-10-13, battle-ai-plan section 6a.8): they begin once the
 * player has destroyed a fort (colony forts are never captured) and come from the remaining forts.
 */
type Simulation = ReturnType<typeof createSettlementSimulation>;

/**
 * `aiMode`: the colony's computer faction plays this economy AI mode (a map's `factionAi` entry).
 * `seed`: the world seed whose island offers hold the colony.
 */
const colony = (difficulty: ColonyDifficulty, aiMode?: FactionAiMode, seed = 1234) => {
  const island = colonyIslandOffers(seed).find(entry => entry.difficulty === difficulty)!;
  const world = chooseColonyWorld(island);
  if (aiMode) world.scenario = { ...(world.scenario ?? createMapScenario()), factionAi: [
    { faction: 1, mode: aiMode, start: { settlers: 10, stock: {} } }
  ], kind: "colony" };
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 2,
    initialStock: {}, now: () => 5000, roads, world });
  const troops = Array.from({ length: 4 }, () => ({ hp: 150, rank: 1, type: "heavy" as const }));
  expect(simulation.startColony({ island, landed: {}, troops }).ok).toBe(true);
  return simulation;
};

/** The hostile fort nearest the harbour falls: its guards are dead and its walls burn (5 s, still standing). */
const destroyNearestFort = (simulation: Simulation) => {
  const home = simulation.headquarters;
  const fort = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0)
    .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0]!;
  const saved = simulation.saveState();
  const guards = new Set(saved.military!.soldiers.filter(soldier => soldier.building === fort.uid)
    .map(soldier => soldier.actor));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !guards.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !guards.has(actor.uid));
  Object.assign(saved.military!.combat!.doors.find(door => door.building === fort.uid)!.structure!,
    { fallen: 0, hp: 0 });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  return fort.uid;
};

const advance = (simulation: Simulation, seconds: number, each?: () => void) => {
  for (let tick = 0; tick < seconds * 20; tick++) { simulation.update(.05); each?.(); }
};
const hostile = (simulation: Simulation) =>
  simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);
/** Enemy soldiers that left their fort to attack. */
const raiders = (simulation: Simulation) => hostile(simulation).filter(soldier => !soldier.stationed);

describe("colony counterattacks", () => {
  it("never counterattacks on easy", () => {
    const simulation = colony("easy");
    destroyNearestFort(simulation);
    advance(simulation, 120);
    expect(raiders(simulation)).toHaveLength(0);
    expect(hostile(simulation).every(soldier => soldier.stationed)).toBe(true);
  }, 60_000);

  it("sends spare defenders over land from medium once a fort is destroyed, keeping garrisons manned", () => {
    const simulation = colony("medium");
    let early = 0;
    advance(simulation, 60, () => { early = Math.max(early, raiders(simulation).length); });
    expect(early).toBe(0);
    destroyNearestFort(simulation);
    let sent = 0;
    advance(simulation, 70, () => { sent = Math.max(sent, raiders(simulation).length); });
    expect(sent).toBeGreaterThan(0);
    for (const site of simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0)) {
      const garrison = hostile(simulation).filter(soldier => soldier.building === site.uid && soldier.stationed);
      expect(garrison.length).toBeGreaterThanOrEqual(Math.min(COUNTERATTACK_GARRISON_MINIMUM, garrison.length));
    }
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 60_000);

  it("sends no timed counterattack while the colony's faction develops, and resumes when it stops (EAI4c)", () => {
    const simulation = colony("medium", "develop");
    destroyNearestFort(simulation);
    let sent = 0;
    advance(simulation, 90, () => { sent = Math.max(sent, raiders(simulation).length); });
    expect(sent).toBe(0);
    expect(simulation.saveState().colony?.counterattack).toBeUndefined();
    const saved = simulation.saveState();
    saved.factionAi![0]!.mode = "maintain";
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(simulation, 70, () => { sent = Math.max(sent, raiders(simulation).length); });
    expect(sent).toBeGreaterThan(0);
  }, 90_000);

  it("keeps the timed counterattacks of a colony whose faction maintains (EAI4c)", () => {
    const simulation = colony("medium", "maintain");
    destroyNearestFort(simulation);
    let sent = 0;
    advance(simulation, 70, () => { sent = Math.max(sent, raiders(simulation).length); });
    expect(sent).toBeGreaterThan(0);
  }, 90_000);

  it("lets the counterattack party press its raid without retreating", () => {
    const simulation = colony("medium");
    destroyNearestFort(simulation);
    const field = () => new Set(simulation.frames().filter(actor => actor.phase === "militaryField")
      .map(actor => actor.uid));
    let raided = 0, retreats = 0;
    advance(simulation, 130, () => {
      const inField = field(), party = raiders(simulation).filter(soldier => inField.has(soldier.actor));
      raided = Math.max(raided, party.length);
      retreats += party.filter(soldier => soldier.combat?.order === "retreat").length;
    });
    expect(raided).toBeGreaterThan(0);
    expect(retreats).toBe(0);
  }, 90_000);

  it("sails the raid ship in at cruising speed and brakes evenly to rest at its anchorage", () => {
    const span = 16, duration = raidApproachSeconds(span);
    const sailed = Array.from({ length: 101 }, (_, step) =>
      raidApproachDistance(duration * step / 100, span, duration));
    expect(sailed.at(-1)).toBeCloseTo(span);
    const speeds = sailed.slice(1).map((value, index) => value - sailed[index]!);
    // Never backwards, no jump, and the last stretch is far slower than the cruise.
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0);
    expect(speeds.at(-1)!).toBeLessThan(speeds[0]! / 10);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(speeds[0]! + 1e-9);
    // Saves from before the braking: a constant speed all the way in.
    expect(raidApproachDistance(2, 8, 4)).toBeCloseTo(4);
    // Sailing away is the approach in reverse: from rest, gathering way, then cruising out.
    const away = Array.from({ length: 101 }, (_, step) =>
      raidDepartureDistance(duration * step / 100, span, duration));
    expect(away[0]).toBeCloseTo(0);
    expect(away.at(-1)).toBeCloseTo(span);
    expect(away[1]! - away[0]!).toBeLessThan(speeds[0]! / 10);
  });

  it("alternates the raid ship id per launch, so successive raids sail both pirate hulls", () => {
    // The renderer picks the pirate hull by id parity (pirateShipVariant): odd Red Viper, even Blackwake.
    const launches = [undefined, 1, 2, 3, 4];
    expect(launches.map(count => raidShipId(count)))
      .toEqual([1_900_001, 1_900_001, 1_900_002, 1_900_001, 1_900_002]);
    const saved = { landTime: 1, raiders: [], shipTime: 1 };
    expect(colonyCounterattackError({ ...saved, launches: 2 })).toBe(false);
    expect(colonyCounterattackError({ ...saved, launches: -1 })).toBe(true);
  });

  it("sails the empty raid ship away along its heading once its troops are ashore", () => {
    // Seed 3's hard island: open water ahead of the raid anchorage (seed 1234's has none: its ship is gone
    // at once, as before).
    const simulation = colony("hard", undefined, 3);
    destroyNearestFort(simulation);
    const waiting = simulation.saveState();
    waiting.colony!.counterattack = { landTime: 2000, raiders: [], shipTime: .05 };
    expect(simulation.loadState(waiting)).toEqual({ ok: true });
    let anchorage: { x: number; z: number } | undefined, sailedAway = 0, reloaded = false;
    advance(simulation, 150, () => {
      const raid = simulation.shipFrames().find(frame => frame.livery === "enemy");
      if (raid?.phase === "idle") anchorage = { x: raid.x, z: raid.z };
      if (raid?.phase !== "sailing" || !anchorage) return;
      // Weighing anchor takes the gangway in; the ship keeps its heading and gathers way.
      expect(simulation.shipSites().some(site => site.id === raid.id)).toBe(false);
      sailedAway = Math.max(sailedAway, Math.hypot(raid.x - anchorage.x, raid.z - anchorage.z));
      if (reloaded || sailedAway < 2) return;
      reloaded = true;
      expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
      expect(simulation.shipFrames().find(frame => frame.livery === "enemy")).toMatchObject({ x: raid.x, z: raid.z });
    });
    expect(reloaded).toBe(true);
    expect(sailedAway).toBeGreaterThan(20);
    expect(simulation.shipFrames().some(frame => frame.livery === "enemy")).toBe(false);
  }, 120_000);

  it("lands troops by ship on hard: visible on deck, down the gangway, then they attack by land", () => {
    const simulation = colony("hard");
    destroyNearestFort(simulation);
    // Only the ship: the preceding test exercises the normal land counterattack.
    const waiting = simulation.saveState();
    waiting.colony!.counterattack = { landTime: 200, raiders: [], shipTime: FIRST_RAID_SHIP_SECONDS };
    expect(simulation.loadState(waiting)).toEqual({ ok: true });
    let ship = false, onDeck = false, saved = false;
    let firstSailing: { x: number; z: number } | undefined;
    let sailed = false;
    const crew = new Set<number>();
    advance(simulation, 100, () => {
      const raid = simulation.shipFrames().find(frame => frame.livery === "enemy");
      ship ||= Boolean(raid);
      if (raid?.phase === "sailing") {
        firstSailing ??= { x: raid.x, z: raid.z };
        sailed ||= Math.hypot(raid.x - firstSailing.x, raid.z - firstSailing.z) > 1;
        expect(simulation.shipSites().some(site => site.id === raid.id)).toBe(false);
      }
      const deck = simulation.frames().filter(actor => actor.phase === "adventureAboard" && actor.visible);
      onDeck ||= Boolean(raid) && deck.length > 0 && deck.every(actor => actor.y > raid!.y);
      for (const actor of deck) crew.add(actor.uid);
      if (!onDeck || saved) return;
      saved = true;
      const deckPoses = deck.map(actor => ({ uid: actor.uid, phase: actor.phase,
        visible: actor.visible, x: actor.x, y: actor.y, z: actor.z }));
      expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
      for (const pose of deckPoses)
        expect(simulation.frames().find(actor => actor.uid === pose.uid)).toMatchObject(pose);
    });
    expect(ship).toBe(true);
    expect(sailed).toBe(true);
    expect(onDeck).toBe(true);
    let landed = 0, nearest = Infinity;
    const home = simulation.headquarters;
    advance(simulation, 60, () => {
      const ashore = simulation.frames().filter(actor => crew.has(actor.uid) && actor.phase === "militaryField");
      landed = Math.max(landed, ashore.length);
      for (const actor of ashore)
        nearest = Math.min(nearest, Math.hypot(actor.x - home.access.x, actor.z - home.access.z));
    });
    expect(landed).toBeGreaterThan(0);
    // Ashore, they march on the player (the harbour, where the landed troops are stored).
    expect(nearest).toBeLessThan(12);
    // With nothing there to fight (no soldier, military building or civilian outside) they walk back
    // to a computer fort: they re-enter its garrison, or leave the field at its door (full, riders).
    advance(simulation, 120);
    const left = simulation.militarySoldiers().filter(soldier => crew.has(soldier.actor));
    expect(left.length).toBeGreaterThan(0);
    expect(left.every(soldier => soldier.stationed &&
      (simulation.buildings().find(site => site.uid === soldier.building)?.militaryFaction ?? 0) > 0)).toBe(true);
  }, 120_000);
});
