import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { COLONY_SUPPLIES } from "../src/shared/balance/colonies";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { commanderMaximumHealth } from "../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 64, COAST = 36;
const world = () => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { seed: 4, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 12.5, z: 12.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  return data;
};

/** Home island with a lodge, a completed harbour, one idle ship and stored troops. */
const fixture = () => {
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const data = world();
  const roads = createRoadNetwork(data, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world: data, roads, initialSettlers: 30, canWorkerEnterPlot: () => true,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 50, shield: 6, stone: 50, sword: 6 }, playerLevel: () => 23 });
  const [harbourWidth, harbourDepth] = getBuildingDefinition(39).gridFootprint;
  const placedHarbour = simulation.placeBuilding(39,
    Math.floor(32 - harbourWidth / 2) + harbourWidth / 2, Math.floor(20 - harbourDepth / 2) + harbourDepth / 2);
  expect(placedHarbour.ok, placedHarbour.reason).toBe(true);
  const harbour = placedHarbour.building!;
  Object.assign(harbour, { construction: 1, input: {}, required: {}, worker: undefined });
  expect(simulation.connectRoads(simulation.headquarters.access, harbour.access)).toBe(true);
  const [lodgeWidth, lodgeDepth] = getBuildingDefinition(62).gridFootprint;
  const placedLodge = simulation.placeBuilding(62,
    Math.floor(24 - lodgeWidth / 2) + lodgeWidth / 2, Math.floor(20 - lodgeDepth / 2) + lodgeDepth / 2);
  expect(placedLodge.ok, placedLodge.reason).toBe(true);
  const lodge = placedLodge.building!;
  Object.assign(lodge, { construction: 1, foundationProgress: 1, required: {}, worker: undefined });
  expect(simulation.connectRoads(simulation.headquarters.access, lodge.access)).toBe(true);
  expect(simulation.startMilitaryTrainingEncounter().ok).toBe(true);
  const saved = simulation.saveState();
  const hostile = new Set(saved.military!.soldiers.filter(soldier => soldier.combat?.faction).flatMap(soldier =>
    [soldier.actor, soldier.combat?.mount]));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !hostile.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !hostile.has(actor.uid));
  saved.naval.fleet.ships.push({ id: 1, x: 44.5, y: -1, z: 20.5, yaw: 0, phase: "idle", cargoCount: 0, cargo: {},
    route: [], cursor: 0, timer: 0 });
  saved.naval.fleet.nextShip = 2;
  const loaded = simulation.loadState(saved);
  expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
  const home = simulation.buildings().find(building => building.uid === harbour.uid)!;
  home.inventory = { ...home.inventory, ...COLONY_SUPPLIES };
  const advance = (seconds: number) => { for (let second = 0; second < seconds; second++) simulation.update(1); };
  return { advance, harbour: home, lodge, roads, simulation };
};

const easyIsland = (simulation: ReturnType<typeof fixture>["simulation"]) =>
  simulation.colonyIslands().find(island => island.difficulty === "easy")!;

