import type { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { SHIP_DECK } from "../src/render-common/ships/ship-deck-layout";
import { SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SCALE, SAILING_SHIP_SPACING } from "../src/render-common/ships/ship-dimensions";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { createHarbourDocks, findHarbourDock, HARBOUR_PIER_MAX_LENGTH, HARBOUR_SHORE_ACCESS_MAX_DISTANCE } from "../src/shared/settlement/settlement-harbour-docks";
import { harbourPierClearGap } from "../src/shared/settlement/settlement-harbour-pier-geometry";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import type { ShipDestination } from "../src/shared/settlement/settlement-ship-routes";
import { findShipWorkpoint, SHIP_WORKPOINT_HULL_OFFSET } from "../src/shared/settlement/settlement-ship-workpoint";
import { createShipSea, createShipSeaWorld, SHIP_TICK } from "./helpers/ship-motion-scenarios";
import { visibleWorldPoints } from "./helpers/visible-mesh-bounds";

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "japanese", "nubian"];
const QUALITIES = ["high", "minimal"] as const;
/** Sail and swell animation moments the footprints are measured at (seconds). */
const MOMENTS = [0, 1.7, 3.1, 5.9];

interface Footprint { yaw: number; x: number; z: number; minAlong: number; maxAlong: number; minAcross: number;
  maxAcross: number }

/** The drawn footprint of `points` in a frame turned to `yaw` round (x, z): along and across the keel. */
const footprint = (points: readonly Vector3[], pose: { x: number; yaw: number; z: number }): Footprint => {
  const result = { ...pose, maxAcross: -Infinity, maxAlong: -Infinity, minAcross: Infinity, minAlong: Infinity };
  for (const point of points) {
    const dx = point.x - pose.x, dz = point.z - pose.z;
    const along = dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw);
    const across = dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw);
    result.minAlong = Math.min(result.minAlong, along); result.maxAlong = Math.max(result.maxAlong, along);
    result.minAcross = Math.min(result.minAcross, across); result.maxAcross = Math.max(result.maxAcross, across);
  }
  return result;
};
const corners = (print: Footprint) => [[print.minAlong, print.minAcross], [print.minAlong, print.maxAcross],
  [print.maxAlong, print.maxAcross], [print.maxAlong, print.minAcross]].map(([along, across]) => ({
  x: print.x + Math.sin(print.yaw) * along! + Math.cos(print.yaw) * across!,
  z: print.z + Math.cos(print.yaw) * along! - Math.sin(print.yaw) * across! }));
/** Two drawn footprints lie apart: a separating axis exists among their edges (2D, top-down). */
const apart = (a: Footprint, b: Footprint) => [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2].some(axis => {
  const project = (print: Footprint) =>
    corners(print).map(corner => corner.x * Math.sin(axis) + corner.z * Math.cos(axis));
  const first = project(a), second = project(b);
  return Math.max(...first) < Math.min(...second) || Math.max(...second) < Math.min(...first);
});
/** No drawn point of `points` lies inside the footprint. */
const outside = (points: readonly Vector3[], print: Footprint) => points.every(point => {
  const local = footprint([point], print);
  return local.minAlong < print.minAlong || local.minAlong > print.maxAlong ||
    local.minAcross < print.minAcross || local.minAcross > print.maxAcross;
});

const harbourWithBerths = (z = 60) => {
  const sea = createShipSea(), harbour = sea.harbour(z, 15, 0, 2);
  const fleet = createNavalFleet(sea.context, sea.sea);
  return { berths: fleet.harbourBerths(harbour.uid), fleet, harbour, sea };
};
const headings = (berth: ShipDestination) => berth.eitherWay ? [berth.yaw!, berth.yaw! + Math.PI] : [berth.yaw!];

