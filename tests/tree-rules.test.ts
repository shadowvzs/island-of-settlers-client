import { describe, expect, it } from "vitest";

import { getTreeAgeStage } from "../src/render-common/props/island-trees";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getThemeParameters } from "../src/shared/world/generation/island-themes";
import { chooseDuneProp, NONE, type PropSample } from "../src/shared/world/generation/prop-rules";
import {
  chooseTreeForm,
  chooseTreeSpecies,
  getTreeChance,
  getTreeScale
} from "../src/shared/world/generation/tree-rules";
import { createRandom } from "../src/shared/world/rng";
import { BIRCH, getFormArchetype } from "../src/shared/world/tree-forms";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/** Fertile inland meadow forest, far from the sea and the mountains. */
const INLAND: PropSample = {
  cluster: 0.4,
  coast: 14,
  curvature: 0,
  depth: 0,
  exposure: 0,
  forest: 0.7,
  forestSlopeX: 0,
  forestSlopeZ: 0,
  grain: 0.2,
  grove: 0,
  heatLoad: 0.5,
  height: 1.6,
  moisture: 0.5,
  mountainDistance: 30,
  patches: 0,
  plateau: 0,
  riverDistance: 20,
  rock: 0,
  rockSkin: 0,
  sand: 0,
  seaDistance: 40,
  slope: 0.2,
  species: 0,
  stand: 0,
  surfaceSlope: 0.2,
  trunkDistance: 2,
  vegetation: getThemeParameters("meadow").vegetation
};

const SANDY_COAST: PropSample = {
  ...INLAND,
  coast: 1.8,
  forest: 0,
  height: 0.6,
  moisture: 0.2,
  sand: 0.8,
  seaDistance: 1.8,
  vegetation: getThemeParameters("desert").vegetation
};

const MOUNTAIN_FOOT: PropSample = { ...INLAND, height: 3.6, mountainDistance: 2, slope: 0.4 };

