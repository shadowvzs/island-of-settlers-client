import { describe, expect, it } from "vitest";

import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { navalPassengerFixture as fixture } from "./helpers/naval-passenger-fixture";

const startLanding = (create = fixture, waitForFoundation = true) => {
  const created = create();
  const { simulation, source } = created;
  const initialStock = { ...simulation.saveState().storagePools.pools.find(pool => pool.id === source.storagePoolId)!.available };
  const point = simulation.seaExpeditionDestinations(source.uid)[0]!;
  const orderId = simulation.queueSeaExpedition(source.uid, point)!;
  for (let tick = 0; tick < 12000 && (waitForFoundation ? simulation.saveState().naval.founding.operations[0]?.stage !== "foundation" :
      !simulation.saveState().naval.founding.operations.length);
    tick++) simulation.update(.05);
  return { ...created, initialStock, orderId, outpost: simulation.buildings().find(building => building.foundedByExpedition)! };
};
const mutate = (save: SettlementSaveV1, change: (copy: SettlementSaveV1) => void) => {
  const copy = JSON.parse(JSON.stringify(save)) as SettlementSaveV1;
  change(copy);
  return copy;
};

describe("ISLAND-07 founding recovery and persistence", () => {
  it("walks the crew continuously over a saved physical pier before beginning the foundation", () => {
    const { simulation } = startLanding(fixture, false);
    const operation = () => simulation.saveState().naval.founding.operations[0]!;
    const ids = [operation().builder, operation().leveler, operation().carrier];
    const phases = new Set<string>();
    const previous = new Map<number, { x: number; z: number; visible: boolean }>();
    let resumed = false, maximumStep = 0;
    for (let tick = 0; tick < 4000 && operation().stage === "landing"; tick++) {
      simulation.update(.05);
      const saved = structuredClone(simulation.saveState());
      for (const actor of saved.actors.filter(actor => ids.includes(actor.uid))) {
        phases.add(actor.phase);
        const before = previous.get(actor.uid);
        if (before?.visible && actor.visible)
          maximumStep = Math.max(maximumStep, Math.hypot(actor.x - before.x, actor.z - before.z));
        previous.set(actor.uid, { x: actor.x, z: actor.z, visible: actor.visible });
        if (!resumed && actor.phase === "foundingLandingPier") {
          expect(simulation.shipSites().some(frame => frame.kind === "dock" && frame.workPier)).toBe(true);
          expect(simulation.loadState(saved)).toEqual({ ok: true });
          const restored = simulation.saveState().actors.find(candidate => candidate.uid === actor.uid)!;
          expect([restored.x, restored.y, restored.z]).toEqual([actor.x, actor.y, actor.z]);
          resumed = true;
        }
      }
    }
    expect(resumed).toBe(true);
    expect(phases.has("foundingLandingDeck")).toBe(true);
    expect(phases.has("foundingLandingGround")).toBe(true);
    expect(maximumStep).toBeLessThan(.2);
    expect(operation().stage).toBe("foundation");
  }, 30000);

  it("blocks a landing with no safe pier and preserves the ship receipt and crew custody", () => {
    const created = fixture();
    const { simulation, source, world } = created;
    const point = simulation.seaExpeditionDestinations(source.uid)[0]!;
    expect(simulation.queueSeaExpedition(source.uid, point)).not.toBeNull();
    let operation: SettlementSaveV1["naval"]["founding"]["operations"][number] | undefined;
    for (let tick = 0; tick < 12000 && !operation; tick++) {
      simulation.update(.05);
      operation = simulation.saveState().naval.founding.operations[0];
    }
    expect(operation).toBeDefined();
    const copy = structuredClone(simulation.saveState());
    const savedOperation = copy.naval.founding.operations[0]!;
    savedOperation.landing = undefined;
    savedOperation.blocked = undefined;
    for (const uid of [savedOperation.builder, savedOperation.leveler, savedOperation.carrier]) {
      const actor = copy.actors.find(candidate => candidate.uid === uid)!;
      Object.assign(actor, { phase: "foundingWait", visible: false, path: [], pathIndex: 0,
        action: "idle", navalOrder: undefined });
    }
    const site = copy.buildings.find(building => building.uid === savedOperation.siteUid)!;
    const shipBefore = copy.naval.fleet.ships.find(ship => ship.id === savedOperation.shipId)!;
    const cargoBefore = structuredClone(shipBefore.cargo);
    // Make every cell around the shore claim impassable: no pier route can reach the site.
    const access = { x: Math.floor(site.access.x), z: Math.floor(site.access.z) };
    for (let z = access.z - 7; z <= access.z + 7; z++)
      for (let x = access.x - 7; x <= access.x + 7; x++) {
        if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) continue;
        world.walkCost[z * world.cellsX + x] = 0;
        world.blocking[z * world.cellsX + x] = 2;
      }
    expect(simulation.loadState(copy)).toEqual({ ok: true });
    for (let tick = 0; tick < 200; tick++) simulation.update(.05);
    const after = simulation.saveState();
    expect(after.naval.founding.operations[0]!.blocked).toBe("no safe physical landing pier");
    expect(after.buildings.find(building => building.uid === savedOperation.siteUid)!.construction).toBe(0);
    expect(after.naval.fleet.ships.find(candidate => candidate.id === savedOperation.shipId)!.cargo).toEqual(cargoBefore);
    for (const uid of [savedOperation.builder, savedOperation.leveler, savedOperation.carrier]) {
      const actor = after.actors.find(candidate => candidate.uid === uid)!;
      expect(actor.building).toBe(savedOperation.siteUid);
      expect(actor.phase).not.toMatch(/^foundingLanding/);
    }
  }, 30000);

  it("rejects saved roles, receipts, site references and stages that cannot be owned physically", () => {
    const { outpost, simulation } = startLanding();
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    const saved = simulation.saveState();
    const operation = () => saved.naval.founding.operations[0]!;
    const cases: [string, SettlementSaveV1][] = [
      ["crew", mutate(saved, copy => {
        const actor = copy.actors.find(candidate => candidate.uid === copy.naval.founding.operations[0]!.builder)!;
        actor.tool = undefined;
      })],
      ["receipt", mutate(saved, copy => {
        copy.buildings.find(building => building.uid === copy.naval.founding.operations[0]!.siteUid)!.input.planks = 99;
      })],
      ["ship or site", mutate(saved, copy => {
        copy.naval.fleet.ships.find(ship => ship.phase === "founding")!.sourceUid = 999;
      })],
      ["ship or site", mutate(saved, copy => {
        copy.buildings.find(building => building.uid === copy.naval.founding.operations[0]!.siteUid)!.foundingAnchor = true;
      })],
      ["stage", mutate(saved, copy => {
        copy.naval.founding.operations[0]!.stage = "entering";
      })],
      ["cargo", mutate(saved, copy => {
        copy.naval.fleet.ships.find(ship => ship.phase === "founding")!.cargo.fish = 1;
      })],
      ["crew", mutate(saved, copy => {
        copy.naval.founding.operations[0]!.carrier = copy.naval.founding.operations[0]!.builder;
      })]
    ];
    for (const [reason, value] of cases)
      expect(simulation.loadState(value), reason).toMatchObject({ ok: false,
        reason: expect.stringContaining("Invalid founding") });
    expect(operation().stage).toBe("foundation");
    expect(outpost.construction).toBe(0);
  }, 30000);
  it("keeps charted knowledge and recovers workers, tools and cargo before removing the site", () => {
    const created = startLanding();
    const { simulation, source, world } = created;
    // A remembered site is a saved fact, not a renderer/fog cache: a failed founding must not erase it.
    const savedKnowledge = simulation.saveState();
    savedKnowledge.naval.charting = { mode: "fog", sites: [{
      x: Math.floor(simulation.buildings().find(building => building.foundedByExpedition)!.x),
      z: Math.floor(simulation.buildings().find(building => building.foundedByExpedition)!.z),
      map: { seed: world.seed, cellsX: world.cellsX, cellsZ: world.cellsZ },
      rotation: 0, rotations: [0], water: { x: 1, z: 1 },
      geometryRevision: world.terrainRevision ?? 0
    }] };
    expect(simulation.loadState(savedKnowledge)).toEqual({ ok: true });
    const knowledge = simulation.seaChartedSites().map(site => `${site.x}:${site.z}:${site.rotation}`).sort();
    expect(knowledge.length).toBeGreaterThan(0);
    const ship = simulation.ships().find(candidate => candidate.foundingSiteUid !== undefined)!;
    const orderId = simulation.saveState().naval.fleet.ships.find(candidate =>
      candidate.id === ship.id)!.orderId!;
    expect(simulation.cancelSeaTransport(orderId)).toBe(true);
    expect(simulation.cancelSeaTransport(orderId)).toBe(false);
    for (let tick = 0; tick < 12000 && (simulation.saveState().naval.founding.operations.length ||
      simulation.ships().find(candidate => candidate.id === ship.id)?.phase !== "idle"); tick++)
      simulation.update(.05);
    expect(simulation.buildings().some(building => building.foundedByExpedition)).toBe(false);
    expect(simulation.saveState().naval.founding.operations).toEqual([]);
    expect(simulation.ships().find(candidate => candidate.id === ship.id)?.phase).toBe("idle");
    expect(simulation.seaChartedSites().map(site => `${site.x}:${site.z}:${site.rotation}`).sort())
      .toEqual(knowledge);
    expect(simulation.buildings().find(building => building.uid === source.uid)!.inventory).toMatchObject(created.initialStock);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30000);
  it("refuses a cancel issued after construction completed and finishes the anchor exactly once", () => {
    const { outpost, simulation } = startLanding();
    const operation = simulation.saveState().naval.founding.operations[0]!;
    const crew = [operation.builder, operation.leveler, operation.carrier];
    let orderId = 0;
    for (let tick = 0; tick < 12000 && outpost.construction < 1; tick++) {
      simulation.update(.05);
      orderId = simulation.saveState().naval.fleet.ships.find(ship => ship.foundingSiteUid !== undefined)
        ?.orderId ?? orderId;
    }
    expect(outpost.construction).toBe(1);
    expect(orderId).toBeGreaterThan(0);
    let enteringVisible = 0;
    for (let tick = 0; tick < 40; tick++) {
      simulation.update(.05);
      if (simulation.frames().some(actor => crew.includes(actor.uid) && actor.visible &&
        actor.phase === "foundingEnter")) enteringVisible++;
    }
    expect(enteringVisible).toBeGreaterThan(0);
    expect(simulation.cancelSeaTransport(orderId)).toBe(false);
    for (let tick = 0; tick < 12000 && simulation.saveState().naval.founding.operations.length; tick++)
      simulation.update(.05);
    expect(simulation.saveState().naval.founding.operations).toEqual([]);
    expect(outpost.construction).toBe(1);
    expect(outpost.foundingAnchor).toBe(true);
    expect(simulation.demolishBuilding(outpost.uid).ok).toBe(false);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30000);
  it("recovers a landed founding to another harbour when its source record is already lost", () => {
    const { initialStock, simulation } = startLanding();
    const landing = simulation.saveState();
    const operation = landing.naval.founding.operations[0]!;
    const sourceUid = operation.sourceUid;
    const removed = landing.buildings.find(building => building.uid === sourceUid)!;
    landing.buildings = landing.buildings.filter(building => building.uid !== sourceUid);
    landing.settlers -= removed.idleSettlers ?? 0;
    expect(simulation.loadState(landing)).toEqual({ ok: true });
    const orderId = simulation.saveState().naval.fleet.ships.find(ship => ship.phase === "founding")!.orderId!;
    expect(simulation.cancelSeaTransport(orderId)).toBe(true);
    for (let tick = 0; tick < 12000 && (simulation.saveState().naval.founding.operations.length ||
      simulation.ships().some(ship => ship.phase !== "idle")); tick++) simulation.update(.05);
    expect(simulation.saveState().naval.founding.operations).toEqual([]);
    expect(simulation.buildings().some(building => building.foundedByExpedition)).toBe(false);
    const recovered = simulation.buildings().find(building => building.typeId === 39 &&
      building.uid !== sourceUid)!;
    expect(recovered.inventory).toMatchObject(initialStock);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30000);
});
