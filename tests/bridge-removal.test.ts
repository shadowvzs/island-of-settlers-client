import { describe, expect, it } from "vitest";

import { bridgeDecks, deckCoordinates } from "../src/shared/settlement/bridge-deck";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import {
  addRoadSegments,
  axisRoad,
  createBridgeCrossingSettlement,
  CROSSING_BRIDGE_ID} from "./helpers/bridge-crossing-settlement";
import { BRIDGE_SCENE_RIVERS, bridgeRiverScene } from "./helpers/bridge-river-scene";
import { createAngledBridgeSettlement } from "./helpers/bridge-settlement";

type Crossing = ReturnType<typeof createBridgeCrossingSettlement>;

const advanceUntil = (fixture: { simulation: Crossing["simulation"] }, done: () => boolean, seconds = 600) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    if (done()) return true;
    fixture.simulation.update(0.1);
  }
  return done();
};

/** Over river water, unless on the deck while it still stands (a closed deck keeps its people). */
const inWater = (fixture: Crossing, actor: SettlementActor) => {
  if (!actor.visible) return false;
  if (fixture.world.walkCost[Math.floor(actor.z) * fixture.world.cellsX + Math.floor(actor.x)] !== 0) return false;
  const { across, along } = deckCoordinates(fixture.deck, actor);
  const standsOnDeck = along >= 0 && along <= fixture.deck.length && Math.abs(across) <= 1.25;
  return !(standsOnDeck && fixture.simulation.roadSegments().some(segment => segment.bridge));
};

/** A loaded carrier still on the west shore road, a few steps before the west anchor. */
const approachingCarrier = (fixture: Crossing) => fixture.loadedCarriers().find(actor => actor.visible &&
  fixture.fromWest(actor) > -3 && fixture.fromWest(actor) < -0.6);

/** Visibly on the deck, past both anchors. */
const standsOnDeck = (fixture: Crossing) => (actor: SettlementActor) => {
  const { across, along } = deckCoordinates(fixture.deck, actor);
  return actor.visible && along > 0.2 && along < fixture.deck.length - 0.2 && Math.abs(across) < 1.3;
};

const stock = (fixture: { simulation: Crossing["simulation"] }, ware: string) =>
  fixture.simulation.headquarters.inventory[ware] ?? 0;

const bridgeTilesLeft = (fixture: { simulation: Crossing["simulation"] }) =>
  fixture.simulation.roadSegments().filter(segment => segment.bridge);

