import { describe, expect, it } from "vitest";

import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { createCritterManager } from "../src/render-common/critters/critter-manager";
import {
  createCritterSites,
  type CritterSite
} from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { computeEnvironment } from "../src/render-common/environment";
import { buildEditedRegion } from "../src/render-common/map-edit/region-rebuild";
import { getTreeSpecies } from "../src/render-common/props/island-trees";
import { getIslandRocks, getKnownRocks } from "../src/render-common/rocks/island-rock-instances";
import { listRegionChunks } from "../src/render-common/terrain-chunks";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { RESPAWN_TICKS } from "../src/render-common/wildlife/population/respawn-ledger";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import {
  applyStampChanges,
  checkStampChange
} from "../src/shared/world/editing/terrain/terrain-apply";
import {
  addStamp,
  createTerrainEditState,
  lowerStampAt,
  type StampChange,
  type TerrainEditState
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { getStampRadius } from "../src/shared/world/editing/terrain/terrain-stamps";
import { getCircleRegion, unionRegions } from "../src/shared/world/grid-geometry";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";
import { createCritterWorld, createRockVolume, createView } from "./critter-test-world";
import { findOpenSpots } from "./editor-spots";

const SEED = 1234;
/** Ground that stays this high around a lake keeps it fresh (it lies just below its rim). */
const FRESH_RIM = 1.5;
const LAKE_REACH = 11;

type Spot = { x: number; z: number };

/** The editor's terrain path: the stamps applied, the touched chunks' rocks placed afresh. */
const applyTerrainEdit = (world: WorldData, state: TerrainEditState, changes: StampChange[]) => {
  const applied = applyStampChanges(world, state, changes);
  buildEditedRegion(world, {
    cells: applied.cells,
    chunks: listRegionChunks(world, applied.cells),
    modes: [],
    placed: getKnownRocks(world),
    waterField: applied.waterChanged
  });
  return applied;
};

/** Lowest ground within `reach` cells of a vertex. */
const getLowestAround = (world: WorldData, x: number, z: number, reach: number) => {
  let lowest = Infinity;
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      lowest = Math.min(lowest, world.heights[(z + dz) * (world.cellsX + 1) + x + dx]!);
    }
  }
  return lowest;
};

/** Open inland ground high enough all around for a fresh lake (not one level with the sea). */
const findLakeSpot = (world: WorldData): Spot => {
  const stride = world.cellsX + 1;
  for (let z = LAKE_REACH; z < world.cellsZ - LAKE_REACH; z += 1) {
    for (let x = LAKE_REACH; x < world.cellsX - LAKE_REACH; x += 1) {
      const vertex = z * stride + x;
      if (world.buildClass[z * world.cellsX + x] !== BUILD.large) continue;
      if (world.coastDistance[vertex]! < 10 || world.riverDistance[vertex]! < 14) continue;
      if (getLowestAround(world, x, z, LAKE_REACH) >= FRESH_RIM) return { x: x + 0.5, z: z + 0.5 };
    }
  }
  throw new Error("no spot for a fresh lake");
};

const siteKey = (site: CritterSite) => `${site.colony}:${site.x}:${site.z}`;

const isColony = (site: CritterSite, names: readonly string[]) =>
  names.includes(CRITTER_COLONIES[site.colony]!.name);

const isNear = (site: CritterSite, spot: Spot, reach: number) =>
  Math.hypot(site.x - spot.x, site.z - spot.z) <= reach;

/** An island with its critter homes (the rocks placed, as the renderers place them first). */
const createHomes = (seed = SEED) => {
  const world = createCritterWorld(seed);
  getIslandRocks(world);
  const terrain = createCritterTerrain(world);
  const sites = createCritterSites(terrain, CRITTER_COLONIES);
  const edit = (state: TerrainEditState, changes: StampChange[]) => {
    const applied = applyTerrainEdit(world, state, changes);
    terrain.refresh(applied.cells);
    sites.refresh(applied.cells);
    return applied;
  };
  return { edit, sites, terrain, world };
};

