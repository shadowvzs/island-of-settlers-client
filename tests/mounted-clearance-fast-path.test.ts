import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isMountedPointSurelyClear } from "../src/shared/settlement/mounted-clearance-fast-path";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { withBuildingNavigationSearch } from "../src/shared/settlement/settlement-building-navigation";
import {
  isGroundSegmentClear, isMountedGroundSegmentClear, isMountedNavigationClear
} from "../src/shared/settlement/settlement-navigation";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

/** Hero-mount-perf: the horse clearance fast path answers exactly like the full test. */
const SIZE = 48;
const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const treeProps = (random: () => number) => {
  const count = 60, types = new Uint8Array(count), x = new Float32Array(count), z = new Float32Array(count);
  const scale = new Float32Array(count), kinds = [PROP.palmTree, PROP.largeRock, PROP.broadleafTree, PROP.bush];
  for (let index = 0; index < count; index++) {
    types[index] = kinds[index % kinds.length]!;
    x[index] = 2 + random() * 44; z[index] = 30 + random() * 16; scale[index] = .5 + random() * 4;
  }
  return { count, scale, types, x, z };
};

const occupy = (context: SettlementContext, building: SettlementBuilding) => {
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      context.occupied[z * SIZE + x] = 1;
};
const place = (context: SettlementContext, typeId: number, x: number, z: number, rotation: number,
  extra: Partial<SettlementBuilding> = {}) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const building = makeBuilding(context, typeId, x + ((rotation % 2 ? depth : width) % 2) / 2,
    z + ((rotation % 2 ? width : depth) % 2) / 2, rotation);
  Object.assign(building, { construction: 1, ...extra });
  context.buildings.push(building);
  occupy(context, building);
};

/** Finished, rotated, stocked, unfinished and legacy buildings, trees and rocks, and a pond. */
/** Lavender beds and arches scattered over the map (supports a horse must keep clear of). */
const decorate = (context: SettlementContext, random: () => number) => {
  const items = ["roadDecoration:plant-lavender-roadside-ground-0:native",
    "roadDecoration:roman-ceremonial-arch:limestone"] as const;
  const environment = { heightAt: () => 2, isFree: () => true, isOwned: () => true, nation: "roman" as const,
    roads: [] };
  const owner = createRoadDecorationState(() => environment);
  for (let placed = 0; placed < 30; placed++)
    owner.place({ item: items[placed % 2]!, position: { x: 4 + random() * 40, z: 4 + random() * 40 },
      yaw: random() * 6 }, () => true);
  expect(owner.frames().length).toBeGreaterThan(10);
  Object.assign(context, { roadDecorations: owner });
};

const mixedWorld = (decorated = false) => {
  const random = createRandom(41);
  const world = { seed: 3, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
    walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: treeProps(random) } as unknown as WorldData;
  for (let z = 20; z < 26; z++) for (let x = 38; x < 44; x++) world.walkCost[z * SIZE + x] = 0;
  const context = { options: { world, roads: createRoadNetwork(world) }, buildings: [], actors: [],
    nextBuilding: 1, occupied: new Uint8Array(SIZE ** 2), playerNation: "roman",
    reservations: new Set(), navigationRevision: 0 } as unknown as SettlementContext;
  place(context, 0, 10, 10, 0);
  place(context, 17, 22, 10, 1, { output: { planks: 6 } });
  place(context, 62, 32, 12, 2);
  place(context, 17, 10, 22, 3, { construction: .4 });
  place(context, 17, 24, 22, 0, { bandit: {} } as Partial<SettlementBuilding>);
  if (decorated) decorate(context, random);
  return { context, random };
};

describe("mounted clearance fast path", () => {
  it.each([false, true])("answers every point like the full horse clearance test (decorations %s)", decorated => {
    const { context, random } = mixedWorld(decorated);
    // Random points, and a quarter-tile lattice whose probes land exactly on plot and tile edges.
    const points = Array.from({ length: 12000 }, () => ({ x: random() * SIZE, z: random() * SIZE }));
    for (let z = 0; z < SIZE; z += .25) for (let x = 0; x < SIZE; x += .25) points.push({ x, z });
    const expected = points.map(point => isMountedNavigationClear(context, point));
    const scoped = withBuildingNavigationSearch(context, () =>
      points.map(point => isMountedNavigationClear(context, point)));
    expect(scoped).toEqual(expected);
    const sure = withBuildingNavigationSearch(context, () =>
      points.filter(point => isMountedPointSurelyClear(context, point)).length);
    const clear = expected.filter(Boolean).length;
    // Both answers occur, and the fast path decides most clear points by itself.
    expect(clear).toBeGreaterThan(points.length * .2);
    expect(clear).toBeLessThan(points.length * .9);
    expect(sure).toBeGreaterThan(clear * .5);
  });

  it.each([false, true])("answers every corridor segment like the sampled test (decorations %s)", decorated => {
    const { context, random } = mixedWorld(decorated);
    // Between tile representatives (centre or a 0.3 offset), as the corridor edges sample them.
    const offset = () => [0, .3, -.3][Math.floor(random() * 3)]!;
    const segments: Array<[SettlementPoint, SettlementPoint]> = Array.from({ length: 6000 }, () => {
      const x = 1 + Math.floor(random() * (SIZE - 2)), z = 1 + Math.floor(random() * (SIZE - 2));
      return [{ x: x + .5 + offset(), z: z + .5 + offset() },
        { x: x + Math.floor(random() * 3) - .5 + offset(), z: z + Math.floor(random() * 3) - .5 + offset() }];
    });
    const blocked = (point: SettlementPoint) => !isMountedNavigationClear(context, point);
    const expected = segments.map(([from, to]) => isGroundSegmentClear(context, from, to, blocked));
    const scoped = withBuildingNavigationSearch(context, () =>
      segments.map(([from, to]) => isMountedGroundSegmentClear(context, from, to)));
    expect(scoped).toEqual(expected);
    const clear = expected.filter(Boolean).length;
    expect(clear).toBeGreaterThan(segments.length * .2);
    expect(clear).toBeLessThan(segments.length * .95);
  });
});
