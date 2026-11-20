import { describe, expect, it } from "vitest";

import { getStageAntlerScale } from "../src/render-common/wildlife/model/animal-variants";
import { getSpotMask } from "../src/render-common/wildlife/model/coat-spots";
import { createForestDepth } from "../src/render-common/wildlife/nav/forest-depth";
import {
  ALL_SPECIES_MASK,
  COLLIDER_KIND,
  createColliderSet
} from "../src/render-common/wildlife/nav/nav-colliders";
import {
  isGroundWalkable,
  isReachable,
  isRestSpotValid,
  isSegmentWalkable,
  type NavWorld
} from "../src/render-common/wildlife/nav/nav-query";
import { createNavTerrain } from "../src/render-common/wildlife/nav/nav-terrain";
import { createSpeciesNav } from "../src/render-common/wildlife/nav/species-nav";
import {
  getAntlerScale,
  pickSpawnAge,
  setAnimalAge
} from "../src/render-common/wildlife/sim/animal-age";
import { getAnimalInfo } from "../src/render-common/wildlife/sim/animal-info";
import { createAnimalPool } from "../src/render-common/wildlife/sim/animal-pool";
import {
  SPECIES,
  SPECIES_IDS,
  SPECIES_PROFILES
} from "../src/render-common/wildlife/wildlife-species";
import {
  ANTLER_STAGE,
  getAgeSize,
  getAgeSpeed,
  getHuntValue,
  getLifeStage,
  LIFE_STAGE,
  STAGE_SHAPES
} from "../src/render-common/wildlife/wildlife-stages";
import { createRandom } from "../src/shared/world/rng";

const SIZE = 30;

/** Flat map with a step (cliff) at x = 20 and one rock at (10, 10). */
const createNav = (): NavWorld => {
  const terrain = createNavTerrain({
    cellsX: SIZE,
    cellsZ: SIZE,
    height: (x) => (x < 20 ? 0 : 3),
    isBlockedGround: () => false,
    waterDepth: () => 0
  });
  const colliders = createColliderSet(SIZE, SIZE, [
    { kind: COLLIDER_KIND.rock, mask: ALL_SPECIES_MASK, radius: 0.4, x: 10, z: 10 }
  ]);
  const depth = createForestDepth(terrain, colliders);
  return {
    colliders,
    species: SPECIES_IDS.map((id) =>
      createSpeciesNav(terrain, colliders, SPECIES_PROFILES[id]!, id, depth)
    ),
    terrain
  };
};

describe("life stages", () => {
  it("maps ages to stages in order", () => {
    expect(getLifeStage(0)).toBe(LIFE_STAGE.newborn);
    expect(getLifeStage(0.2)).toBe(LIFE_STAGE.juvenile);
    expect(getLifeStage(0.5)).toBe(LIFE_STAGE.adolescent);
    expect(getLifeStage(0.8)).toBe(LIFE_STAGE.adult);
    expect(getLifeStage(1)).toBe(LIFE_STAGE.mature);
  });

  it("interpolates size continuously and monotonically with age", () => {
    for (const species of SPECIES_IDS) {
      let previous = 0;
      for (let age = 0; age <= 1; age += 0.01) {
        const size = getAgeSize(species, age);
        expect(size).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = size;
      }
      expect(getAgeSize(species, 1)).toBeCloseTo(1);
      expect(getAgeSize(species, 0)).toBeLessThan(0.5);
    }
  });

  it("changes proportions structurally, never only the overall size", () => {
    const fawn = STAGE_SHAPES[SPECIES.deer]![LIFE_STAGE.newborn]!;
    expect(fawn.legs).toBeGreaterThan(1);
    expect(fawn.ears).toBeGreaterThan(1);
    expect(fawn.head[1]).toBeGreaterThan(fawn.body[1]);
  });

  it("slows the young: newborn 0.35-0.5, juvenile 0.6-0.75, adolescent 0.8-0.9, adult 1", () => {
    expect(getAgeSpeed(0)).toBeGreaterThanOrEqual(0.35);
    expect(getAgeSpeed(0)).toBeLessThanOrEqual(0.5);
    expect(getAgeSpeed(0.12)).toBeGreaterThanOrEqual(0.6);
    expect(getAgeSpeed(0.12)).toBeLessThanOrEqual(0.75);
    expect(getAgeSpeed(0.4)).toBeGreaterThanOrEqual(0.8);
    expect(getAgeSpeed(0.4)).toBeLessThanOrEqual(0.9);
    expect(getAgeSpeed(0.8)).toBe(1);
  });

  it("fades the fawn spots: newborn full, juvenile 80 %, adolescent 20-40 %, adult none", () => {
    const shapes = STAGE_SHAPES[SPECIES.deer]!;
    expect(shapes[LIFE_STAGE.newborn]!.spots).toBe(1);
    expect(shapes[LIFE_STAGE.juvenile]!.spots).toBeCloseTo(0.8);
    expect(shapes[LIFE_STAGE.adolescent]!.spots).toBeGreaterThanOrEqual(0.2);
    expect(shapes[LIFE_STAGE.adolescent]!.spots).toBeLessThanOrEqual(0.4);
    expect(shapes[LIFE_STAGE.adult]!.spots).toBe(0);
  });

  it("draws irregular spots: some of the coat spotted, not all", () => {
    let spotted = 0;
    const samples = 2000;
    const random = createRandom(5);
    for (let index = 0; index < samples; index += 1) {
      if (getSpotMask([random(), random(), random()], 0.05) > 0.5) spotted += 1;
    }
    expect(spotted / samples).toBeGreaterThan(0.05);
    expect(spotted / samples).toBeLessThan(0.5);
  });

  it("grows antlers in stages: none, spikes, small branching, the full rack", () => {
    const shapes = STAGE_SHAPES[SPECIES.elk]!;
    expect(shapes.map((shape) => shape.antlers)).toEqual([
      ANTLER_STAGE.none,
      ANTLER_STAGE.none,
      ANTLER_STAGE.spikes,
      ANTLER_STAGE.branching,
      ANTLER_STAGE.full
    ]);
    const scales = [
      ANTLER_STAGE.none,
      ANTLER_STAGE.spikes,
      ANTLER_STAGE.branching,
      ANTLER_STAGE.full
    ].map(getStageAntlerScale);
    expect(scales[0]).toBe(0);
    expect(scales[1]).toBeGreaterThan(0);
    expect(scales[1]!).toBeLessThan(scales[2]!);
    expect(scales[2]!).toBeLessThan(scales[3]!);
    expect(scales[3]).toBe(1);
  });

  it("shows antlers on males from adolescence only", () => {
    const pool = createAnimalPool(2);
    pool.active.fill(1);
    pool.species.fill(SPECIES.elk);
    pool.size.fill(1);
    pool.sex[0] = 1;
    pool.sex[1] = 0;
    setAnimalAge(pool, 0, 0.2);
    expect(getAntlerScale(pool, 0)).toBe(0);
    setAnimalAge(pool, 0, 0.5);
    setAnimalAge(pool, 1, 0.9);
    expect(getAntlerScale(pool, 0)).toBe(1);
    expect(getAntlerScale(pool, 1)).toBe(0);
  });
});

