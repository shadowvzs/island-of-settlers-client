import { afterEach, describe, expect, it } from "vitest";

import {
  groundSearchMemoWork,
  resetGroundSearchMemoWork,
  setGroundSearchMemo
} from "../src/shared/settlement/ground-search-memo";
import { setNavigationInvalidation } from "../src/shared/settlement/navigation-change-journal";
import { searchGroundPath } from "../src/shared/settlement/settlement-navigation";
import { bumpNavigationRevision } from "../src/shared/settlement/settlement-reservations";
import { resetTrafficWork, trafficWork } from "../src/shared/settlement/settlement-traffic-counters";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { releaseFelledProp } from "../src/shared/world/build-class";
import { preloadWorlds } from "./helpers/cached-worlds";
import { JOURNAL_WORLD_OPTIONS, journalIsland, ROUTE_TO } from "./helpers/navigation-journal-fixture";

preloadWorlds(JOURNAL_WORLD_OPTIONS);

/** Beside the first trunk and the woodcutter: a 400-visit search to the far end runs out of budget. */
const FROM: SettlementPoint = { x: 18.5, z: 20.5 };
const BUDGET = 400;
/** A water channel across the island between the start and the goal: no search can succeed. */
const WALL_X = 30;
const walledIsland = () => {
  const island = journalIsland(), { world } = island;
  for (let z = 0; z < world.cellsZ; z++) world.walkCost[z * world.cellsX + WALL_X] = 0;
  return island;
};

const exhausted = (context: SettlementContext, from = FROM) =>
  searchGroundPath(context, from, ROUTE_TO, undefined, undefined, .5, BUDGET);
/**
 * Runs `search` and reports whether it had to search (false: the memo answered). Development builds
 * also rerun every few kept results to verify them, so the search counter alone cannot tell.
 */
const ranSearch = (search: () => unknown) => {
  const before = groundSearchMemoWork.hits;
  search();
  return groundSearchMemoWork.hits === before;
};

describe("ground search negative-result memo (A07)", () => {
  afterEach(() => {
    setGroundSearchMemo(true);
    setNavigationInvalidation({ mode: "local", strict: false });
    resetGroundSearchMemoWork();
    resetTrafficWork();
  });

  it("answers a repeated exhausted search from the memo with the identical result", () => {
    const { context } = walledIsland();
    const first = exhausted(context);
    expect(first).toEqual({ path: null, status: "budget-exhausted", visits: BUDGET });
    let again: ReturnType<typeof exhausted> | undefined;
    expect(ranSearch(() => { again = exhausted(context); })).toBe(false);
    expect(again).toEqual(first);
    expect(groundSearchMemoWork.hits).toBe(1);
  });

  it("keeps the memo across a far change and reruns after a change in its read region", () => {
    const { context, farTree, trees, world } = walledIsland();
    exhausted(context);
    releaseFelledProp(world, farTree);
    expect(ranSearch(() => exhausted(context))).toBe(false);
    releaseFelledProp(world, trees[0]!);
    let rerun: ReturnType<typeof exhausted> | undefined;
    expect(ranSearch(() => { rerun = exhausted(context); })).toBe(true);
    const cold = walledIsland();
    releaseFelledProp(cold.world, cold.farTree);
    releaseFelledProp(cold.world, cold.trees[0]!);
    expect(rerun).toEqual(exhausted(cold.context));
  });

  it("reruns after an unexplained navigation change or an occupancy byte no counter describes", () => {
    const { context } = walledIsland();
    exhausted(context);
    bumpNavigationRevision(context);
    expect(ranSearch(() => exhausted(context))).toBe(true);
    const { cellsX } = context.options.world;
    context.occupied[Math.floor(FROM.z + 2) * cellsX + Math.floor(FROM.x)] = 1;
    expect(ranSearch(() => exhausted(context))).toBe(true);
    expect(groundSearchMemoWork.stale).toBe(2);
  });

  it("never memoises successful searches or searches with predicate callbacks", () => {
    const { context } = walledIsland();
    const near = { x: FROM.x + 2, z: FROM.z };
    expect(searchGroundPath(context, FROM, near).status).toBe("found");
    expect(ranSearch(() => searchGroundPath(context, FROM, near))).toBe(true);
    const blocked = () => false;
    searchGroundPath(context, FROM, ROUTE_TO, blocked, undefined, .5, BUDGET);
    expect(ranSearch(() => searchGroundPath(context, FROM, ROUTE_TO, blocked, undefined, .5, BUDGET))).toBe(true);
    expect(groundSearchMemoWork.stores).toBe(0);
  });

  it("is off behind its rollback flag and in the global invalidation mode", () => {
    const { context } = walledIsland();
    setGroundSearchMemo(false);
    exhausted(context);
    expect(ranSearch(() => exhausted(context))).toBe(true);
    setGroundSearchMemo(true);
    setNavigationInvalidation({ mode: "global" });
    exhausted(context);
    expect(ranSearch(() => exhausted(context))).toBe(true);
    expect(groundSearchMemoWork.hits).toBe(0);
  });

  it("verifies every kept result in strict mode", () => {
    const { context } = walledIsland();
    setNavigationInvalidation({ strict: true });
    const first = exhausted(context), searches = trafficWork.groundSearches;
    expect(ranSearch(() => expect(exhausted(context)).toEqual(first))).toBe(false);
    expect(trafficWork.groundSearches).toBe(searches + 1);
  });

  it("caps the memo: the oldest entries are evicted", () => {
    const { context } = walledIsland();
    for (let index = 0; index < 300; index++) exhausted(context, { x: FROM.x, z: FROM.z + index / 1024 });
    expect(groundSearchMemoWork.stores).toBe(300);
    expect(groundSearchMemoWork.evictions).toBe(300 - 256);
    expect(ranSearch(() => exhausted(context, { x: FROM.x, z: FROM.z }))).toBe(true);
    expect(ranSearch(() => exhausted(context, { x: FROM.x, z: FROM.z + 299 / 1024 }))).toBe(false);
  });
});
