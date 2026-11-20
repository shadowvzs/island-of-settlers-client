import { describe, expect, it, vi } from "vitest";

import { cancelScoutlessExplorations, type ScoutlessFleet } from "../src/shared/settlement/naval-person-release";
import { applyOfflineCivilianRaid } from "../src/shared/settlement/offline-civilian-raid";
import { navalPassengerFixture } from "./helpers/naval-passenger-fixture";

/**
 * MIL-TWEAKS (owner 2026-11-09): an exploration scout lost on its walk to the harbour (killed by raiders,
 * or running from them) cancels the voyage instead of letting the ship sail blind, and the one spyglass
 * the voyage cost goes back to the harbour that paid it. Deterministic; exact ticks and the fast offline
 * estimate end the same way.
 */
const ENEMY = 1;

/** A queued exploration whose scout walks from the headquarters to the harbour. */
const walkingScout = () => {
  const fixture = navalPassengerFixture();
  const { simulation, source, world } = fixture;
  world.fog = new Uint8Array(world.cellsX * world.cellsZ);
  source.inventory.spyglass = 1;
  // The harbour's own idle settlers move to the headquarters, so the scout walks the road to the harbour.
  const headquarters = simulation.buildings().find(building => building.uid === simulation.headquarters.uid)!;
  headquarters.idleSettlers = (headquarters.idleSettlers ?? 0) + (source.idleSettlers ?? 0);
  source.idleSettlers = 0;
  const order = simulation.queueSeaExploration(source.uid)!;
  expect(order).not.toBeNull();
  expect(source.inventory.spyglass).toBe(0);
  for (let tick = 0; tick < 20; tick++) simulation.update(.05);
  const scout = simulation.frames().find(actor => actor.navalOrder === order)!;
  expect(scout).toMatchObject({ job: "Scout", phase: "navalToHarbour", tool: "spyglass", visible: true });
  return { ...fixture, order, scout };
};

type Walking = ReturnType<typeof walkingScout>;

/** Two raiders on clear ground right beside the scout (the first free spots around it). */
const SPOTS = [[.5, .4], [-.5, .4], [.5, -.4], [-.5, -.4], [0, .8], [0, -.8], [.9, 0], [-.9, 0]] as const;
const spawnBeside = ({ scout, simulation }: Walking) => {
  const ids: number[] = [];
  for (const [dx, dz] of SPOTS) {
    const id = ids.length < 2 &&
      simulation.spawnMilitaryOpponent({ x: scout.x + dx, z: scout.z + dz }, "heavy", 0, ENEMY);
    if (typeof id === "number") ids.push(id);
  }
  return ids;
};

/** No exploration is queued and the ship that was fetching the scout comes home and is free again. */
const voyageEnds = ({ simulation }: Walking) => {
  expect(simulation.seaOrders().some(order => order.exploration)).toBe(false);
  for (let tick = 0; tick < 4000 && simulation.ships().some(ship => ship.exploration); tick++) simulation.update(.05);
  return !simulation.ships().some(ship => ship.exploration);
};

const expectRefunded = (walking: Walking) => {
  const { simulation, source } = walking;
  expect(voyageEnds(walking)).toBe(true);
  expect(simulation.buildings().find(building => building.uid === source.uid)!.inventory.spyglass).toBe(1);
  expect(simulation.frames().some(actor => actor.tool === "spyglass")).toBe(false);
  expect(simulation.seaChartedSites()).toEqual([]);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
};

describe("MIL-TWEAKS: a lost exploration scout cancels the voyage and refunds its spyglass", () => {
  it("cancels a scoutless queued order or recalls the ship fetching it, once", () => {
    const outbound = { exploration: { returning: false }, passengers: [] as number[] };
    const fleet: ScoutlessFleet = {
      cancelTransport: vi.fn(() => true),
      saveState: () => ({
        orders: [{ ...outbound, id: 1 }, { ...outbound, id: 2, passengers: [7] }, { id: 3, passengers: [] }],
        ships: [{ ...outbound, orderId: 4 }, { ...outbound, cancelled: true, orderId: 5 },
          { exploration: { returning: true }, orderId: 6, passengers: [] }]
      })
    };
    cancelScoutlessExplorations(fleet);
    expect(vi.mocked(fleet.cancelTransport).mock.calls).toEqual([[1], [4]]);
  });

  it("a scout killed on its walk to the harbour ends the voyage; the harbour gets its spyglass back", () => {
    const walking = walkingScout();
    const { scout, simulation } = walking;
    expect(spawnBeside(walking)).toHaveLength(2);
    // The scout may first turn to run (dropping its voyage) and die on the next tick, so wait for its death.
    let lost = false;
    for (let tick = 0; tick < 200 && !lost; tick++) {
      simulation.update(.05);
      lost = !simulation.frames().some(actor => actor.uid === scout.uid);
    }
    expect(lost).toBe(true);
    expect(simulation.saveState().military?.combat?.civilianDeaths ?? 0).toBeGreaterThan(0);
    expect(simulation.frames().some(actor => actor.uid === scout.uid)).toBe(false);
    expectRefunded(walking);
  }, 120_000);

  it("the fast offline estimate applies the same: on load the voyage is cancelled, the spyglass is home", () => {
    const walking = walkingScout();
    const { scout, simulation, source } = walking;
    expect(spawnBeside(walking)).toHaveLength(2);
    const save = simulation.saveState();
    const raid = applyOfflineCivilianRaid(save, 3600);
    expect(raid.victims).toContain(scout.uid);
    const pool = save.storagePools.pools.find(entry => entry.id === source.storagePoolId);
    const harbour = save.buildings.find(building => building.uid === source.uid)!;
    expect((pool?.available.spyglass ?? 0) + (harbour.inventory.spyglass ?? 0)).toBe(1);
    expect(simulation.loadState(save)).toEqual({ ok: true });
    simulation.update(.05);
    expectRefunded(walking);
  }, 120_000);
});