describe("removing a completed bridge", () => {
  it("stops a loaded carrier on its bank with the cargo until a bridge returns, then delivers", () => {
    const fixture = createBridgeCrossingSettlement();
    const { simulation, woodcutter } = fixture;
    expect(advanceUntil(fixture, () => approachingCarrier(fixture) !== undefined)).toBe(true);
    const carrier = approachingCarrier(fixture)!;
    const cargo = carrier.ware;
    expect(simulation.removeBridge(CROSSING_BRIDGE_ID)).toEqual({ completed: true, ok: true, site: false });
    // The deck stands, closed: no route may use it any more.
    expect(bridgeTilesLeft(fixture).every(segment => segment.bridge!.closed)).toBe(true);
    expect(bridgeTilesLeft(fixture).length).toBeGreaterThan(0);
    expect(fixture.roads.route(fixture.westAnchor, fixture.eastAnchor)).toBeNull();
    expect(simulation.removeBridge(CROSSING_BRIDGE_ID)).toEqual({ ok: false, reason: "removing" });
    simulation.update(0.1);
    expect(carrier.bridgeWait).toBeDefined();
    const spot = { x: carrier.x, z: carrier.z };
    const crossers = new Set<number>();
    for (let tick = 0; tick < 900; tick++) {
      simulation.update(0.1);
      for (const actor of simulation.frames()) {
        expect(inWater(fixture, actor), `${actor.job} ${actor.uid} at ${actor.x}/${actor.z}`).toBe(false);
        if (actor.delivery?.destination === woodcutter.uid && !actor.bridgeWait && actor.visible &&
          fixture.fromWest(actor) > 0) crossers.add(actor.uid);
      }
    }
    // Ninety seconds later the bridge is gone, and the carrier still stands on the same spot with the
    // same cargo and delivery.
    expect(bridgeTilesLeft(fixture)).toEqual([]);
    expect(simulation.bridges()).toEqual([]);
    expect(Math.hypot(carrier.x - spot.x, carrier.z - spot.z)).toBeLessThan(0.05);
    expect(carrier.ware).toBe(cargo);
    expect(carrier.delivery?.destination).toBe(woodcutter.uid);
    expect(crossers.size, "no new delivery may cross the gap").toBe(0);

    fixture.rebuild();
    const delivered = () => (woodcutter.input[cargo!] ?? 0) + (woodcutter.constructionConsumed?.[cargo!] ?? 0);
    const before = delivered();
    expect(advanceUntil(fixture, () => carrier.bridgeWait === undefined, 1)).toBe(true);
    expect(advanceUntil(fixture, () => delivered() > before, 120)).toBe(true);
  });

  it("keeps waiting through the delivery lease, then returns its cargo to storage after five minutes", () => {
    const fixture = createBridgeCrossingSettlement();
    expect(advanceUntil(fixture, () => approachingCarrier(fixture) !== undefined)).toBe(true);
    const carrier = approachingCarrier(fixture)!;
    const cargo = carrier.ware!;
    fixture.simulation.removeBridge(CROSSING_BRIDGE_ID);
    const spot = { x: carrier.x, z: carrier.z };
    for (let elapsed = 0; elapsed < 290; elapsed += 0.5) fixture.simulation.update(0.5);
    expect(carrier.bridgeWait).toBeDefined();
    expect(carrier.ware).toBe(cargo);
    expect(Math.hypot(carrier.x - spot.x, carrier.z - spot.z)).toBeLessThan(0.05);
    const before = stock(fixture, cargo);
    for (let elapsed = 0; elapsed < 15 && carrier.bridgeWait; elapsed += 0.5) fixture.simulation.update(0.5);
    // Every carrier cut off with this ware brings it home; they enter the hall in single file.
    const returning = fixture.simulation.frames().filter(actor => actor.ware === cargo).length;
    expect(carrier.bridgeWait).toBeUndefined();
    expect(carrier.delivery).toBeUndefined();
    // It reappears at the headquarters' road access, then walks in and deposits the cargo.
    const home = fixture.simulation.headquarters;
    expect(Math.hypot(carrier.x - home.access.x, carrier.z - home.access.z)).toBeLessThan(1);
    // Every cut-off carrier gave up at the same time; each one fades exactly once.
    const fades = fixture.simulation.takeStorageFades();
    expect(fades).toContainEqual({ actor: carrier.uid, from: spot, to: { x: home.access.x, z: home.access.z } });
    expect(new Set(fades.map(fade => fade.actor)).size).toBe(fades.length);
    expect(fixture.simulation.takeStorageFades()).toEqual([]);
    expect(returning).toBeGreaterThan(0);
    expect(advanceUntil(fixture, () => stock(fixture, cargo) === before + returning, 60)).toBe(true);
    expect(carrier.ware).toBeNull();
  });

  it("lets everyone on the deck walk off, admits nobody new, then dismantles it in reverse", () => {
    const fixture = createBridgeCrossingSettlement();
    const { deck, simulation } = fixture;
    const onDeck = standsOnDeck(fixture);
    expect(advanceUntil(fixture, () => simulation.frames().some(onDeck))).toBe(true);
    const standing = new Set(simulation.frames().filter(onDeck).map(actor => actor.uid));
    simulation.removeBridge(CROSSING_BRIDGE_ID);
    expect(simulation.bridges()[0]!.removal).toEqual({ phase: "closing", progress: 1 });
    const progress: number[] = [];
    for (let tick = 0; tick < 900 && simulation.bridges().length; tick++) {
      simulation.update(0.1);
      for (const actor of simulation.frames()) {
        expect(inWater(fixture, actor), `${actor.uid} at ${actor.x}/${actor.z}`).toBe(false);
        if (onDeck(actor) && bridgeTilesLeft(fixture).length)
          expect(standing.has(actor.uid), `${actor.uid} stepped onto the closed deck`).toBe(true);
      }
      const removal = simulation.bridges()[0]?.removal;
      if (removal?.phase === "dismantling") progress.push(removal.progress);
    }
    expect(simulation.bridges()).toEqual([]);
    // The stages ran backwards over 2.5 s per tile, without a builder.
    expect(progress.length).toBeGreaterThan(5);
    expect(progress.every((value, index) => index === 0 || value <= progress[index - 1]!)).toBe(true);
    const seconds = progress.length * 0.1;
    expect(seconds).toBeGreaterThan(2.5 * deck.tiles - 0.5);
    expect(seconds).toBeLessThan(2.5 * deck.tiles + 0.5);
    for (let tick = 0; tick < 100; tick++) {
      simulation.update(0.1);
      for (const actor of simulation.frames()) expect(inWater(fixture, actor)).toBe(false);
    }
  });

  it("draws a dismantling bridge as a site whose stages run backwards (no stock pile)", () => {
    const fixture = createBridgeCrossingSettlement();
    const { simulation } = fixture;
    simulation.removeBridge(CROSSING_BRIDGE_ID);
    expect(simulation.bridgeSiteFrames()).toEqual([]);
    expect(advanceUntil(fixture, () => simulation.bridgeSiteFrames().length > 0, 70)).toBe(true);
    const [first] = simulation.bridgeSiteFrames();
    expect(first).toMatchObject({ dismantling: true, id: CROSSING_BRIDGE_ID, stage: "railings" });
    expect(first!.segments.every(segment => !segment.bridge!.closed)).toBe(true);
    expect(advanceUntil(fixture, () => simulation.bridgeSiteFrames()[0]?.stage === "foundations", 60)).toBe(true);
    expect(simulation.bridgeConstructions()).toEqual([]);
  });

  it("re-routes over a second bridge that remains", () => {
    const fixture = createBridgeCrossingSettlement();
    const { roads, simulation, tiles } = fixture;
    // A second deck upstream: the same crossing shifted along the river, with its own shore roads.
    const shift = (point: { x: number; z: number }) => ({ x: point.x - 3, z: point.z - 5 });
    const second = tiles.map(segment => ({ ...segment, bridge: { ...segment.bridge!, id: 2 },
      end: shift(segment.end), start: shift(segment.start) }));
    const deck = bridgeDecks(second)[0]!;
    const westBend = { x: deck.start.x - 2, z: deck.start.z }, eastBend = { x: 21, z: deck.end.z };
    expect(addRoadSegments(roads, [...second, ...axisRoad(deck.start, westBend),
      ...axisRoad(westBend, { x: westBend.x, z: 17 }), ...axisRoad(deck.end, eastBend),
      ...axisRoad(eastBend, { x: 21, z: 15.5 })])).toBe(true);
    expect(advanceUntil(fixture, () => approachingCarrier(fixture) !== undefined)).toBe(true);
    const carrier = approachingCarrier(fixture)!;
    simulation.removeBridge(CROSSING_BRIDGE_ID);
    expect(roads.route(fixture.westAnchor, fixture.eastAnchor)).not.toBeNull();
    simulation.update(0.1);
    expect(carrier.bridgeWait).toBeUndefined();
    expect(carrier.path.some(point => deckCoordinates(deck, point).along > 0.3 &&
      deckCoordinates(deck, point).along < deck.length - 0.3)).toBe(true);
  });

  it("saves a closing bridge and resolves a waiting carrier at load identically to a snapshot reload", () => {
    const live = createBridgeCrossingSettlement();
    expect(advanceUntil(live, () => approachingCarrier(live) !== undefined)).toBe(true);
    // A soldier stands on the deck, so the removal is still closing at the save (an empty deck comes down
    // at once); it is set on a bank at the 60 s safety timeout.
    const middle = { x: (live.deck.start.x + live.deck.end.x) / 2, z: (live.deck.start.z + live.deck.end.z) / 2 };
    const guard = live.simulation.spawnDebugSoldier(middle, { rank: 0, type: "shield" })!;
    expect(live.simulation.frames().filter(standsOnDeck(live)).map(actor => actor.uid)).toContain(guard.id);
    const carrier = approachingCarrier(live)!;
    const cargo = carrier.ware!;
    live.simulation.removeBridge(CROSSING_BRIDGE_ID);
    live.simulation.update(0.1);
    const saved = JSON.parse(JSON.stringify(live.simulation.saveState()));
    expect(saved.actors.find((actor: SettlementActor) => actor.uid === carrier.uid).bridgeWait).toBeDefined();
    expect(saved.bridgeRemovals).toMatchObject([{ id: CROSSING_BRIDGE_ID, phase: "closing" }]);
    const restored = createBridgeCrossingSettlement();
    const loaded = restored.simulation.loadState(saved);
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
    // The live island reloads its own snapshot in place (the upload reload): the same resolution.
    expect(live.simulation.reloadSnapshot(saved).ok).toBe(true);
    for (const fixture of [live, restored]) {
      const twin = fixture.simulation.frames().find(actor => actor.uid === carrier.uid)!;
      expect(twin.bridgeWait).toBeUndefined();
      expect(twin.ware).toBe(cargo);
      for (let tick = 0; tick < 900; tick++) fixture.simulation.update(0.1);
      expect(fixture.simulation.bridges()).toEqual([]);
    }
    expect(stock(restored, cargo)).toBe(stock(live, cargo));
    expect(restored.simulation.counterChecksum()).toBe(live.simulation.counterChecksum());
  });

  it("saves and loads a bridge mid-dismantling", () => {
    const live = createBridgeCrossingSettlement();
    live.simulation.removeBridge(CROSSING_BRIDGE_ID);
    expect(advanceUntil(live, () => live.simulation.bridgeSiteFrames().length > 0, 70)).toBe(true);
    live.simulation.update(1);
    const saved = JSON.parse(JSON.stringify(live.simulation.saveState()));
    expect(saved.bridgeRemovals).toMatchObject([{ id: CROSSING_BRIDGE_ID, phase: "dismantling" }]);
    const restored = createBridgeCrossingSettlement();
    expect(restored.simulation.loadState(saved)).toEqual({ ok: true });
    expect(restored.simulation.bridgeSiteFrames()).toEqual(live.simulation.bridgeSiteFrames());
    // A tampered removal is refused: a dismantling bridge must be gone from the roads.
    const forged = { ...saved, bridgeRemovals: [{ ...saved.bridgeRemovals[0], phase: "closing" }] };
    expect(restored.simulation.loadState(forged).ok).toBe(false);
  });

  it("routes the Road tool's remove on a bridge tile through the bridge rules", () => {
    const fixture = createBridgeCrossingSettlement();
    expect(advanceUntil(fixture, () => approachingCarrier(fixture) !== undefined)).toBe(true);
    const carrier = approachingCarrier(fixture)!;
    const tile = fixture.tiles[1]!;
    expect(fixture.simulation.removeRoad(tile.start, tile.end)).toBe(true);
    expect(bridgeTilesLeft(fixture).every(segment => segment.bridge!.closed)).toBe(true);
    fixture.simulation.update(0.1);
    expect(carrier.bridgeWait).toBeDefined();
  });

  it("replays removal to the same checksum (verifier parity)", () => {
    const live = createBridgeCrossingSettlement();
    expect(advanceUntil(live, () => approachingCarrier(live) !== undefined)).toBe(true);
    const base = live.simulation.saveState();
    const recorder = createCommandLogRecorder(live.simulation, { sourceVersion: "bridge-panel" });
    recorder.open();
    live.advance(1);
    expect(live.simulation.removeBridge(CROSSING_BRIDGE_ID).ok).toBe(true);
    live.advance(90);
    expect(live.simulation.bridges()).toEqual([]);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toContain("removeBridge");
    const replay = createBridgeCrossingSettlement();
    expect(replay.simulation.loadState(base).ok).toBe(true);
    expect(replayCommandLog(replay.simulation, interval, { rejectDebug: false }))
      .toEqual({ ok: true, endChecksum: interval.endChecksum });
    recorder.dispose();
  });
});

