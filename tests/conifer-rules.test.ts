import { describe, expect, it } from "vitest";

import {
  chooseConiferForm,
  getArchetypeWeights,
  getCompetition,
  getConiferFacing
} from "../src/shared/world/generation/conifer-rules";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getThemeParameters } from "../src/shared/world/generation/island-themes";
import type { PropSample } from "../src/shared/world/generation/prop-rules";
import { createRandom } from "../src/shared/world/rng";
import {
  COMPETITION,
  CONIFER,
  encodeTreeForm,
  getFormArchetype,
  getFormCompetition
} from "../src/shared/world/tree-forms";
import { PROP, type PropSet } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/** A conifer spot at the mountain foot, inside the closed forest. */
const FOREST: PropSample = {
  cluster: 0,
  coast: 20,
  curvature: 0,
  depth: 0,
  exposure: 0,
  forest: 1,
  forestSlopeX: 0,
  forestSlopeZ: 0,
  grain: 0,
  grove: 0,
  heatLoad: 0.5,
  height: 3.6,
  moisture: 0.5,
  mountainDistance: 7,
  patches: -0.3,
  plateau: 0,
  riverDistance: 20,
  rock: 0,
  rockSkin: 0,
  sand: 0,
  seaDistance: 40,
  slope: 0.3,
  species: 0,
  stand: 0,
  surfaceSlope: 0.3,
  trunkDistance: 2,
  vegetation: getThemeParameters("meadow").vegetation
};

const WARM = getThemeParameters("desert").vegetation;

/**
 * Stands cluster: over several islands, the conifers whose nearest conifer has the same
 * archetype beat what random mixing of each island's own archetype mix would give, by this many
 * standard deviations (one sided 95 %). Pooled: one island keeps only 40-150 conifers, so its
 * own share swings by +-20 % with the layout.
 */
const CLUSTER_Z_SCORE = 1.65;
const CLUSTER_SEEDS = [1234, 42, 99];

const collectConifers = (props: PropSet) => {
  const conifers: number[] = [];
  for (let index = 0; index < props.count; index += 1) {
    if (props.types[index] === PROP.coniferTree) conifers.push(index);
  }
  return conifers;
};

const findNearest = (props: PropSet, candidates: number[], index: number) => {
  let nearest = index;
  let best = Infinity;
  for (const other of candidates) {
    const distance = Math.hypot(
      props.x[other]! - props.x[index]!,
      props.z[other]! - props.z[index]!
    );
    if (other === index || distance >= best) continue;
    best = distance;
    nearest = other;
  }
  return nearest;
};

/** Chance that two random trees of this archetype mix share an archetype (sum of shares²). */
const getRandomMixShare = (archetypes: number[]) => {
  const counts = new Map<number, number>();
  for (const archetype of archetypes) counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => sum + (count / archetypes.length) ** 2, 0);
};

const shareOf = (sample: PropSample, archetype: number, trials = 600) => {
  const random = createRandom(5);
  let count = 0;
  for (let index = 0; index < trials; index += 1) {
    if (getFormArchetype(chooseConiferForm(sample, random)) === archetype) count += 1;
  }
  return count / trials;
};

const weightOf = (sample: PropSample, archetype: number) =>
  getArchetypeWeights(sample, getCompetition(sample)).find(([kind]) => kind === archetype)![1];

describe("conifer competition forms", () => {
  it("puts more mountain pine on exposed high slopes and keeps spruce in hollows (M02b)", () => {
    const high = { ...FOREST, height: 4.2 };
    expect(weightOf({ ...high, exposure: 0.9 }, CONIFER.mountain)).toBeGreaterThan(
      weightOf({ ...high, exposure: 0 }, CONIFER.mountain));
    expect(weightOf({ ...FOREST, curvature: 0.8 }, CONIFER.spruce)).toBeGreaterThan(
      weightOf({ ...FOREST, curvature: -0.8 }, CONIFER.spruce));
    expect(weightOf({ ...FOREST, heatLoad: 0.9 }, CONIFER.spruce)).toBeLessThan(
      weightOf({ ...FOREST, heatLoad: 0.1 }, CONIFER.spruce));
  });
  it("read the stand from the forest mask: interior, edge, open", () => {
    expect(getCompetition(FOREST)).toBe(COMPETITION.interior);
    expect(getCompetition({ ...FOREST, forest: 0.7, forestSlopeX: 0.3 })).toBe(COMPETITION.edge);
    expect(getCompetition({ ...FOREST, forest: 0.3 })).toBe(COMPETITION.open);
    expect(getCompetition({ ...FOREST, patches: 0.7 })).toBe(COMPETITION.open);
  });

  it("turn an edge tree's heavy (+x) side down the forest mask, to the open land", () => {
    const edge = encodeTreeForm(CONIFER.spruce, COMPETITION.edge);
    const rotation = getConiferFacing({ ...FOREST, forestSlopeX: 0.3, forestSlopeZ: 0 }, edge)!;
    expect(Math.cos(rotation)).toBeCloseTo(-1);
    const towardsZ = getConiferFacing({ ...FOREST, forestSlopeZ: -0.3 }, edge)!;
    expect(-Math.sin(towardsZ)).toBeCloseTo(1);
    expect(
      getConiferFacing(FOREST, encodeTreeForm(CONIFER.spruce, COMPETITION.open))
    ).toBeUndefined();
  });
});

