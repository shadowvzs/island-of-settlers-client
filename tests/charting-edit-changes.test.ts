import { describe, expect, it } from "vitest";

import { registerBoatJettyReservations } from "../src/shared/settlement/harbour-boat-reservations";
import {
  resetNavigationJournalWork, setNavigationInvalidation
} from "../src/shared/settlement/navigation-change-journal";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { createChartingCandidates } from "../src/shared/settlement/settlement-charting-candidates";
import { ruinCells } from "../src/shared/settlement/settlement-ruins";
import { resetTransientState } from "../src/shared/settlement/settlement-transient-state";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";

/**
 * HARBOUR-RECHECK: every edit kind renews only the harbour site proofs near it, and the renewed list
 * equals a complete rebuild. Two proven sites: x 15 (near the edits at x ~18, z ~42) and x 132.
 */
const SIZE = 160;
const EDIT = { x: 18, z: 42 };
interface Fixture {
  buildings: SettlementBuilding[];
  decorations: Array<{ position: [number, number, number]; supports: never[]; uid: number; volumes: unknown[] }>;
  fields: SettlementPoint[];
  jetties: Array<{ foot: SettlementPoint; point: SettlementPoint; shoreRoute: SettlementPoint[] }>;
  roads: RoadSegment[];
}

const building = (uid: number, x: number, z: number, extra: Partial<SettlementBuilding> = {}) => ({
  access: { x, z: z + 2 }, construction: 0, depth: 2, rotation: 0, typeId: 1, uid, width: 2, x, z, ...extra
}) as SettlementBuilding;
const box = (x: number, z: number) => ({ max: [x + .5, 1, z + .5], min: [x - .5, 0, z - .5] });

const fixture = () => {
  const world = { cellsX: SIZE, cellsZ: SIZE, seaLevel: 0, seed: 3,
    heights: new Float32Array((SIZE + 1) ** 2).fill(1), blocking: new Uint8Array(SIZE ** 2),
    props: { count: 0 }, terrainRevision: 0, buildRevision: 0 } as unknown as WorldData;
  const sea = new Uint8Array(SIZE ** 2);
  for (let z = 70; z <= 75; z++) for (let x = 0; x < SIZE; x++) {
    sea[z * SIZE + x] = 1;
    world.blocking[z * SIZE + x] = BLOCKING.water;
  }
  // A home building far from both sites: later placements keep the landmass ownership as it is.
  const state: Fixture = { buildings: [building(1, 150, 150)], decorations: [], fields: [], jetties: [], roads: [] };
  const roads = { revision: 0, segments: () => state.roads };
  const context = { buildings: state.buildings, navigationRevision: 0, occupied: new Uint8Array(SIZE ** 2),
    fieldCycles: { snapshot: () => state.fields },
    options: { roads, world },
    roadDecorations: { frames: () => state.decorations } } as unknown as SettlementContext;
  registerBoatJettyReservations(context, () => state.jetties as never);
  const near = (point: SettlementPoint, x: number) => Math.hypot(point.x - x, point.z - 40) <= 6;
  /** The synthetic proof reads every input kind within 6 tiles of (x, 40). */
  const blocked = (x: number) => state.buildings.some(entry => near(entry, x)) ||
    state.roads.some(segment => near(segment.start, x)) || state.fields.some(site => near(site, x)) ||
    state.decorations.some(frame => near({ x: frame.position[0], z: frame.position[2] }, x)) ||
    state.jetties.some(jetty => near(jetty.foot, x)) || world.heights[40 * (SIZE + 1) + x]! > 1.5 ||
    context.occupied[40 * SIZE + x] === 1;
  const calls: number[] = [];
  const site = (point: { x: number; z: number; rotation: number }) => {
    calls.push(point.x);
    if (![15, 132].includes(point.x) || point.z !== 63 || point.rotation !== 0 || blocked(point.x)) return null;
    return { ...point, water: { x: point.x, z: 72 } };
  };
  const cache = createChartingCandidates(context, sea, site);
  const full = () => createChartingCandidates(context, sea, site).list();
  /** The proofs a query re-checks after `edit` (with its navigation step), compared with a full rebuild. */
  const recheck = (edit: () => void) => {
    edit();
    context.navigationRevision = (context.navigationRevision ?? 0) + 1;
    calls.length = 0;
    // Development builds re-prove every 32nd reuse; earlier test files (shared modules) must not decide when.
    resetNavigationJournalWork();
    const sites = cache.list(), renewed = calls.slice();
    expect(sites).toEqual(full());
    return { renewed, sites: sites.map(entry => entry.x) };
  };
  cache.list();
  return { cache, context, recheck, roads, state, world };
};

