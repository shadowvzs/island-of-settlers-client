import { describe, expect, it } from "vitest";

import { countSettlementLand, createBuildClass } from "../src/shared/world/build-class";
import { getFootprintShortfall, packAround } from "../src/shared/world/building-space";
import { START_AREA } from "../src/shared/world/generation/clearings";
import {
  DEFAULT_WORLD_OPTIONS,
  type WorldOptions
} from "../src/shared/world/generation/generate-world";
import { ISLAND_THEMES } from "../src/shared/world/generation/island-themes";
import { LANDFORMS } from "../src/shared/world/generation/landforms";
import { isShrub } from "../src/shared/world/generation/shrub-rules";
import { createMountainField } from "../src/shared/world/rock-cover";
import { MATERIAL, MATERIAL_COUNT, PROP, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const REFERENCE: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, seed: 42 };
const TREES = new Set<number>([
  PROP.broadleafTree,
  PROP.coniferTree,
  PROP.palmTree,
  PROP.birchTree
]);
const SLOW = 60_000;

const generate = (options: Partial<WorldOptions>) => cachedWorld({ ...REFERENCE, ...options });

const countProps = (world: WorldData, isKind: (type: number) => boolean) =>
  world.props.types.reduce((count, type) => (isKind(type) ? count + 1 : count), 0);

/** Average splat share of each material over the dry land. */
const getMaterialShares = (world: WorldData) => {
  const shares = new Array<number>(MATERIAL_COUNT).fill(0);
  let land = 0;
  world.waterDepth.forEach((depth, vertex) => {
    if (depth > 0) return;
    land += 1;
    for (let material = 0; material < MATERIAL_COUNT; material += 1) {
      shares[material]! += world.splat[vertex * MATERIAL_COUNT + material]! / 255;
    }
  });
  return shares.map((share) => share / land);
};

const meetsBuildingGuarantee = (world: WorldData) => {
  const landCells = countSettlementLand(world);
  const { maxRadius, plan } = START_AREA;
  // The island minimums count the land once the trees are felled; the start fits at once.
  const felled = { ...world, buildClass: createBuildClass(world, false) };
  return (
    getFootprintShortfall(felled, landCells) === 0 &&
    packAround(world, world.start, maxRadius, plan) === plan.length
  );
};

describe("world options", () => {
  it("rivers off leaves no river water", () => {
    const world = generate({ rivers: 0 });
    expect(world.waterfalls).toHaveLength(0);
    expect(world.waterSurface.every((surface) => surface === world.seaLevel)).toBe(true);
    expect(generate({}).waterSurface.some((surface) => surface > world.seaLevel)).toBe(true);
  });

  it(
    "the forest amount scales the tree count, the building minimums still hold",
    () => {
      const options = { cellsX: 256, cellsZ: 256, seed: 7 };
      const isTree = (type: number) => TREES.has(type);
      const few = countProps(generate({ ...options, forest: 0 }), isTree);
      const normal = countProps(generate(options), isTree);
      const sparse = countProps(generate({ ...options, forest: .35 }), isTree);
      const sparseThin = countProps(generate({ ...options, forest: .35, treeDensity: .45 }), isTree);
      const manyWorld = generate({ ...options, forest: 2 });
      expect(few).toBeLessThan(normal * 0.6);
      // The map generator's "Few" preset keeps the sparse forest mask but halves its tree candidates.
      expect(sparseThin / sparse).toBeGreaterThan(0.4);
      expect(sparseThin / sparse).toBeLessThan(0.6);
      // The default already woods the broad mountain flanks; "Many" adds mostly on slopes.
      expect(countProps(manyWorld, isTree)).toBeGreaterThan(normal * 1.15);
      expect(meetsBuildingGuarantee(manyWorld)).toBe(true);
    },
    SLOW
  );

  it("no mountains leaves only hills: no mountain rock skin anywhere", () => {
    const world = generate({ mountains: 0 });
    expect(createMountainField(world, world.heights).every((share) => share === 0)).toBe(true);
    const normal = generate({});
    expect(createMountainField(normal, normal.heights).some((share) => share > 0.5)).toBe(true);
  });

  it("many mountains raise more rock than the default", () => {
    const rockShare = (world: WorldData) => getMaterialShares(world)[MATERIAL.rock]!;
    expect(rockShare(generate({ mountains: 2 }))).toBeGreaterThan(rockShare(generate({})));
  });
});

