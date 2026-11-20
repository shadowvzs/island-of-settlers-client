import { describe, expect, it } from "vitest";

import { isCellOpen } from "../src/shared/settlement/military-long-routes";
import {
  activeNavigationSession,
  freshNavigationStamp,
  haloRect,
  isNavigationRegionFresh,
  navigationJournalWork,
  resetNavigationJournalWork,
  withNavigationSession
} from "../src/shared/settlement/navigation-change-journal";
import { buildingNavigationReach } from "../src/shared/settlement/settlement-building-navigation";
import { bumpFieldNavigationRevision, bumpNavigationRevision } from "../src/shared/settlement/settlement-reservations";
import { releaseFelledProp } from "../src/shared/world/build-class";
import {
  changedNavigationBlocks,
  checkWorldNavigationCounters,
  explainWorldNavigationChange,
  isWorldNavigationRegionUnchanged,
  markNavigationChange,
  NAVIGATION_BLOCK,
  navigationChangeRevision,
  propTileRect
} from "../src/shared/world/navigation-change-log";
import type { WorldData } from "../src/shared/world/world-data";
import { preloadWorlds } from "./helpers/cached-worlds";
import { JOURNAL_WORLD_OPTIONS, journalIsland } from "./helpers/navigation-journal-fixture";

preloadWorlds(JOURNAL_WORLD_OPTIONS);

const tile = (x: number, z: number) => ({ maxX: x, maxZ: z, minX: x, minZ: z });
const smallWorld = () => ({ buildRevision: 0, cellsX: 64, cellsZ: 64, props: { count: 0 }, terrainRevision: 0 }) as
  unknown as WorldData;

describe("navigation change log", () => {
  it("dirties only the blocks a change touches; later stamps are fresh again", () => {
    const world = smallWorld();
    checkWorldNavigationCounters(world);
    const stamp = navigationChangeRevision(world);
    markNavigationChange(world, tile(10, 10));
    expect(isWorldNavigationRegionUnchanged(world, tile(10 + NAVIGATION_BLOCK * 3, 10), stamp)).toBe(true);
    expect(isWorldNavigationRegionUnchanged(world, { maxX: 12, maxZ: 12, minX: 8, minZ: 8 }, stamp)).toBe(false);
    expect(isWorldNavigationRegionUnchanged(world, tile(10, 10), navigationChangeRevision(world))).toBe(true);
  });

  it("invalidates every older stamp when a counter moves outside an explained change", () => {
    const world = smallWorld();
    checkWorldNavigationCounters(world);
    const stamp = navigationChangeRevision(world);
    explainWorldNavigationChange(world, tile(5, 5), () => { world.buildRevision = 1; });
    expect(checkWorldNavigationCounters(world)).toBe(false);
    expect(isWorldNavigationRegionUnchanged(world, tile(40, 40), stamp)).toBe(true);
    world.buildRevision = 2;
    expect(checkWorldNavigationCounters(world)).toBe(true);
    expect(isWorldNavigationRegionUnchanged(world, tile(40, 40), stamp)).toBe(false);
  });

  it("lists the changed blocks of a region as tile rectangles, none while fresh, null past the floor", () => {
    const world = smallWorld(), region = { maxX: 40, maxZ: 40, minX: 0, minZ: 0 };
    checkWorldNavigationCounters(world);
    const stamp = navigationChangeRevision(world);
    expect(changedNavigationBlocks(world, region, stamp)).toEqual([]);
    markNavigationChange(world, { maxX: 17, maxZ: 9, minX: 10, minZ: 9 });
    expect(changedNavigationBlocks(world, region, stamp)).toEqual([
      { maxX: 15, maxZ: 15, minX: 8, minZ: 8 }, { maxX: 23, maxZ: 15, minX: 16, minZ: 8 }]);
    expect(changedNavigationBlocks(world, { maxX: 7, maxZ: 7, minX: 0, minZ: 0 }, stamp)).toEqual([]);
    world.buildRevision = 1;
    checkWorldNavigationCounters(world);
    expect(changedNavigationBlocks(world, region, stamp)).toBeNull();
  });

  it("does not let an explained change hide an earlier unexplained one", () => {
    const world = smallWorld();
    checkWorldNavigationCounters(world);
    const stamp = navigationChangeRevision(world);
    world.props.count = 3;
    explainWorldNavigationChange(world, tile(5, 5), () => { world.buildRevision = 1; });
    expect(isWorldNavigationRegionUnchanged(world, tile(40, 40), stamp)).toBe(false);
  });
});