describe("a harbour's second berth (owner 2026-10-14)", () => {
  it.each([0, .25])("keeps the first berth's original local shore search on coast slope %s", slope => {
    const sea = createShipSeaWorld(90, 120, (x, z) => x < 20 + slope * (z - 60));
    const harbour = sea.harbour(60), fleet = createNavalFleet(sea.context, sea.sea);
    const first = fleet.harbourBerths(harbour.uid)[0]!;
    const site = { land: harbour.access, path: [], water: first, yaw: first.yaw ?? 0 };
    const local = findShipWorkpoint(sea.context, harbour, site, HARBOUR_PIER_MAX_LENGTH + SHIP_WORKPOINT_HULL_OFFSET,
      HARBOUR_SHORE_ACCESS_MAX_DISTANCE, HARBOUR_PIER_MAX_LENGTH, sea.world.seaLevel + SHIP_DECK.floorY * SAILING_SHIP_SCALE);
    const actual = findHarbourDock(sea.context, harbour.uid, { ...first, yaw: first.yaw ?? 0 })!.workPier!;
    expect(local).not.toBeNull();
    expect(actual.shore).toEqual(local!.shore);
    expect(actual.point).toEqual(local!.point);
  });

  it("prefers more than a whole ship of clear water between actual piers on an open coast", () => {
    const { berths, harbour, sea } = harbourWithBerths();
    expect(berths).toHaveLength(2);
    const [first, second] = berths;
    expect(Math.hypot(second!.x - first!.x, second!.z - first!.z)).toBeGreaterThanOrEqual(11);
    const piers = berths.map(berth => findHarbourDock(sea.context, harbour.uid,
      { ...berth, yaw: berth.yaw ?? 0 })!.workPier!);
    expect(harbourPierClearGap(piers[0]!, piers[1]!)).toBeGreaterThanOrEqual(
      SAILING_SHIP_OVERALL_LENGTH + SAILING_SHIP_SPACING);
  });

  it("keeps one berth in a cove where headlands leave no room for a second ship in line", () => {
    const sea = createShipSea(120, [{ tip: 40, z0: 44, z1: 50 }, { tip: 40, z0: 72, z1: 78 }]);
    const harbour = sea.harbour(60, 15, 0, 2), berths = createNavalFleet(sea.context, sea.sea).harbourBerths(harbour.uid);
    expect(berths).toHaveLength(1);
  });

  it("retains a usable compact pair when occupied shore prevents a whole-ship pier gap", () => {
    const sea = createShipSea();
    for (let z = 0; z < sea.world.cellsZ; z++) for (let x = 0; x < 20; x++)
      if (z < 53 || z > 74) sea.context.occupied[z * sea.world.cellsX + x] = 1;
    // A level 3 harbour: the second berth comes with level 3 (owner, 2026-10-21).
    const harbour = sea.harbour(60, 15, 0, 2), fleet = createNavalFleet(sea.context, sea.sea);
    const berths = fleet.harbourBerths(harbour.uid);
    expect(berths).toHaveLength(2);
    const piers = berths.map(berth => findHarbourDock(sea.context, harbour.uid,
      { ...berth, yaw: berth.yaw ?? 0 })!.workPier!);
    expect(harbourPierClearGap(piers[0]!, piers[1]!)).toBeLessThan(SAILING_SHIP_OVERALL_LENGTH);
    expect(piers.every(pier => pier.shore.z >= 53 && pier.shore.z < 75)).toBe(true);
  });

  it.each(NATIONS.flatMap(nation => QUALITIES.map(quality => ({ nation, quality }))))(
    "keeps the $nation ships ($quality) at both berths and their piers apart: hull, rigging and sails",
    ({ nation, quality }) => {
      const { berths, harbour, sea } = harbourWithBerths(), docks = createHarbourDocks(sea.context);
      const [first, second] = berths as [ShipDestination, ShipDestination];
      for (const yawA of headings(first)) for (const yawB of headings(second)) {
        const frames: ShipFrame[] = [
          { cargoCount: 40, id: 1, phase: "loading", x: first.x, y: sea.world.seaLevel, yaw: yawA, z: first.z },
          { cargoCount: 40, id: 2, phase: "loading", x: second.x, y: sea.world.seaLevel, yaw: yawB, z: second.z }];
        const piers = frames.map(frame => docks.forShip({ ...frame, cargo: { planks: 10 }, sourceUid: harbour.uid })!);
        expect(piers.every(Boolean)).toBe(true);
        for (const time of MOMENTS) {
          const layer = createThreeSettlementShips(quality);
          layer.update(frames, [], time, { playerNation: nation, windDirection: 1, windStrength: 1 });
          const prints = frames.map(frame =>
            footprint(visibleWorldPoints(layer.group.getObjectByName(`ship-${frame.id}`)!), frame));
          expect(apart(prints[0]!, prints[1]!)).toBe(true);
          layer.dispose();
          piers.forEach((pier, index) => {
            const pierLayer = createThreeSettlementShips(quality);
            pierLayer.update([], [pier], time, { playerNation: nation });
            expect(outside(visibleWorldPoints(pierLayer.group), prints[1 - index]!)).toBe(true);
            pierLayer.dispose();
          });
        }
      }
    });

  it("brings a second ship in to the other berth while the first one still loads at its pier", () => {
    const { berths, fleet, harbour, sea } = harbourWithBerths(30), destination = sea.harbour(95);
    harbour.inventory = { planks: 20 };
    fleet.addShip({ x: 40.5, z: 12.5 }, 0); fleet.addShip({ x: 44.5, z: 48.5 }, Math.PI);
    fleet.queueTransport(harbour.uid, destination.uid, { planks: 10 });
    fleet.queueTransport(harbour.uid, destination.uid, { planks: 10 });
    const berthOf = (point: { x: number; z: number }) =>
      berths.findIndex(berth => Math.hypot(berth.x - point.x, berth.z - point.z) < 1);
    let alongside = false;
    for (let tick = 0; tick < 300 / SHIP_TICK && !alongside; tick++) {
      fleet.update(SHIP_TICK);
      const ships = fleet.saveState().ships, loading = ships.find(ship => ship.phase === "loading");
      const coming = ships.find(ship => ship.phase === "positioning" && ship.route.length);
      alongside = Boolean(loading && coming && berthOf(coming.route.at(-1)!) >= 0 &&
        berthOf(coming.route.at(-1)!) !== berthOf(loading));
    }
    expect(alongside).toBe(true);
  });
});