describe("island themes", () => {
  it("meadow is the default world", () => {
    expect(generate({ theme: "meadow" }).splat).toEqual(generate({}).splat);
  });

  it("desert is sand dominated, dirt is dirt and gravel dominated", () => {
    const meadow = getMaterialShares(generate({}));
    const desert = getMaterialShares(generate({ theme: "desert" }));
    const dirt = getMaterialShares(generate({ theme: "dirt" }));
    const grass = (shares: number[]) => shares[MATERIAL.grass]! + shares[MATERIAL.lushGrass]!;
    const soil = (shares: number[]) => shares[MATERIAL.dirt]! + shares[MATERIAL.gravel]!;
    expect(desert[MATERIAL.sand]).toBeGreaterThan(0.45);
    expect(desert[MATERIAL.sand]).toBeGreaterThan(grass(desert));
    expect(soil(dirt)).toBeGreaterThan(grass(dirt));
    expect(soil(dirt)).toBeGreaterThan(soil(meadow) * 1.5);
    expect(grass(meadow)).toBeGreaterThan(soil(meadow));
    expect(grass(meadow)).toBeGreaterThan(grass(dirt) * 1.3);
  });

  // Owner 2026-10-18: new home maps grow ordinary softwood only (pine inland, palms on the
  // coast), replacing the earlier steppe-versus-meadow conifer/broadleaf share comparison.
  it("desert grows mostly palms, steppe and meadow grow only pine and palms", () => {
    const isTree = (type: number) => TREES.has(type);
    const getShare = (world: WorldData, kind: number) =>
      countProps(world, (type) => type === kind) / countProps(world, isTree);
    const desert = generate({ theme: "desert" });
    expect(getShare(desert, PROP.palmTree)).toBeGreaterThan(0.8);
    for (const world of [generate({ seed: 1234, theme: "dirt" }), generate({ seed: 1234 })]) {
      const softwood = getShare(world, PROP.coniferTree) + getShare(world, PROP.palmTree);
      expect(getShare(world, PROP.coniferTree)).toBeGreaterThan(0);
      expect(softwood).toBeCloseTo(1, 10);
    }
  });

  it("bushes: meadow keeps them, steppe clearly fewer, desert drastically fewer", () => {
    const meadow = countProps(generate({}), isShrub);
    const dirt = countProps(generate({ theme: "dirt" }), isShrub);
    const desert = countProps(generate({ theme: "desert" }), isShrub);
    expect(meadow).toBeGreaterThan(100);
    expect(dirt).toBeLessThan(meadow * 0.6);
    expect(desert).toBeLessThan(meadow * 0.1);
  });
});

describe("building space at the option extremes", () => {
  const extremes: Partial<WorldOptions>[] = [
    { forest: 2, mountains: 2 },
    { forest: 0, mountains: 0, rivers: 0 }
  ];

  it.each(ISLAND_THEMES)(
    "%s keeps the minimums and the start settlement",
    (theme) => {
      for (const extreme of extremes) {
        expect(meetsBuildingGuarantee(generate({ ...extreme, theme }))).toBe(true);
      }
    },
    SLOW
  );

  it.each(LANDFORMS)(
    "%s on the smallest map (64 x 64)",
    (landform) => {
      for (const theme of ISLAND_THEMES) {
        const world = generate({
          cellsX: 64,
          cellsZ: 64,
          forest: 2,
          landform,
          mountains: 2,
          theme
        });
        expect(meetsBuildingGuarantee(world)).toBe(true);
      }
    },
    SLOW
  );
});