const digLake = (state: TerrainEditState, spot: Spot) =>
  addStamp(state, spot, 5, 11, { kind: "lake" });

/** Open ground for a level 6 mountain (the 3rd open spot; seeded below: meadow all around). */
const findMountainSpot = (world: WorldData) => findOpenSpots(world, 8, 12)[2]!;
/** An island whose 3rd open spot has meadow and rock-free ground around a new mountain. */
const MOUNTAIN_SEED = 99;

const fillBack = (state: TerrainEditState, spot: Spot) =>
  Array.from({ length: 5 }, () => lowerStampAt(state, spot.x, spot.z, "lake")!);

/** Island generation, rock placement and the edits' rebuilds take a few seconds per test. */
const SLOW = { timeout: 60_000 };

describe("critter homes after map edits", SLOW, () => {
  it("updates lake habitat and capped colony homes when dug and filled back", () => {
    const { edit, sites, terrain, world } = createHomes();
    const before = createCritterTerrain(structuredClone(world));
    const previousHomes = new Set(sites.list.map(siteKey));
    const spot = findLakeSpot(world);
    const state = createTerrainEditState();
    const lake = digLake(state, spot);
    expect(checkStampChange(world, state, lake)).toBeNull();
    const { cells } = edit(state, [lake]);
    // Warped outlines and the bank extend beyond the stamp's nominal circular radius.
    // Check newly selected homes inside the actual edit, rather than that circle.
    const lakeHomes = sites.list.filter(
      (site) => {
        if (!isColony(site, ["frogs", "mallards"])) return false;
        if (site.x < cells.minX || site.x > cells.maxX + 1) return false;
        if (site.z < cells.minZ || site.z > cells.maxZ + 1) return false;
        return !previousHomes.has(siteKey(site));
      }
    );
    expect(lakeHomes.some((site) => isColony(site, ["mallards"]))).toBe(true);
    // Frog homes are ranked island-wide and halved by ambient density. A suitable new
    // bank need not displace one of the island's existing top-ranked homes.
    const frog = CRITTER_COLONIES.find((colony) => colony.name === "frogs")!;
    const newBanks: number[] = [];
    for (let z = cells.minZ; z <= cells.maxZ + 1; z++) {
      for (let x = cells.minX; x <= cells.maxX + 1; x++) {
        const vertex = z * (world.cellsX + 1) + x;
        if (frog.habitat(before, vertex) === 0 && frog.habitat(terrain, vertex) > 0) {
          newBanks.push(vertex);
        }
      }
    }
    expect(newBanks.length).toBeGreaterThan(0);
    expect(sites.list.map(siteKey)).toEqual(createCritterSites(terrain, CRITTER_COLONIES).list.map(siteKey));
    edit(state, fillBack(state, spot));
    const kept = new Set(sites.list.map(siteKey));
    for (const home of lakeHomes) expect(kept.has(siteKey(home))).toBe(false);
    for (const vertex of newBanks) expect(frog.habitat(terrain, vertex)).toBe(0);
  });

  it("gives a new mountain chamois homes on its new habitat (seeded)", () => {
    const { edit, sites, world } = createHomes(MOUNTAIN_SEED);
    const before = createCritterTerrain(structuredClone(world));
    const wasHabitat = (site: CritterSite) =>
      CRITTER_COLONIES[site.colony]!.habitat(before, site.z * (world.cellsX + 1) + site.x) > 0;
    const spot = findMountainSpot(world);
    const state = createTerrainEditState();
    const mountain = addStamp(state, spot, 6, 7);
    edit(state, [mountain]);
    const reach = getStampRadius(mountain.after!) + 4;
    const added = sites.list.filter((site) => !wasHabitat(site) && isNear(site, spot, reach));
    // Marmots need a mountain foot (scoreMountainFoot) that a fresh stamp does not create; owner
    // 2026-11-07: keep today's behaviour, so only the chamois home is expected here.
    expect(added.some((site) => isColony(site, ["chamois"]))).toBe(true);
  });

  it("keeps every home that must be seen out of the rock after edits", () => {
    const { edit, sites, world } = createHomes();
    const state = createTerrainEditState();
    edit(state, [
      addStamp(state, findMountainSpot(world), 6, 7),
      digLake(state, findLakeSpot(world))
    ]);
    const isInsideRock = createRockVolume(world);
    const seen = sites.list.filter((site) => CRITTER_COLONIES[site.colony]!.inSight);
    expect(seen.length).toBeGreaterThan(0);
    for (const site of seen) expect(isInsideRock(site.x, site.z)).toBe(false);
  });

  it("gives the same homes for the same edits, as a loaded map of the edited island does", () => {
    const first = createHomes();
    const second = createHomes();
    for (const homes of [first, second]) {
      const state = createTerrainEditState();
      const lake = findLakeSpot(homes.world);
      const mountain = findMountainSpot(homes.world);
      homes.edit(state, [digLake(state, lake)]);
      homes.edit(state, [addStamp(state, mountain, 6, 7)]);
      homes.edit(state, fillBack(state, lake).slice(0, 2));
    }
    expect(second.sites.list).toEqual(first.sites.list);
    const loaded = structuredClone(first.world);
    const fresh = createCritterSites(createCritterTerrain(loaded), CRITTER_COLONIES);
    expect(fresh.list).toEqual(first.sites.list);
  });

  it("lets the critters of a home that went leave only out of view", () => {
    const world = createCritterWorld(SEED);
    getIslandRocks(world);
    const manager = createCritterManager(world);
    const before = new Set(manager.sites.list.map(siteKey));
    const spot = findLakeSpot(world);
    const state = createTerrainEditState();
    const dug = applyTerrainEdit(world, state, [digLake(state, spot)]);
    manager.refreshHomes(dug.cells);
    const environment = computeEnvironment(world.sun, 12, 0);
    const near = createView(world, spot.x, spot.z, 2);
    let time = 0;
    const run = (seconds: number, camera = near) => {
      for (const end = time + seconds; time < end; time += 1 / 30) {
        manager.update(time, camera, environment);
      }
    };
    run(3);
    const { pool } = manager.debug;
    const living = () => [...pool.active.keys()].filter((index) => pool.active[index] === 1);
    const lakeLife = living().filter((index) => {
      const site = manager.sites.list[pool.site[index]!]!;
      return isColony(site, ["frogs", "mallards"]) && !before.has(siteKey(site));
    });
    expect(lakeLife.length).toBeGreaterThan(0);
    const filled = applyTerrainEdit(world, state, fillBack(state, spot));
    manager.refreshHomes(filled.cells);
    for (const index of lakeLife) expect(pool.homeless[index]).toBeGreaterThan(0);
    run(1);
    for (const index of lakeLife) expect(pool.active[index]).toBe(1);
    run(1, createView(world, 8, 8, 2));
    for (const index of lakeLife) expect(pool.active[index]).toBe(0);
  });
});