describe("removing a bridge under construction", () => {
  it("returns delivered and in-transit materials like a cancelled site", () => {
    const fixture = createAngledBridgeSettlement();
    const { simulation } = fixture;
    const before = { logs: stock(fixture, "logs"), planks: stock(fixture, "planks") };
    const built = simulation.buildBridge(fixture.pointer, "wood", fixture.westAnchor);
    if (!built.ok) throw new Error(built.reason);
    expect(advanceUntil(fixture, () => {
      const site = simulation.bridgeConstructions()[0]!;
      const delivered = Object.values(site.delivered).reduce((sum, count) => sum + count, 0);
      const incoming = Object.values(site.incoming).reduce((sum, count) => sum + count, 0);
      return delivered > 0 && incoming > 0;
    })).toBe(true);
    const consumed = simulation.bridgeConstructions()[0]!.consumed;
    expect(simulation.removeBridge(built.id)).toEqual({ completed: false, ok: true, site: true });
    expect(simulation.bridgeConstructions()).toEqual([]);
    expect(simulation.removeBridge(built.id)).toEqual({ ok: false, reason: "missing" });
    // Carriers walk their cargo back; consumed work is lost, everything else returns to storage.
    const carrying = () => simulation.frames().some(actor => actor.ware === "logs" || actor.ware === "planks");
    expect(advanceUntil(fixture, () => !carrying(), 300)).toBe(true);
    expect(stock(fixture, "logs")).toBe(before.logs - (consumed.logs ?? 0));
    expect(stock(fixture, "planks")).toBe(before.planks - (consumed.planks ?? 0));
  });
});