describe("hunting by age", () => {
  it("gives no reason to hunt the young", () => {
    expect(getHuntValue(SPECIES.deer, 0).isHuntable).toBe(false);
    const juvenile = getHuntValue(SPECIES.deer, 0.2).meatYield;
    const adolescent = getHuntValue(SPECIES.deer, 0.5).meatYield;
    const adult = getHuntValue(SPECIES.deer, 0.8).meatYield;
    expect(juvenile).toBeLessThan(adolescent);
    expect(adolescent).toBeLessThan(adult);
  });

  it("exposes the hunter fields of an animal", () => {
    const pool = createAnimalPool(1);
    pool.active[0] = 1;
    pool.species[0] = SPECIES.deer;
    pool.size[0] = 1;
    setAnimalAge(pool, 0, 0.05);
    const info = getAnimalInfo(pool, 0)!;
    expect(info.lifeStage).toBe("newborn");
    expect(info.isHuntable).toBe(false);
    expect(info.species).toBe("deer");
    expect(getAnimalInfo(pool, 3)).toBeNull();
  });
});

describe("respawn", () => {
  it("brings animals back as juveniles", () => {
    const random = createRandom(9);
    for (let index = 0; index < 50; index += 1) {
      expect(getLifeStage(pickSpawnAge(random, false, true))).toBe(LIFE_STAGE.juvenile);
    }
  });
});

describe("rest spots and map edges", () => {
  const nav = createNav();

  it("accepts flat open ground and rejects rocks and cliff lips", () => {
    expect(isRestSpotValid(nav, SPECIES.deer, 5, 15, 0)).toBe(true);
    expect(isRestSpotValid(nav, SPECIES.deer, 10.3, 10, 0)).toBe(false);
    expect(isRestSpotValid(nav, SPECIES.deer, 19.8, 15, 0)).toBe(false);
  });

  it("shrinks the body check with age (a fawn rests where an elk cannot)", () => {
    const nearRock = [10, 10.6] as const;
    expect(isRestSpotValid(nav, SPECIES.elk, nearRock[0], nearRock[1], 0, 1)).toBe(false);
    expect(isRestSpotValid(nav, SPECIES.elk, nearRock[0], nearRock[1], 0, 0.35)).toBe(true);
  });

  it("treats everything beyond the map border as blocked (peninsula edges)", () => {
    expect(isGroundWalkable(nav, SPECIES.rabbit, -0.5, 10)).toBe(false);
    expect(isGroundWalkable(nav, SPECIES.rabbit, 0.5, 10)).toBe(false);
    expect(isGroundWalkable(nav, SPECIES.rabbit, 10, SIZE + 1)).toBe(false);
    expect(isSegmentWalkable(nav, SPECIES.rabbit, 5, 10, -3, 10)).toBe(false);
  });
});

describe("archipelago", () => {
  it("keeps animals on their own island: water splits the nav regions", () => {
    const terrain = createNavTerrain({
      cellsX: SIZE,
      cellsZ: SIZE,
      height: () => 1,
      isBlockedGround: () => false,
      waterDepth: (x) => (x > 13 && x < 17 ? 0.6 : 0)
    });
    const colliders = createColliderSet(SIZE, SIZE, []);
    const depth = createForestDepth(terrain, colliders);
    const nav: NavWorld = {
      colliders,
      species: SPECIES_IDS.map((id) =>
        createSpeciesNav(terrain, colliders, SPECIES_PROFILES[id]!, id, depth)
      ),
      terrain
    };
    for (const species of SPECIES_IDS) {
      expect(isReachable(nav, species, 6, 15, 10, 20)).toBe(true);
      expect(isReachable(nav, species, 6, 15, 24, 15)).toBe(false);
    }
  });
});
