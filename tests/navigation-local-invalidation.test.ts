import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { flowBounds, type MilitaryFlowField } from "../src/shared/settlement/military-flow-field";
import { flowFieldAt } from "../src/shared/settlement/military-flow-field-cache";
import { corridorPoints, createCorridorReach, riderTiles, routeRevision }
  from "../src/shared/settlement/military-long-routes";
import { isRiderTileClear } from "../src/shared/settlement/military-rider-tiles";
import {
  type NavigationInvalidationSettings,
  navigationJournalWork,
  resetNavigationJournalWork,
  setNavigationInvalidation
} from "../src/shared/settlement/navigation-change-journal";
import { bumpFieldNavigationRevision, bumpNavigationRevision } from "../src/shared/settlement/settlement-reservations";
import { releaseFelledProp } from "../src/shared/world/build-class";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import { explainWorldNavigationChange, propTileRect } from "../src/shared/world/navigation-change-log";
import { PROP } from "../src/shared/world/world-data";
import { preloadWorlds } from "./helpers/cached-worlds";
import {
  addFinishedBuilding,
  JOURNAL_WORLD_OPTIONS,
  type JournalIsland,
  journalIsland,
  ROUTE_FROM,
  ROUTE_TO
} from "./helpers/navigation-journal-fixture";

preloadWorlds(JOURNAL_WORLD_OPTIONS);

/** The caches a march reads: both flow fields and both corridor routes of the fixture route. */
interface MarchQuery {
  corridors: (ReturnType<typeof corridorPoints>)[];
  fields: MilitaryFlowField[];
  revision: string;
}
/** Like `fieldOf`: a field is looked at again only after a route revision change. */
const queryMarch = (island: JournalIsland, previous?: MarchQuery): MarchQuery => {
  const { context } = island, revision = routeRevision(context);
  const bounds = flowBounds(context, [ROUTE_FROM, ROUTE_TO]);
  const fields = [false, true].map((mounted, index) => previous?.revision === revision ? previous.fields[index]!
    : flowFieldAt(context, previous?.fields[index], ROUTE_TO, mounted, bounds, revision));
  const corridors = [false, true].map(mounted => corridorPoints(context, ROUTE_FROM, ROUTE_TO, mounted));
  return { corridors, fields, revision };
};
const expectSameMarch = (incremental: MarchQuery, cold: MarchQuery) => {
  for (const [index, field] of incremental.fields.entries()) {
    expect(Array.from(field.cost), `field ${index} cost`).toEqual(Array.from(cold.fields[index]!.cost));
    expect(Array.from(field.next), `field ${index} next`).toEqual(Array.from(cold.fields[index]!.next));
  }
  expect(incremental.corridors).toEqual(cold.corridors);
};

type Change = (island: JournalIsland) => void;
/** A tile near the corridor where a planted sapling stands in the way. */
const plantNearRoute: Change = ({ world }) => {
  explainWorldNavigationChange(world, { maxX: 22, maxZ: 21, minX: 22, minZ: 21 }, () => {
    placeProp(world, { kind: PROP.broadleafTree, seed: 77, x: 22.5, z: 21.5 });
    world.buildRevision = (world.buildRevision ?? 0) + 1;
  });
};
const removeBoulder = (index: number, explained: boolean): Change => ({ rocks, world }) => {
  const remove = () => {
    removePropsAt(world, [rocks[index]!]);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
  };
  if (explained) explainWorldNavigationChange(world, propTileRect(world, rocks[index]!), remove);
  else remove();
};
/**
 * keep: both fields kept without re-reading; reread: kept after re-reading the tiles round the
 * changed blocks (A03b: the change moved no input the fields read); rebuild: a field was built.
 */
interface Step { change: Change; expectation?: "keep" | "rebuild" | "reread"; name: string }
const STEPS: readonly Step[] = [
  { change: ({ farStore }) => { farStore.output = { planks: 4 }; }, expectation: "keep",
    name: "far stock pile grows" },
  { change: ({ woodcutter }) => { woodcutter.output = { logs: 6 }; }, expectation: "reread",
    name: "near log pile grows" },
  { change: ({ woodcutter }) => { woodcutter.output = { logs: 9 }; }, expectation: "keep",
    name: "near stock count changes, pile shape stays" },
  { change: ({ context }) => bumpFieldNavigationRevision(context), expectation: "keep",
    name: "field reservation" },
  { change: ({ farTree, world }) => releaseFelledProp(world, farTree), expectation: "keep",
    name: "far tree felled" },
  { change: ({ trees, world }) => releaseFelledProp(world, trees[1]!), expectation: "rebuild",
    name: "near tree felled" },
  { change: plantNearRoute, expectation: "rebuild", name: "sapling planted beside the route" },
  { change: removeBoulder(0, true), expectation: "rebuild", name: "boulder worked out" },
  { change: removeBoulder(1, false), expectation: "rebuild", name: "boulder removed without a journal entry" },
  { change: ({ woodcutter }) => { woodcutter.workshopUpgrade = { level: 2 }; }, expectation: "reread",
    name: "workshop level" },
  { change: ({ context }) => {
    const site = addFinishedBuilding(context, 17, 34, 27);
    site.construction = 0;
    bumpNavigationRevision(context);
  }, expectation: "rebuild", name: "construction site placed" },
  { change: ({ context }) => { context.buildings.at(-1)!.construction = 1; }, expectation: "rebuild",
    name: "construction completed" },
  { change: ({ placeDecoration }) => placeDecoration({ maxX: 31, maxZ: 25, minX: 30, minZ: 24 }),
    expectation: "rebuild", name: "road decoration placed" },
  { change: ({ context }) => { addFinishedBuilding(context, 33, 30, 18); bumpNavigationRevision(context); },
    expectation: "rebuild", name: "store beside the route placed" },
  // The pile takes standing points and corridor edges the fields read: a genuine rebuild.
  { change: ({ context }) => { context.buildings.at(-1)!.output = { planks: 6 }; }, expectation: "rebuild",
    name: "store pile beside the route grows" }
];
const expectWork = (work: typeof navigationJournalWork, step: Step) => {
  if (step.expectation === "keep") expect(work, step.name).toMatchObject({ fieldBuilds: 0, fieldKeeps: 2, fieldRereads: 0 });
  if (step.expectation === "reread") {
    expect(work, step.name).toMatchObject({ fieldBuilds: 0, fieldKeeps: 2 });
    expect(work.fieldRereads, step.name).toBeGreaterThan(0);
  }
  if (step.expectation === "rebuild") expect(work.fieldBuilds, step.name).toBeGreaterThan(0);
};

