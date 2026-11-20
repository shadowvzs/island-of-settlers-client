import { expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { navigationPropRadius } from "../src/shared/settlement/settlement-navigation";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BLOCKING, BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

it.each([0, 1, 2, 3])(
  "drains three concurrent loaded stone deliveries at Farm construction beside a tree, rotation %i",
  (rotation) => {
    const size = 80;
    const world = {
      seed: 3,
      cellsX: size,
      cellsZ: size,
      seaLevel: -1,
      // Keep every rotated entrance inside the reduced 48-tile HQ territory.
      start: { x: 14, z: 14 },
      heights: new Float32Array((size + 1) ** 2),
      blocking: new Uint8Array(size ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10),
      buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      oreAmount: new Uint8Array(size ** 2),
      mineZone: new Uint16Array(size ** 2),
      mineZones: [],
      props: {
        count: 1,
        types: new Uint8Array([PROP.broadleafTree]),
        scale: new Float32Array([1]),
        x: new Float32Array([53.3]),
        z: new Float32Array([39.3])
      }
    } as unknown as WorldData;
    world.blocking[39 * size + 53] = BLOCKING.prop;
    const roads = createRoadNetwork(world);
    const contacts = createIslandStockContacts(world);
    const sim = createSettlementSimulation({
      world,
      roads,
      initialSettlers: 100,
      initialStock: { planks: 40, stone: 40, hammer: 2, scythe: 1 },
      stockContact: contacts,
      canWorkerEnterPlot: (b, p) =>
        b.construction < 1 ||
        isBuildingCourtyardPointWalkable(b.typeId, b.x, b.z, b.rotation, p, b.output, b.input)
    });
    const placed = sim.placeBuilding(37, 50, 35, rotation);
    expect(placed.ok, placed.reason).toBe(true);
    let site = placed.building!;

    // Match the user save: a Forester-grown trunk overlaps the nominal stone stance,
    // while the actual pile and building plot remain clear. Rotate the exact offset.
    world.blocking[39 * size + 53] = 0;
    const yaw = (rotation * Math.PI) / 2,
      cos = Math.round(Math.cos(yaw)),
      sin = Math.round(Math.sin(yaw));
    world.props.x[0] = site.x + 2.5 * cos + 3.5 * sin;
    world.props.z[0] = site.z - 2.5 * sin + 3.5 * cos;
    world.props.scale[0] = 1.28588;
    world.blocking[Math.floor(world.props.z[0]!) * size + Math.floor(world.props.x[0]!)] =
      BLOCKING.prop;
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    expect(sim.connectRoads(sim.headquarters.access, site.access)).toBe(true);
    for (let z = Math.floor(site.access.z - 2); z <= Math.ceil(site.access.z + 2); z++)
      for (let x = Math.floor(site.access.x - 2); x <= Math.ceil(site.access.x + 2); x++)
        if (!sim.isOccupied(x + 0.5, z + 0.5)) world.buildClass[z * size + x] = BUILD.flag;

    let loadedPeak = 0,
      maxStep = 0;
    const jobs = new Map<number, unknown>();
    const completed = new Set<number>();
    // Flexible final sowing batches can start first harvest near 450s; allow a bounded 600s window.
    for (let tick = 0; tick < 12000; tick++) {
      const before = new Map(
        sim
          .frames()
          .filter((a) => a.visible)
          .map((a) => [a.uid, { x: a.x, z: a.z, job: a.job }])
      );
      sim.update(0.05);
      const stoneCrews = sim
        .frames()
        .filter((a) => a.ware === "stone" && a.delivery?.destination === site.uid);
      loadedPeak = Math.max(loadedPeak, stoneCrews.length);
      for (const a of sim.frames()) {
        if (a.delivery?.destination === site.uid && !jobs.has(a.uid)) jobs.set(a.uid, a.delivery);
        if (jobs.has(a.uid) && jobs.get(a.uid) !== a.delivery) completed.add(a.uid);
        if (a.visible)
          expect(
            Math.hypot(a.x - world.props.x[0]!, a.z - world.props.z[0]!)
          ).toBeGreaterThanOrEqual(navigationPropRadius(world, 0) - 1e-8);
        const old = before.get(a.uid);
        if (old && a.visible && old.job === a.job)
          maxStep = Math.max(maxStep, Math.hypot(a.x - old.x, a.z - old.z));
      }
      if (tick === 2200) {
        expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
        site = sim.buildings().find((b) => b.uid === site.uid)!;
        for (const actor of sim.frames())
          if (actor.delivery && jobs.has(actor.uid)) jobs.set(actor.uid, actor.delivery);
      }
    }
    expect(loadedPeak).toBeGreaterThanOrEqual(3);
    expect(site.construction, site.status).toBe(1);
    expect(sim.frames().filter((a) => a.delivery?.destination === site.uid)).toEqual([]);
    expect(completed.size).toBe(jobs.size);
    // The Roman Farm receipt is 3 stone + 4 planks (nation construction costs restored by EAI1c c2).
    expect(sim.headquarters.inventory.stone).toBe(37);
    expect(sim.headquarters.inventory.planks).toBe(36);
    expect(sim.headquarters.inventory.hammer).toBe(2);
    expect(sim.availableSettlers() + sim.frames().filter((a) => a.phase !== "retired").length).toBe(
      100 + sim.settlerBirths()
    );
    expect(maxStep).toBeLessThanOrEqual(0.071);
    const wheat =
      (sim.headquarters.inventory.grain ?? 0) +
      (site.output.grain ?? 0) +
      sim.frames().filter((a) => a.ware === "grain").length;
    expect(wheat, "Completed Farm must sow, grow, harvest and store actual wheat").toBeGreaterThan(
      0
    );
  },
  30000
);