describe("soldiers on a removed bridge", () => {
  for (const [label, river] of BRIDGE_SCENE_RIVERS)
    it(`sets a marching squad on the ${label} deck on the banks and keeps it out of the river`, () => {
      const { east, onDeck, placeProblem, simulation, west } = bridgeRiverScene(river, "stone");
      const ids = Array.from({ length: 8 }, (_, index) => simulation.spawnDebugSoldier(
        { x: west.x - 6 - (index % 2), z: west.z - 2 + Math.floor(index / 2) },
        { rank: 0, type: (["shield", "heavy", "archer"] as const)[index % 3]! })!.id);
      expect(simulation.commandMilitary(ids, { x: east.x + 7, z: east.z }, "move")).toBe(true);
      const soldiers = () => simulation.frames().filter(frame => ids.includes(frame.uid) && frame.visible);
      let ticks = 0;
      while (soldiers().filter(onDeck).length < 2 && ticks++ < 20 * 120) simulation.update(0.05);
      expect(soldiers().filter(onDeck).length).toBeGreaterThanOrEqual(2);
      const id = simulation.bridges()[0]!.id;
      expect(simulation.removeBridge(id).ok).toBe(true);
      for (let tick = 0; tick < 20 * 60; tick++) {
        simulation.update(0.05);
        for (const frame of soldiers())
          expect(placeProblem(frame), `${frame.uid} at ${frame.x}/${frame.z}`).toBeNull();
      }
    });

  it("sets a soldier who stays on the closed deck on the nearer bank after the 60 s safety timeout", () => {
    const [, river] = BRIDGE_SCENE_RIVERS[0]!;
    const { east, onDeck, placeProblem, simulation, west } = bridgeRiverScene(river, "wood");
    const id = simulation.spawnDebugSoldier({ x: west.x - 3, z: west.z }, { rank: 0, type: "shield" })!.id;
    const middle = { x: (west.x + east.x) / 2, z: (west.z + east.z) / 2 };
    expect(simulation.commandMilitary([id], middle, "move")).toBe(true);
    const soldier = () => simulation.frames().find(frame => frame.uid === id)!;
    let ticks = 0;
    while (!(onDeck(soldier()) && soldier().action === "idle") && ticks++ < 20 * 60) simulation.update(0.05);
    expect(onDeck(soldier())).toBe(true);
    const bridge = simulation.bridges()[0]!.id;
    expect(simulation.removeBridge(bridge).ok).toBe(true);
    for (let tick = 0; tick < 20 * 59; tick++) simulation.update(0.05);
    expect(simulation.bridges()[0]?.removal?.phase).toBe("closing");
    expect(onDeck(soldier())).toBe(true);
    for (let tick = 0; tick < 20 * 2; tick++) simulation.update(0.05);
    expect(simulation.bridges()[0]?.removal?.phase).toBe("dismantling");
    expect(onDeck(soldier())).toBe(false);
    expect(placeProblem(soldier())).toBeNull();
  });
});