describe("A03 local navigation invalidation", () => {
  let previous: NavigationInvalidationSettings;
  beforeEach(() => { previous = setNavigationInvalidation({ mode: "local", strict: true }); });
  afterEach(() => { setNavigationInvalidation(previous); });

  /** Every step compares against a cold island with strict verification on: about 0.4 s per step. */
  const STEPS_TIMEOUT = 15_000;
  it("answers like a cold cache after every stock, building, tree, boulder and decoration change", () => {
    const island = journalIsland();
    let query = queryMarch(island);
    expectSameMarch(query, queryMarch(journalIsland()));
    for (const [index, step] of STEPS.entries()) {
      step.change(island);
      resetNavigationJournalWork();
      query = queryMarch(island, query);
      const work = { ...navigationJournalWork };
      const cold = journalIsland();
      for (const earlier of STEPS.slice(0, index + 1)) earlier.change(cold);
      expectSameMarch(query, queryMarch(cold));
      expectWork(work, step);
    }
    expect(query.fields).toHaveLength(2);
  }, STEPS_TIMEOUT);

  it("shares one fresh field between groups with the same target, ground and box", () => {
    const { context, farStore } = journalIsland(), bounds = flowBounds(context, [ROUTE_FROM, ROUTE_TO]);
    const first = flowFieldAt(context, undefined, ROUTE_TO, true, bounds, routeRevision(context));
    farStore.output = { planks: 6 };
    resetNavigationJournalWork();
    const second = flowFieldAt(context, undefined, ROUTE_TO, true, bounds, routeRevision(context));
    expect(second).toBe(first);
    expect(navigationJournalWork).toMatchObject({ fieldBuilds: 0, fieldShares: 1 });
  });

  it("rebuilds everything at every boundary in the rollback mode", () => {
    setNavigationInvalidation({ mode: "global" });
    const island = journalIsland(), first = queryMarch(island);
    island.farStore.output = { planks: 4 };
    const second = queryMarch(island, first);
    expect(second.fields[0]).not.toBe(first.fields[0]);
    expectSameMarch(second, first);
  });
});

describe("A03 rider tile epochs", () => {
  /** A tile beside the plank store whose horse clearance its plank pile takes away (store left empty). */
  const pileTile = (island: JournalIsland) => {
    const { context, farStore, world } = island, tiles: number[] = [];
    for (let z = 74; z < 87; z++) for (let x = 74; x < 87; x++) tiles.push(z * world.cellsX + x);
    farStore.output = {};
    const clear = tiles.filter(tile => isRiderTileClear(context, tile));
    farStore.output = { planks: 6 };
    const taken = clear.find(tile => !isRiderTileClear(context, tile));
    farStore.output = {};
    if (taken === undefined) throw new Error("Expected the plank pile to take a rider tile");
    return taken;
  };

  it("keeps a value read in an epoch until the route revision changes, like the old per-revision array", () => {
    const island = journalIsland(), { context, farStore } = island, tile = pileTile(island);
    let tick = 1;
    context.clock = { tick: () => tick } as typeof context.clock;
    expect(riderTiles(context).clear(tile)).toBe(true);
    // Within one tick the stock revision is cached: the epoch keeps what it read, like before A03.
    farStore.output = { planks: 6 };
    expect(riderTiles(context).clear(tile)).toBe(true);
    tick = 2;
    expect(riderTiles(context).clear(tile)).toBe(false);
  });

  it("lets a lingering flood keep its own epoch's tiles across a boundary", () => {
    const island = journalIsland(), { context, farStore, world } = island, tile = pileTile(island);
    const lingering = riderTiles(context, true), unread = tile + world.cellsX;
    expect(lingering.clear(tile)).toBe(true);
    farStore.output = { planks: 6 };
    expect(riderTiles(context).clear(tile)).toBe(false);
    // The flood's epoch read the tile before the pile grew; a tile it never read is computed live.
    expect(lingering.clear(tile)).toBe(true);
    expect(lingering.clear(unread)).toBe(isRiderTileClear(context, unread));
    expect(createCorridorReach(context, ROUTE_TO)(ROUTE_FROM, true)).toBe(true);
  });
});