describe("conifer archetype placement", () => {
  it("puts mountain pine on ridges and high ground", () => {
    expect(shareOf({ ...FOREST, mountainDistance: 1 }, CONIFER.mountain)).toBeGreaterThan(0.6);
    expect(shareOf({ ...FOREST, height: 6 }, CONIFER.mountain)).toBeGreaterThan(0.6);
    expect(shareOf(FOREST, CONIFER.mountain)).toBeLessThan(0.15);
  });

  it("clusters spruce and tall forest pine by the stand noise", () => {
    expect(shareOf({ ...FOREST, stand: 0.8 }, CONIFER.spruce)).toBeGreaterThan(0.55);
    const pines = { ...FOREST, forest: 0.4, stand: -0.8 };
    expect(shareOf(pines, CONIFER.lodgepole)).toBeGreaterThan(0.55);
  });

  it("gives open ground near the rock to the mountain pine, not the tall forest pine", () => {
    const nearRock = { ...FOREST, forest: 0.4, mountainDistance: 4, stand: -0.8 };
    expect(shareOf(nearRock, CONIFER.mountain)).toBeGreaterThan(0.4);
    expect(shareOf(nearRock, CONIFER.mountain)).toBeGreaterThan(
      shareOf({ ...nearRock, mountainDistance: 20 }, CONIFER.mountain) * 3
    );
  });

  it("keeps cool spruce stands out of warm themes: the pines take the coast", () => {
    const coast = { ...FOREST, forest: 0.4, seaDistance: 5, stand: 0.8 };
    expect(weightOf({ ...coast, vegetation: WARM }, CONIFER.spruce)).toBe(0);
    expect(shareOf({ ...coast, vegetation: WARM }, CONIFER.lodgepole)).toBeGreaterThan(0.5);
  });

  const islands = new Map<number, PropSet>();
  const getIslandProps = (seed: number) => {
    const cached = islands.get(seed);
    if (cached) return cached;
    const { props } = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, seed });
    islands.set(seed, props);
    return props;
  };

  it.each(CLUSTER_SEEDS)(
    "forms mixed conifer forests of every archetype and competition (seed %i)",
    (seed) => {
      const props = getIslandProps(seed);
      const conifers = collectConifers(props);
      const competitions = new Set(conifers.map((index) => getFormCompetition(props.form[index]!)));
      const archetypes = new Set(conifers.map((index) => getFormArchetype(props.form[index]!)));
      // The gravel band at the massif rock (owner rule) keeps trees off the rock foot.
      expect(conifers.length).toBeGreaterThan(35);
      expect(archetypes.size).toBe(3);
      expect(competitions.size).toBe(3);
    },
    60_000
  );

  it("clusters the stands beyond random mixing (pooled over the islands)", () => {
    let same = 0;
    let expected = 0;
    let variance = 0;
    for (const seed of CLUSTER_SEEDS) {
      const props = getIslandProps(seed);
      const conifers = collectConifers(props);
      const archetypeOf = (index: number) => getFormArchetype(props.form[index]!);
      const randomShare = getRandomMixShare(conifers.map(archetypeOf));
      same += conifers.filter(
        (index) => archetypeOf(findNearest(props, conifers, index)) === archetypeOf(index)
      ).length;
      expected += conifers.length * randomShare;
      variance += conifers.length * randomShare * (1 - randomShare);
    }
    expect((same - expected) / Math.sqrt(variance)).toBeGreaterThan(CLUSTER_Z_SCORE);
  }, 60_000);
});