/** Share of each tree kind over many rolls at one spot. */
const countSpecies = (sample: PropSample, rolls = 400) => {
  const random = createRandom(11);
  const counts = new Map<number, number>();
  for (let roll = 0; roll < rolls; roll += 1) {
    const kind = chooseTreeSpecies(sample, random);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return (kind: number) => (counts.get(kind) ?? 0) / rolls;
};

describe("tree species by site", () => {
  it("grows palms on the warm sandy coast, never broadleaf or conifers", () => {
    expect(countSpecies(SANDY_COAST)(PROP.palmTree)).toBe(1);
    const temperate = { ...SANDY_COAST, vegetation: getThemeParameters("meadow").vegetation };
    expect(countSpecies(temperate)(PROP.palmTree)).toBe(0);
    expect(countSpecies(temperate)(PROP.coniferTree)).toBe(1);
  });

  it("grows palms on warm dry low ground behind the beach", () => {
    const backshore = { ...SANDY_COAST, coast: 3, sand: 0, seaDistance: 3 };
    expect(countSpecies(backshore)(PROP.palmTree)).toBeGreaterThan(0.9);
    const wideBelt = { ...SANDY_COAST, coast: 8, height: 1.6, sand: 0, seaDistance: 8 };
    expect(countSpecies(wideBelt)(PROP.palmTree)).toBeGreaterThan(0.9);
  });

  it("grows broadleaf forest inland", () => {
    expect(countSpecies(INLAND)(PROP.broadleafTree)).toBeGreaterThan(0.95);
  });

  it("grows conifers at the mountain foot and on high ground", () => {
    expect(countSpecies(MOUNTAIN_FOOT)(PROP.coniferTree)).toBeGreaterThan(0.95);
    const highland = { ...INLAND, height: 4.6 };
    expect(countSpecies(highland)(PROP.coniferTree)).toBeGreaterThan(0.95);
  });

  it("mixes species in the bands between the zones", () => {
    const transition = { ...INLAND, mountainDistance: 6.5 };
    const share = countSpecies(transition);
    expect(share(PROP.coniferTree)).toBeGreaterThan(0.05);
    expect(share(PROP.broadleafTree)).toBeGreaterThan(0.05);
  });
});

describe("birch habitat", () => {
  const bank = { ...INLAND, coast: 2.5, moisture: 0.8 };
  const edge = { ...INLAND, forest: 0.22 };
  const meadow = { ...INLAND, forest: 0, moisture: 0.6 };

  it("grows birches mostly in their own small groves on open ground", () => {
    expect(countSpecies({ ...edge, grove: 0.6 })(PROP.birchTree)).toBeGreaterThan(0.75);
    expect(countSpecies({ ...meadow, grove: 0.6 })(PROP.birchTree)).toBeGreaterThan(0.75);
    expect(getTreeChance({ ...meadow, grove: 0.6 })).toBeGreaterThan(0.5);
    expect(getTreeChance(meadow)).toBeLessThan(0.1);
    expect(countSpecies(edge)(PROP.birchTree)).toBeLessThan(0.2);
  });

  it("keeps birches out of closed oak cores (shade), even where the grove noise peaks", () => {
    expect(countSpecies({ ...INLAND, grove: 0.6 }, 2000)(PROP.birchTree)).toBeLessThan(0.03);
    expect(countSpecies({ ...INLAND, grove: 0.6, patches: 0.7 })(PROP.birchTree)).toBeGreaterThan(
      0.5
    );
  });

  it("mixes birches into conifer stands, more with pine than spruce, and the pine / oak band", () => {
    const pine = countSpecies({ ...MOUNTAIN_FOOT, stand: -0.8 }, 1000)(PROP.birchTree);
    const spruce = countSpecies({ ...MOUNTAIN_FOOT, stand: 0.8 }, 1000)(PROP.birchTree);
    expect(pine).toBeGreaterThan(spruce);
    expect(pine).toBeGreaterThan(0.08);
    expect(pine).toBeLessThan(0.45);
    expect(countSpecies({ ...INLAND, mountainDistance: 6.5 })(PROP.birchTree)).toBeGreaterThan(
      0.05
    );
  });

  it("scatters a few on banks, none on the beach, fewer on dry ground", () => {
    expect(countSpecies(bank, 2000)(PROP.birchTree)).toBeGreaterThan(0.003);
    expect(countSpecies(SANDY_COAST)(PROP.birchTree)).toBe(0);
    const grove = { ...edge, grove: 0.6 };
    const dry = { ...grove, moisture: 0.05 };
    expect(countSpecies(dry)(PROP.birchTree)).toBeLessThan(countSpecies(grove)(PROP.birchTree));
  });

  it("makes weeping birches common on the banks and rare away from water", () => {
    const random = createRandom(9);
    const weepingShare = (sample: PropSample) => {
      const forms = Array.from({ length: 400 }, () =>
        chooseTreeForm(sample, PROP.birchTree, random)
      );
      return forms.filter((form) => getFormArchetype(form) === BIRCH.weeping).length / 400;
    };
    expect(weepingShare(bank)).toBeGreaterThan(0.4);
    expect(weepingShare(INLAND)).toBeLessThan(0.15);
    expect(chooseTreeForm(INLAND, PROP.broadleafTree, random)).toBe(0);
  });
});

describe("tree chance", () => {
  it("keeps palm groves on the beach but the wet sand and the water line bare", () => {
    expect(getTreeChance(SANDY_COAST)).toBeGreaterThan(0.1);
    expect(getTreeChance({ ...SANDY_COAST, coast: 0.6 })).toBe(0);
    expect(getTreeChance({ ...SANDY_COAST, vegetation: getThemeParameters("meadow").vegetation })).toBe(0);
  });

  it("never roots a tree in rock: mountain skin, rock faces, bare rock", () => {
    expect(getTreeChance(MOUNTAIN_FOOT)).toBeGreaterThan(0.3);
    expect(getTreeChance({ ...MOUNTAIN_FOOT, rockSkin: 0.1 })).toBe(0);
    expect(getTreeChance({ ...MOUNTAIN_FOOT, surfaceSlope: 1.2 })).toBe(0);
    expect(getTreeChance({ ...MOUNTAIN_FOOT, rock: 0.8 })).toBe(0);
  });

  it("thins the forest on hot, exposed slopes (M02b)", () => {
    expect(getTreeChance({ ...INLAND, heatLoad: 0.95 })).toBeLessThan(getTreeChance(INLAND));
    expect(getTreeChance({ ...INLAND, exposure: 0.9 })).toBeLessThan(getTreeChance(INLAND));
  });

  it("thins the forest towards the timberline", () => {
    expect(getTreeChance({ ...MOUNTAIN_FOOT, height: 6.2 })).toBeLessThan(
      getTreeChance(MOUNTAIN_FOOT) * 0.5
    );
  });

  it("starts every generated tree in the mature age band", () => {
    const random = createRandom(5);
    const scales = [
      getTreeScale({ ...INLAND, forest: 0.15 }, PROP.broadleafTree, random),
      getTreeScale({ ...INLAND, forest: 0.95 }, PROP.broadleafTree, random),
      getTreeScale({ ...SANDY_COAST, cluster: -0.3 }, PROP.palmTree, random),
      getTreeScale({ ...SANDY_COAST, cluster: 0.6 }, PROP.palmTree, random),
      getTreeScale({ ...INLAND, forest: 0.5 }, PROP.birchTree, random, 0)
    ];
    expect(scales.every((scale) => getTreeAgeStage(scale) === 5)).toBe(true);
  });
});

describe("beach plants", () => {
  it("grows only sparse dune grass on the sand", () => {
    const random = createRandom(3);
    const kinds = Array.from({ length: 500 }, () => chooseDuneProp(SANDY_COAST, random));
    const grass = kinds.filter((kind) => kind === PROP.sedge).length;
    expect(kinds.every((kind) => kind === PROP.sedge || kind === NONE)).toBe(true);
    expect(grass / kinds.length).toBeGreaterThan(0.02);
    expect(grass / kinds.length).toBeLessThan(0.2);
  });
});

describe("generated island biomes", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, theme: "dirt" });
  const trees = {
    birch: [] as number[],
    broadleaf: [] as number[],
    conifer: [] as number[],
    palm: [] as number[]
  };
  for (let index = 0; index < world.props.count; index += 1) {
    const type = world.props.types[index]!;
    if (type === PROP.palmTree) trees.palm.push(index);
    if (type === PROP.coniferTree) trees.conifer.push(index);
    if (type === PROP.broadleafTree) trees.broadleaf.push(index);
    if (type === PROP.birchTree) trees.birch.push(index);
  }
  const mean = (indices: number[], read: (index: number) => number) =>
    indices.reduce((sum, index) => sum + read(index), 0) / indices.length;
  const coastAt = (index: number) =>
    world.coastDistance[
      Math.round(world.props.z[index]!) * (world.cellsX + 1) + Math.round(world.props.x[index]!)
    ]!;
  const heightAt = (index: number) => world.props.y[index]!;

  // Owner 2026-10-18: new home maps grow ordinary softwood only (pine/palm). The broadleaf and
  // birch bands remain covered by the chooseTreeSpecies site ecology tests above.
  it("orders the softwood from the coast up: palm, then pine", () => {
    expect(trees.palm.length).toBeGreaterThan(10);
    expect(trees.conifer.length).toBeGreaterThan(10);
    expect(mean(trees.palm, coastAt)).toBeLessThan(mean(trees.conifer, coastAt));
    expect(mean(trees.palm, heightAt)).toBeLessThan(mean(trees.conifer, heightAt));
  });

  it("grows no broadleaf or birch on a newly generated home map", () => {
    expect(trees.broadleaf).toHaveLength(0);
    expect(trees.birch).toHaveLength(0);
  });

  it("starts every generated tree fully mature", () => {
    const ids = [...trees.palm, ...trees.conifer, ...trees.broadleaf, ...trees.birch];
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.every((id) => getTreeAgeStage(world.props.scale[id]!) === 5)).toBe(true);
  });
});