/** The populated region with the most animals, and its tree props. */
const findPopulatedRegion = (world: WorldData, manager: ReturnType<typeof createAnimalManager>) => {
  const { regions } = manager.debug;
  let region = 0;
  for (let index = 1; index < regions.count; index += 1) {
    if (regions.population[index]! > regions.population[region]!) region = index;
  }
  if (regions.population[region]! === 0) throw new Error("no populated wildlife region");
  const trees = [...world.props.types.keys()].filter((prop) => prop < world.props.count &&
    getTreeSpecies(world.props.types[prop]!) !== undefined &&
    regions.regionOf(world.props.x[prop]!, world.props.z[prop]!) === region);
  return { region, trees };
};

/** Room for a grove: open ground without a tree within `reach` (a forest of its own). */
const findTreelessSpot = (world: WorldData, reach: number) => {
  const { props } = world;
  const trees = [...props.types.keys()].filter(
    (prop) => prop < props.count && getTreeSpecies(props.types[prop]!) !== undefined
  );
  const isTreeless = (x: number, z: number) =>
    trees.every((tree) => Math.hypot(props.x[tree]! - x, props.z[tree]! - z) >= reach);
  for (let cell = 0; cell < world.buildClass.length; cell += 3) {
    const x = (cell % world.cellsX) + 0.5;
    const z = Math.floor(cell / world.cellsX) + 0.5;
    if (world.buildClass[cell] === BUILD.large && isTreeless(x, z)) return { x, z };
  }
  throw new Error("no treeless spot for a grove");
};