describe("context navigation journal", () => {
  it("marks a building's whole index reach when its stock pile changes shape, nothing for a count alone", () => {
    const { context, woodcutter } = journalIsland();
    const reach = buildingNavigationReach(context.options.world, woodcutter);
    const near = haloRect(context, reach.maxX, reach.maxZ, reach.maxX, reach.maxZ);
    const far = haloRect(context, 70, 40, 70, 40);
    const stamp = freshNavigationStamp(context, near);
    resetNavigationJournalWork();
    woodcutter.output = { logs: 6 };
    expect(isNavigationRegionFresh(context, far, stamp)).toBe(true);
    expect(isNavigationRegionFresh(context, near, stamp)).toBe(false);
    const grown = freshNavigationStamp(context, near);
    woodcutter.output = { logs: 9 };
    expect(isNavigationRegionFresh(context, near, grown)).toBe(true);
    expect(navigationJournalWork.buildingChanges).toBe(1);
  });

  it("explains field reservations but treats any other navigation revision bump as global", () => {
    const { context } = journalIsland(), region = haloRect(context, 30, 30, 30, 30);
    const stamp = freshNavigationStamp(context, region);
    bumpFieldNavigationRevision(context);
    expect(isNavigationRegionFresh(context, region, stamp)).toBe(true);
    bumpNavigationRevision(context);
    expect(isNavigationRegionFresh(context, region, stamp)).toBe(false);
  });

  it("dirties only the felled trunk's tile (its obstacle bucket and walk cost)", () => {
    const { context, trees, world } = journalIsland(), trunk = propTileRect(world, trees[0]!);
    const beside = haloRect(context, trunk.minX, trunk.minZ, trunk.minX, trunk.minZ);
    const away = haloRect(context, trunk.minX + 2 * NAVIGATION_BLOCK, trunk.minZ + 2 * NAVIGATION_BLOCK,
      trunk.minX + 2 * NAVIGATION_BLOCK, trunk.minZ + 2 * NAVIGATION_BLOCK);
    const stamp = freshNavigationStamp(context, beside);
    freshNavigationStamp(context, away);
    releaseFelledProp(world, trees[0]!);
    expect(isNavigationRegionFresh(context, beside, stamp)).toBe(false);
    expect(isNavigationRegionFresh(context, away, stamp)).toBe(true);
  });

  it("treats a road decoration change as global", () => {
    const { context, placeDecoration } = journalIsland(), region = haloRect(context, 70, 70, 70, 70);
    const stamp = freshNavigationStamp(context, region);
    placeDecoration({ maxX: 21, maxZ: 21, minX: 20, minZ: 20 });
    expect(isNavigationRegionFresh(context, region, stamp)).toBe(false);
  });

  it("memoises open cells per session only: each session sees the live stock, as without a session", () => {
    const { context, woodcutter } = journalIsland();
    const reach = buildingNavigationReach(context.options.world, woodcutter);
    const cells: [number, number][] = [];
    for (let z = reach.minZ; z <= reach.maxZ; z++) for (let x = reach.minX; x <= reach.maxX; x++) cells.push([x, z]);
    const live = () => cells.map(([x, z]) => isCellOpen(context, x, z));
    const inSession = () => withNavigationSession(context, () => [live(), live()]);
    expect(activeNavigationSession(context)).toBe(0);
    const first = withNavigationSession(context, () => activeNavigationSession(context));
    const second = withNavigationSession(context, () => activeNavigationSession(context));
    expect(second).toBeGreaterThan(first);
    for (const output of [{}, { logs: 9 }, {}] as Record<string, number>[]) {
      woodcutter.output = output;
      const expected = live();
      expect(inSession()).toEqual([expected, expected]);
    }
  });
});