describe("commander expedition transport", () => {
  it("walks a road-surrounded lodge and busy harbour approach, reloads, and boards once", () => {
    const { advance, harbour, lodge, roads, simulation } = fixture();
    const dx = lodge.width / 2 + 1.5, dz = lodge.depth / 2 + 1.5;
    const corners = [
      { x: lodge.x - dx, z: lodge.z - dz }, { x: lodge.x + dx, z: lodge.z - dz },
      { x: lodge.x + dx, z: lodge.z + dz }, { x: lodge.x - dx, z: lodge.z + dz }
    ];
    for (let index = 0; index < corners.length; index++) {
      const from = corners[index]!, to = corners[(index + 1) % corners.length]!;
      roads.addRoad(from, to);
      expect(roads.route(from, to)).not.toBeNull();
    }
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    simulation.transferWare(simulation.headquarters.uid, harbour.uid, "planks", 12);
    const island = easyIsland(simulation);
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id).ok)
      .toBe(true);
    advance(8);
    expect(simulation.commanderTransport()!.phase).not.toBe("reserved");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    for (let second = 0; second < 900 && !simulation.colonyExpeditions()[0]!.departed; second++) advance(1);
    expect(simulation.colonyExpeditions()[0]!.departed).toBe(1);
    expect(simulation.commanderTransport()).toMatchObject({ id: commander.id, location: "away" });
    expect(simulation.militarySoldiers().some(soldier => soldier.commanderId === commander.id)).toBe(false);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30_000);

  it("reserves two deck slots, musters on real ground and sails in the first load", () => {
    const { advance, harbour, lodge, simulation } = fixture();
    const recruited = simulation.recruitCommander(lodge.uid);
    expect(recruited).toMatchObject({ ok: true });
    const commander = simulation.commanderSnapshot()!;
    const island = easyIsland(simulation);
    expect(simulation.planColonyExpedition(harbour.uid, island.id, { shield: 8 }, commander.id))
      .toMatchObject({ commanderDeckSlots: 2, commanderTroopCap: 1, loads: 1 });
    const started = simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id);
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    expect(simulation.commanderTransport()).toMatchObject({ id: commander.id, phase: "reserved" });
    advance(30);
    const transport = simulation.commanderTransport()!;
    expect(["muster", "waiting", "aboard"]).toContain(transport.phase);
    // The commander walks out of the lodge: it is not a hidden storage copy while mustering.
    if (transport.phase === "muster") {
      const actor = simulation.frames().find(frame => frame.job === "Soldier" && frame.visible &&
        Math.hypot(frame.x - lodge.doorThreshold.x, frame.z - lodge.doorThreshold.z) > .5);
      expect(actor).toBeDefined();
    }
    for (let second = 0; second < 600 && simulation.colonyExpeditions()[0]!.departed === 0; second++) {
      advance(1);
    }
    const sailing = simulation.colonyExpeditions()[0]!;
    expect(sailing.departed).toBe(1);
    expect(sailing.commander).toMatchObject({ hp: commander.hp, id: commander.id });
    expect(simulation.commanderTransport()).toMatchObject({ location: "away", phase: "deployed" });
    expect(simulation.militarySoldiers().some(soldier => soldier.commanderId === commander.id)).toBe(false);
    const reloaded = simulation.loadState(simulation.saveState());
    expect(reloaded.ok, reloaded.ok ? "" : reloaded.reason).toBe(true);
    expect(simulation.commanderTransport()).toMatchObject({ location: "away", phase: "deployed" });
  }, 30000);

  it("refuses a second claim and releases a cancelled preparation to the lodge", () => {
    const { advance, harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const island = easyIsland(simulation);
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id).ok).toBe(true);
    expect(simulation.commanderTransport()!.phase).toBe("reserved");
    const id = simulation.colonyExpeditions()[0]!.id;
    expect(simulation.cancelColonyExpedition(id)).toBe(true);
    advance(10);
    expect(simulation.commanderTransport()).toMatchObject({ location: "lodge", phase: undefined });
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id).ok).toBe(true);
  }, 30000);

  it("blocks the launch when the selected commander is too injured", () => {
    const { harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const saved = simulation.saveState();
    saved.military!.soldiers = saved.military!.soldiers.map(soldier => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .4 } } : soldier);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const island = easyIsland(simulation);
    const plan = simulation.planColonyExpedition(harbour.uid, island.id, { shield: 8 }, commander.id);
    expect(plan.launchReason).toMatch(/injured|HP/i);
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id))
      .toMatchObject({ ok: false });
    expect(simulation.commanderTransport()).toMatchObject({ location: "lodge" });
  });

  it("awards XP once at the destination victory boundary", () => {
    const { advance, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    expect(simulation.awardCommanderExperience("victory-1")).toBe(false);
    const saved = simulation.saveState();
    saved.military!.commander = { ...saved.military!.commander!, location: "field", transport: {
      destinationName: "Test colony", operationId: 1, phase: "deployed" } };
    saved.actors = saved.actors.map(actor => actor.uid === saved.military!.soldiers.find(soldier =>
      soldier.commanderId)!.actor ? { ...actor, phase: "militaryField", visible: true } : actor);
    saved.military!.soldiers = saved.military!.soldiers.map(soldier => soldier.commanderId
      ? { ...soldier, building: -3 } : soldier);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.awardCommanderExperience("victory-1")).toBe(true);
    expect(simulation.awardCommanderExperience("victory-1")).toBe(false);
    expect(simulation.commanderSnapshot()).toMatchObject({ id: commander.id, xp: 1 });
    advance(1);
    expect(simulation.commanderSnapshot()!.xp).toBe(1);
  });

  it("reserves the sixteenth deck slot for fourteen foot troops and one commander", () => {
    const { harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const island = simulation.adventureIslands().find(entry => entry.difficulty === "easy")!;
    expect(simulation.planAdventureExpedition(harbour.uid, island.id, { shield: 14 }, commander.id))
      .toMatchObject({ loads: 1 });
    expect(simulation.planAdventureExpedition(harbour.uid, island.id, { shield: 15 }, commander.id))
      .toMatchObject({ loads: 2 });
  });

  it("resumes a saved muster and still boards without teleporting", () => {
    const { advance, harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const island = easyIsland(simulation);
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id).ok).toBe(true);
    advance(8);
    const savedPhase = simulation.commanderTransport()!.phase;
    expect(["muster", "waiting"]).toContain(savedPhase);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(simulation.commanderTransport()!.phase).toBe(savedPhase);
    for (let second = 0; second < 600 && simulation.colonyExpeditions()[0]!.departed === 0; second++) advance(1);
    expect(simulation.colonyExpeditions()[0]!.departed).toBe(1);
  }, 30000);

  it("stabilizes a returning casualty at 1 HP and starts the concurrent recovery at home", () => {
    const { advance, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const saved = simulation.saveState();
    const soldier = saved.military!.soldiers.find(entry => entry.commanderId === commander.id)!;
    const leaving = new Set([soldier.actor, soldier.combat?.mount]);
    saved.military!.soldiers = saved.military!.soldiers.filter(entry => entry.actor !== soldier.actor);
    saved.actors = saved.actors.filter(actor => !leaving.has(actor.uid));
    saved.military!.commander = { ...saved.military!.commander!, awayHp: 0, location: "away",
      operationId: 1, destinationName: "Test colony",
      transport: { destinationName: "Test colony", operationId: 1, phase: "deployed" } };
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    simulation.receiveTroops([{ commander: {
      casualty: true, destinationName: "Test colony", healingSeconds: 0, homeIslandSeed: 4,
      hp: 0, id: commander.id, level: 1, maximumHp: commanderMaximumHealth(1), name: commander.name,
      nation: commander.nation, operationId: 1, phase: "returning", recoverySeconds: 0, xp: 0
    }, hp: 0, rank: 0, type: "cavalry" }]);
    expect(simulation.commanderTransport()).toMatchObject({ hp: 1, location: "recovering" });
    expect(simulation.commanderState()).toMatchObject({ location: "recovering", recoverySeconds: 1800 });
    advance(61);
    expect(simulation.commanderState()!.recoverySeconds).toBeLessThan(1800);
    expect(simulation.commanderTransport()!.hp).toBeCloseTo(1 + commanderMaximumHealth(1) * .01, 5);
    expect(simulation.militarySoldiers().filter(entry => entry.commanderId === commander.id)).toHaveLength(1);
  }, 30000);

  it("keeps the roster identity when the lodge is lost and refuses a missing ship", () => {
    const { harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const island = easyIsland(simulation);
    expect(simulation.demolishBuilding(lodge.uid).ok).toBe(true);
    expect(simulation.commanderTransport()).toMatchObject({ id: commander.id });
    expect(simulation.militarySoldiers().filter(entry => entry.commanderId === commander.id)).toHaveLength(1);
    expect(simulation.commanderTransport()!.blockReason).toBe("missing-home");
    expect(simulation.planColonyExpedition(harbour.uid, island.id, { shield: 8 }, commander.id).launchReason)
      .toMatch(/Commander's Lodge/);
    // A separate home with no idle ship refuses before any commander claim.
    const other = fixture();
    expect(other.simulation.recruitCommander(other.lodge.uid).ok).toBe(true);
    const otherCommander = other.simulation.commanderSnapshot()!;
    const saved = other.simulation.saveState();
    saved.naval.fleet.ships = [];
    expect(other.simulation.loadState(saved)).toEqual({ ok: true });
    expect(other.simulation.planColonyExpedition(other.harbour.uid, easyIsland(other.simulation).id,
      { shield: 8 }, otherCommander.id).launchReason).toMatch(/idle player-owned ship/);
    expect(other.simulation.startColonyExpedition(other.harbour.uid, easyIsland(other.simulation).id,
      { shield: 8 }, false, otherCommander.id)).toMatchObject({ ok: false });
    expect(other.simulation.commanderTransport()).toMatchObject({ location: "lodge" });
  }, 30000);

  it("cancels a queued load before departure and hands the commander back to the lodge", () => {
    const { advance, harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    const island = easyIsland(simulation);
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }, false, commander.id).ok).toBe(true);
    for (let second = 0; second < 300 && simulation.colonyExpeditions()[0]!.status !== "sailing"; second++) advance(1);
    expect(simulation.colonyExpeditions()[0]!.status).toBe("sailing");
    expect(simulation.cancelColonyExpedition(simulation.colonyExpeditions()[0]!.id)).toBe(true);
    expect(simulation.colonyExpeditions()).toHaveLength(0);
    expect(simulation.militarySoldiers().filter(soldier => soldier.commanderId === commander.id)).toHaveLength(1);
    advance(20);
    expect(simulation.commanderTransport()).toMatchObject({ id: commander.id });
    expect(["lodge", "returning"]).toContain(simulation.commanderTransport()!.location);
  }, 30000);

  it("cancels the preparation when the assigned lodge is demolished", () => {
    const { advance, harbour, lodge, simulation } = fixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderSnapshot()!;
    expect(simulation.startColonyExpedition(harbour.uid, easyIsland(simulation).id,
      { shield: 8 }, false, commander.id).ok).toBe(true);
    advance(2);
    expect(simulation.demolishBuilding(lodge.uid).ok).toBe(true);
    advance(3);
    expect(simulation.colonyExpeditions()).toHaveLength(0);
    expect(simulation.militarySoldiers().filter(soldier => soldier.commanderId === commander.id)).toHaveLength(1);
    expect(simulation.commanderTransport()).toMatchObject({ id: commander.id });
    expect(["awaiting-home", "lodge"]).toContain(simulation.commanderTransport()!.location);
  }, 30000);
});