/** A square grove of `side` x `side` trees 1.5 apart from (x, z). */
const plantGrove = (world: WorldData, spot: Spot, side: number) => {
  const placed: number[] = [];
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const request = { kind: PROP.broadleafTree, seed: row * side + column + 1 };
      const index = placeProp(world, {
        ...request,
        x: spot.x + column * 1.5,
        z: spot.z + row * 1.5
      });
      if (typeof index === "number") placed.push(index);
    }
  }
  return placed;
};

describe("wildlife homes after map edits", SLOW, () => {
  const createWildlife = () => {
    const world = createCritterWorld(SEED);
    const manager = createAnimalManager(world, createIslandNav(world, getIslandRocks(world)));
    return { manager, world };
  };

  it("sends away the animals of a region an editor clear-cut empties, wherever the camera looks", () => {
    const { manager, world } = createWildlife();
    manager.step();
    const { identity, ledger, pool, regions } = manager.debug;
    const { region, trees } = findPopulatedRegion(world, manager);
    const residents = [...identity.homeRegion.keys()].filter((slot) => identity.homeRegion[slot] === region);
    expect(residents.length).toBeGreaterThan(0);
    removePropsAt(world, trees);
    const cells = { maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0 };
    manager.refreshHomes(cells, { added: [], removed: trees });
    expect(regions.target[region]).toBe(0);
    expect(regions.population[region]).toBe(0);
    expect(ledger.pending(region)).toBe(0);
    for (const slot of residents) {
      expect(pool.active[slot]).toBe(0);
      expect(identity.dormant[slot]).toBe(0);
    }
    let time = 0;
    const far = createView(world, 4, 4, 2);
    for (; time < 2; time += 1 / 30) manager.update(time, far);
    for (const slot of residents) expect(pool.departing[slot]).toBe(0);
  });

  it("settles animals in a forest planted with the editor, five minutes per missing animal", () => {
    const { manager, world } = createWildlife();
    manager.step();
    const spot = findTreelessSpot(world, 16);
    const planted = plantGrove(world, { x: spot.x - 4.5, z: spot.z - 4.5 }, 7);
    expect(planted.length).toBeGreaterThanOrEqual(20);
    const cells = unionRegions(
      getCircleRegion(world, spot.x, spot.z, 1),
      getCircleRegion(world, spot.x + 9, spot.z + 9, 1)
    );
    const { regions } = manager.debug;
    const before = Int32Array.from(regions.population);
    const targets = Int32Array.from(regions.target);
    manager.refreshHomes(cells, { added: planted, removed: [] });
    const grown = [...regions.target.keys()].filter((region) => regions.target[region]! > targets[region]!);
    expect(grown.length).toBeGreaterThan(0);
    for (let tick = 0; tick < RESPAWN_TICKS - 20; tick += 1) manager.step();
    for (const region of grown) expect(regions.population[region]).toBe(before[region]);
    for (let tick = 0; tick < 40; tick += 1) manager.step();
    expect(grown.some((region) => regions.population[region]! > before[region]!)).toBe(true);
  });
});
