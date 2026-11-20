import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setNavigationInvalidation } from "../src/shared/settlement/navigation-change-journal";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { findHarbourDock } from "../src/shared/settlement/settlement-harbour-docks";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { createShipSea } from "./helpers/ship-motion-scenarios";

/**
 * JETTY-FRAMES: an edit beyond every jetty's (and dock's) copied inputs keeps them all; an edit inside
 * renews the jetties it reached (both when it also moved a harbour's sea-ship channels, which every
 * jetty keeps clear of). Strict mode recomputes every reused value and throws on a difference; at the
 * end of a test a fresh fleet's search equals the kept list.
 */
type Decoration = { position: [number, number, number]; supports: never[]; uid: number;
  volumes: { max: number[]; min: number[] }[] };
const FAR = { x: 10, z: 180 };

const fixture = () => {
  const sea = createShipSea(220), near = sea.harbour(20, 15), other = sea.harbour(60, 15);
  // Real porter routes: a stub `findWorkerPath` would hide what each search read.
  delete sea.context.options.findWorkerPath;
  const roads: RoadSegment[] = [], decorations: Decoration[] = [];
  const network = sea.context.options.roads as unknown as { revision: number; segments: () => RoadSegment[] };
  network.revision = 0;
  network.segments = () => roads;
  (sea.context as { roadDecorations?: unknown }).roadDecorations = {
    frames: () => decorations, isSupportClear: () => true, revision: () => decorations.length
  };
  const fleet = createNavalFleet(sea.context, sea.sea);
  const before = fleet.shuttleJetties();
  expect(before).toHaveLength(2);
  const foot = before[0]!.workPier!.shore;
  /** Applies `edit` with its navigation step and returns the frames a render frame reads next. */
  const after = (edit: () => void) => {
    edit();
    sea.context.navigationRevision = (sea.context.navigationRevision ?? 0) + 1;
    sea.world.buildRevision = (sea.world.buildRevision ?? 0) + 1;
    return fleet.shuttleJetties();
  };
  /**
   * A fresh fleet on the same context searches every jetty again (its planner starts a new jetty
   * cache, so call it last).
   */
  const fresh = () => JSON.stringify(createNavalFleet(sea.context, sea.sea).shuttleJetties());
  return { after, before, decorations, foot, fresh, near, network, other, roads, sea };
};

/** Whether the edit renewed any jetty, and whether the far harbour's jetty was kept. */
const renewal = (before: readonly object[], after: readonly object[]) => {
  if (after === before) return "none";
  return after[1] === before[1] ? "near" : "both";
};
const renewed = (before: readonly object[], after: readonly object[]) => renewal(before, after) !== "none";

const occupy = (context: SettlementContext, point: SettlementPoint, value: number) => {
  context.occupied[Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x)] = value;
};

describe("boat jetty and dock reuse per edit kind (JETTY-FRAMES)", () => {
  let previous: ReturnType<typeof setNavigationInvalidation>;
  beforeEach(() => { previous = setNavigationInvalidation({ strict: true }); });
  afterEach(() => { setNavigationInvalidation(previous); });

  it("keeps every jetty when nothing changed, also across an unknown terrain revision", () => {
    const { after, before, sea } = fixture();
    expect(after(() => undefined)).toBe(before);
    expect(after(() => { sea.world.terrainRevision = (sea.world.terrainRevision ?? 0) + 1; })).toBe(before);
  });

  it("placement and demolition renew only the jetty they reach", () => {
    const { after, before, foot, fresh, sea } = fixture();
    const far = makeBuilding(sea.context, 1, FAR.x, FAR.z, 0);
    expect(after(() => { sea.context.buildings.push(far); occupy(sea.context, far, 1); })).toBe(before);
    const placed = makeBuilding(sea.context, 1, Math.floor(foot.x) + .5, Math.floor(foot.z) + .5, 0);
    const placedFrames = after(() => { sea.context.buildings.push(placed); occupy(sea.context, foot, 1); });
    expect(renewed(before, placedFrames)).toBe(true);
    const demolished = after(() => {
      sea.context.buildings.splice(sea.context.buildings.indexOf(placed), 1);
      occupy(sea.context, foot, 0);
    });
    expect(renewed(placedFrames, demolished)).toBe(true);
    expect(JSON.stringify(demolished)).toBe(JSON.stringify(before));
    expect(JSON.stringify(demolished)).toBe(fresh());
  });

  it("plain roads are never read; road decorations renew only the jetty they reach", () => {
    const { after, before, decorations, foot, fresh, network, roads } = fixture();
    expect(after(() => {
      roads.push({ end: { x: FAR.x + 4, z: FAR.z }, start: FAR, tier: "dirt" }); network.revision++;
    })).toBe(before);
    // Ground searches read the road graph only for bridges: a plain road beside the foot keeps every jetty.
    expect(after(() => {
      roads.push({ end: { x: foot.x - 3, z: foot.z }, start: { x: foot.x - 6, z: foot.z }, tier: "dirt" });
      network.revision++;
    })).toBe(before);
    const box = (x: number, z: number) => ({ max: [x + .3, 1, z + .3], min: [x - .3, 0, z - .3] });
    expect(after(() => decorations.push({ position: [FAR.x, 0, FAR.z], supports: [], uid: 1,
      volumes: [box(FAR.x, FAR.z)] }))).toBe(before);
    const decorated = after(() => decorations.push({ position: [foot.x - 4, 0, foot.z], supports: [], uid: 2,
      volumes: [box(foot.x - 4, foot.z)] }));
    expect(renewed(before, decorated)).toBe(true);
    expect(JSON.stringify(decorated)).toBe(fresh());
  });

  it("dry levelling renews only the jetty it reaches; the sea masks are kept", () => {
    const { after, before, foot, fresh, sea } = fixture();
    const stride = sea.world.cellsX + 1;
    expect(after(() => {
      sea.world.heights[FAR.z * stride + FAR.x] = .3;
      sea.world.terrainRevision = (sea.world.terrainRevision ?? 0) + 1;
    })).toBe(before);
    const levelled = after(() => {
      sea.world.heights[Math.floor(foot.z) * stride + Math.floor(foot.x) - 2] = .2;
      sea.world.terrainRevision = (sea.world.terrainRevision ?? 0) + 1;
    });
    expect(renewed(before, levelled)).toBe(true);
    expect(JSON.stringify(levelled)).toBe(fresh());
  });

  it("whole-map inputs and harbour channels renew every jetty", () => {
    const { after, before, fresh, sea } = fixture();
    const renamed = after(() => { sea.context.playerNation = "viking"; });
    expect(renewal(before, renamed)).toBe("both");
    // A third harbour adds sea-ship channels both existing jetties keep clear of.
    const added = after(() => { sea.harbour(100, 15); });
    expect(added).toHaveLength(3);
    expect(added[0]).not.toBe(renamed[0]);
    expect(JSON.stringify(added)).toBe(fresh());
  });

  it("a ship dock is reused until one of its inputs changes", () => {
    const { after, near, sea } = fixture();
    const pose = { x: near.access.x + 12, yaw: Math.PI, z: near.access.z };
    const dock = findHarbourDock(sea.context, near.uid, pose);
    after(() => undefined);
    expect(findHarbourDock(sea.context, near.uid, pose)).toBe(dock);
    if (!dock) return;
    after(() => occupy(sea.context, dock.workPier.shore, 1));
    expect(findHarbourDock(sea.context, near.uid, pose)).not.toBe(dock);
  });
});