/** Which proofs a re-check renewed: none, the near site only (local), both sites (full) or other. */
const scope = ({ renewed }: { renewed: number[] }) => {
  if (!renewed.length) return "none";
  if (!renewed.includes(15)) return "other";
  return renewed.includes(132) ? "full" : "local";
};

describe("edit-local harbour site re-check (HARBOUR-RECHECK)", () => {
  it("renews only near a placed building and again near its demolition", () => {
    const { context, recheck, state } = fixture();
    const placed = building(2, EDIT.x, EDIT.z);
    const afterPlacement = recheck(() => {
      state.buildings.push(placed);
      context.occupied[EDIT.z * SIZE + EDIT.x] = 1;
    });
    expect(scope(afterPlacement)).toBe("local");
    expect(afterPlacement.sites).toEqual([132]);
    const afterDemolition = recheck(() => {
      state.buildings.splice(state.buildings.indexOf(placed), 1);
      context.occupied[EDIT.z * SIZE + EDIT.x] = 0;
    });
    expect(scope(afterDemolition)).toBe("local");
    expect(afterDemolition.sites).toEqual([15, 132]);
  });

  it("renews only near a building whose stage or level changed (construction, upgrade, destruction)", () => {
    const { recheck, state } = fixture();
    recheck(() => state.buildings.push(building(2, 15, 20)));
    const site = state.buildings[1]!;
    expect(scope(recheck(() => { site.construction = .5; }))).toBe("local");
    const upgrade = { level: 2 } as SettlementBuilding["workshopUpgrade"];
    expect(scope(recheck(() => { site.workshopUpgrade = upgrade; }))).toBe("local");
    expect(scope(recheck(() => state.buildings.splice(1, 1)))).toBe("local");
  });

  it("renews only near a fall that leaves a ruin and near the ruin's clearing (BD2, plan review B8i)", () => {
    const { context, recheck, state } = fixture();
    const site = building(2, EDIT.x, EDIT.z), cells = ruinCells(site, SIZE);
    recheck(() => {
      state.buildings.push(site);
      for (const cell of cells) context.occupied[cell] = 1;
    });
    // The fall: the building leaves and its ruin keeps the plot occupied.
    expect(scope(recheck(() => state.buildings.splice(1, 1)))).toBe("local");
    // The clearing frees the plot.
    expect(scope(recheck(() => { for (const cell of cells) context.occupied[cell] = 0; }))).toBe("local");
  });

  it("renews only near a built or removed road", () => {
    const { recheck, roads, state } = fixture();
    const road = { end: { x: EDIT.x + 4, z: EDIT.z }, start: { ...EDIT }, tier: "dirt" } as RoadSegment;
    const built = recheck(() => { state.roads.push(road); roads.revision++; });
    expect(scope(built)).toBe("local");
    expect(built.sites).toEqual([132]);
    expect(scope(recheck(() => { state.roads.length = 0; roads.revision++; }))).toBe("local");
  });

  it("renews only near a bridge site and its finished span", () => {
    const { recheck, roads, state } = fixture();
    const span = { end: { x: EDIT.x, z: EDIT.z + 6 }, start: { ...EDIT }, tier: "stone", bridge: { id: 1 } };
    const bridgeSite = { end: span.end, segments: [span], start: span.start, stockPoint: span.start };
    const site = building(2, EDIT.x, EDIT.z, { bridgeSite } as unknown as Partial<SettlementBuilding>);
    expect(scope(recheck(() => state.buildings.push(site)))).toBe("local");
    expect(scope(recheck(() => {
      state.buildings.pop();
      state.roads.push(span as unknown as RoadSegment);
      roads.revision++;
    }))).toBe("local");
  });

  it("renews only near a placed, moved or picked up road decoration", () => {
    const { recheck, state } = fixture();
    const frame = { position: [EDIT.x, 0, EDIT.z] as [number, number, number], supports: [] as never[], uid: 1,
      volumes: [box(EDIT.x, EDIT.z)] };
    expect(scope(recheck(() => state.decorations.push(frame)))).toBe("local");
    expect(scope(recheck(() => {
      frame.position = [EDIT.x + 1, 0, EDIT.z];
      frame.volumes = [box(EDIT.x + 1, EDIT.z)];
    }))).toBe("local");
    expect(scope(recheck(() => state.decorations.pop()))).toBe("local");
  });

  it("renews only near field sites and boat jetties", () => {
    const { recheck, state } = fixture();
    expect(scope(recheck(() => state.fields.push({ ...EDIT })))).toBe("local");
    expect(scope(recheck(() => state.jetties.push({ foot: { ...EDIT }, point: { x: EDIT.x, z: 70 },
      shoreRoute: [{ ...EDIT }] })))).toBe("local");
  });

  it("renews only near dry levelling; terrain that can change the coast renews everything", () => {
    const { recheck, world } = fixture();
    const vertex = 40 * (SIZE + 1) + 15;
    const levelled = recheck(() => { world.heights[vertex] = 2; world.terrainRevision!++; world.buildRevision!++; });
    expect(scope(levelled)).toBe("local");
    expect(levelled.sites).toEqual([132]);
    expect(scope(recheck(() => { world.heights[vertex] = -1; world.terrainRevision!++; }))).toBe("full");
    expect(scope(recheck(() => { world.blocking[EDIT.z * SIZE + EDIT.x] = BLOCKING.water; }))).toBe("full");
  });

  it("renews everything when a landmass gains or loses the player's ownership", () => {
    const { recheck, state } = fixture();
    expect(scope(recheck(() => state.buildings.splice(0, 1)))).toBe("full");
    expect(scope(recheck(() => state.buildings.push(building(3, 150, 150))))).toBe("full");
  });

  it("re-checks nothing while nothing changed, also across an in-place snapshot reload", () => {
    const { cache, context, recheck } = fixture();
    expect(scope(recheck(() => undefined))).toBe("none");
    expect(scope(recheck(() => {
      resetTransientState(context);
      cache.afterInPlaceReload(true);
    }))).toBe("none");
    expect(scope(recheck(() => cache.afterInPlaceReload(false)))).toBe("full");
  });

  it("ignores an adventure camp revision without camps and renews everything when camps change", () => {
    const { context, recheck } = fixture();
    let camps = 0, revision = 0;
    context.adventure = { campCount: () => camps, campRevision: () => revision } as SettlementContext["adventure"];
    recheck(() => undefined);
    expect(scope(recheck(() => { revision++; }))).toBe("none");
    expect(scope(recheck(() => { camps = 1; revision++; }))).toBe("full");
    expect(scope(recheck(() => { revision++; }))).toBe("full");
  });

  it("renews everything in the A03 rollback mode and for findWorkerPath contexts", () => {
    const { context, recheck, state } = fixture();
    const previous = setNavigationInvalidation({ mode: "global" });
    try {
      expect(scope(recheck(() => state.fields.push({ ...EDIT })))).toBe("full");
    } finally {
      setNavigationInvalidation(previous);
    }
    context.options.findWorkerPath = () => null;
    expect(scope(recheck(() => state.fields.pop()))).toBe("full");
  });
});
