import { describe, expect, it } from "vitest";

import { TICK_SECONDS } from "../../island-of-settlers-shared/src/time/constants";
import { createViewRegion } from "../src/render-common/birds/bird-view";
import { getCrownRadius } from "../src/render-common/wildlife/nav/crown-profile";
import { createForestDepth } from "../src/render-common/wildlife/nav/forest-depth";
import {
  ALL_SPECIES_MASK,
  COLLIDER_KIND,
  type ColliderInput,
  createColliderSet,
  getSegmentDistanceSquared} from "../src/render-common/wildlife/nav/nav-colliders";
import { createPathFinder, MAX_PATH_POINTS } from "../src/render-common/wildlife/nav/nav-path";
import {
  isBodyFree,
  isGroundWalkable,
  isReachable,
  isSegmentWalkable,
  isStandFree,
  type NavWorld
} from "../src/render-common/wildlife/nav/nav-query";
import {
  getSeparation,
  steerHeading,
  turnSmoothly,
  turnTowards,
  wrapAngle
} from "../src/render-common/wildlife/nav/nav-steering";
import { createNavTerrain } from "../src/render-common/wildlife/nav/nav-terrain";
import { createSpeciesNav } from "../src/render-common/wildlife/nav/species-nav";
import { turnToFit } from "../src/render-common/wildlife/sim/animal-age";
import { stepRest } from "../src/render-common/wildlife/sim/animal-animation";
import { think } from "../src/render-common/wildlife/sim/animal-brain";
import { stepAnimal } from "../src/render-common/wildlife/sim/animal-locomotion";
import { createAnimalPool, createMotionPool } from "../src/render-common/wildlife/sim/animal-pool";
import { initAnimal } from "../src/render-common/wildlife/sim/animal-spawn";
import {
  type WildlifeContext
} from "../src/render-common/wildlife/sim/wildlife-context";
import {
  SPECIES,
  SPECIES_IDS,
  SPECIES_PROFILES
} from "../src/render-common/wildlife/wildlife-species";
import { auditRandom } from "../src/shared/settlement/simulation-random";
import { createRandom, createStatefulRandom } from "../src/shared/world/rng";
import type { WorldData } from "../src/shared/world/world-data";

const SIZE = 40;
/** Flat ground at height 1, a 3 unit cliff from x = 30, a lake below z = 5. */
const groundHeight = (x: number) => (x < 30 ? 1 : 4);

/** Trunks on a jittered grid (forest block), with per species crown rings like oaks. */
const createForest = (spacing: number, crowns: number[]) => {
  const random = createRandom(7);
  const colliders: ColliderInput[] = [];
  for (let z = 10; z < 30; z += spacing) {
    for (let x = 8; x < 24; x += spacing) {
      const tx = x + (random() - 0.5) * spacing * 0.3;
      const tz = z + (random() - 0.5) * spacing * 0.3;
      colliders.push({
        kind: COLLIDER_KIND.trunk,
        mask: ALL_SPECIES_MASK,
        radius: 0.12,
        x: tx,
        z: tz
      });
      crowns.forEach((radius, species) => {
        if (radius > 0.12) {
          colliders.push({ kind: COLLIDER_KIND.crown, mask: 1 << species, radius, x: tx, z: tz });
        }
      });
    }
  }
  return colliders;
};

const createTestNav = (colliders: ColliderInput[]): NavWorld => {
  const terrain = createNavTerrain({
    cellsX: SIZE,
    cellsZ: SIZE,
    height: (x) => groundHeight(x),
    isBlockedGround: () => false,
    waterDepth: (_x, z) => (z < 5 ? 0.5 : 0)
  });
  const set = createColliderSet(SIZE, SIZE, colliders);
  const forestDepth = createForestDepth(terrain, set);
  return {
    colliders: set,
    species: SPECIES_IDS.map((id) =>
      createSpeciesNav(terrain, set, SPECIES_PROFILES[id]!, id, forestDepth)
    ),
    terrain
  };
};

const emptyNav = createTestNav([]);

describe("wildlife nav validation", () => {
  it("accepts flat open ground and rejects water and cliffs", () => {
    expect(isSegmentWalkable(emptyNav, SPECIES.deer, 10, 8, 20, 8)).toBe(true);
    expect(isSegmentWalkable(emptyNav, SPECIES.deer, 10, 8, 10, 3)).toBe(false);
    expect(isSegmentWalkable(emptyNav, SPECIES.deer, 25, 8, 35, 8)).toBe(false);
    expect(isStandFree(emptyNav, SPECIES.rabbit, 10, 3)).toBe(false);
  });

  it("splits the map at the cliff into regions that do not reach each other", () => {
    expect(isReachable(emptyNav, SPECIES.elk, 10, 20, 20, 20)).toBe(true);
    expect(isReachable(emptyNav, SPECIES.elk, 10, 20, 35, 20)).toBe(false);
  });

  it("blocks a segment through a trunk but not one passing beside it", () => {
    const nav = createTestNav([
      { kind: COLLIDER_KIND.trunk, mask: ALL_SPECIES_MASK, radius: 0.12, x: 15, z: 15 }
    ]);
    expect(isSegmentWalkable(nav, SPECIES.deer, 12, 15, 18, 15)).toBe(false);
    expect(isSegmentWalkable(nav, SPECIES.deer, 12, 16.5, 18, 16.5)).toBe(true);
  });

  it("checks the whole body: the nose may not reach into a trunk the centre clears", () => {
    const nav = createTestNav([
      { kind: COLLIDER_KIND.trunk, mask: ALL_SPECIES_MASK, radius: 0.12, x: 16, z: 15 }
    ]);
    expect(isBodyFree(nav, SPECIES.elk, 15, 15, Math.PI)).toBe(true);
    expect(isBodyFree(nav, SPECIES.elk, 15, 15, 0)).toBe(false);
  });

  it("lets elk into a forest's margin only, deer and rabbits deeper", () => {
    const nav = createTestNav(createForest(2, [0, 0, 0]));
    const core = { x: 16, z: 20 };
    expect(isGroundWalkable(nav, SPECIES.elk, core.x, core.z)).toBe(false);
    expect(isGroundWalkable(nav, SPECIES.deer, core.x, core.z)).toBe(true);
    expect(isGroundWalkable(nav, SPECIES.rabbit, core.x, core.z)).toBe(true);
    expect(isGroundWalkable(nav, SPECIES.elk, 7.5, 20)).toBe(true);
  });

  it("measures the crown ring an animal of a given height must keep clear", () => {
    const profile = Float32Array.from([0, 0.2, 0.4, 0.6, 0.8, 1, Infinity, Infinity]);
    expect(getCrownRadius(profile, 0.5)).toBeCloseTo(0.3);
    expect(getCrownRadius(profile, 1.2)).toBeCloseTo(0.6);
  });
});

describe("wildlife steering", () => {
  it("eases the end of a turn without exceeding angular speed or crossing the target", () => {
    let heading = 3;
    let previousStep = Infinity;
    for (let step = 0; step < 80; step++) {
      const next = turnSmoothly(heading, -3, 2.4, TICK_SECONDS);
      const delta = Math.abs(wrapAngle(next - heading));
      expect(delta).toBeLessThanOrEqual(2.4 * TICK_SECONDS + 1e-10);
      expect(delta).toBeLessThanOrEqual(previousStep + 1e-10);
      expect(wrapAngle(-3 - next)).toBeGreaterThanOrEqual(-1e-10);
      previousStep = delta;
      heading = next;
    }
    expect(Math.abs(wrapAngle(-3 - heading))).toBeLessThan(1e-5);
  });
  it("turns towards the target the shorter way, limited per step", () => {
    expect(turnTowards(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnTowards(3, -3, 0.1)).toBeCloseTo(wrapAngle(3.1));
  });

  it("steers around a trunk straight ahead and keeps the probe walkable", () => {
    const nav = createTestNav([
      { kind: COLLIDER_KIND.trunk, mask: ALL_SPECIES_MASK, radius: 0.15, x: 16, z: 15 }
    ]);
    const heading = steerHeading(nav, SPECIES.deer, 15, 15, 0, 0, 1.2);
    expect(Number.isNaN(heading)).toBe(false);
    expect(Math.abs(heading)).toBeGreaterThan(0.2);
    const endX = 15 + Math.cos(heading) * 1.2;
    const endZ = 15 + Math.sin(heading) * 1.2;
    expect(isSegmentWalkable(nav, SPECIES.deer, 15, 15, endX, endZ)).toBe(true);
  });

  it("reports a boxed in animal (every probe blocked)", () => {
    const ring: ColliderInput[] = Array.from({ length: 12 }, (_, index) => ({
      kind: COLLIDER_KIND.rock,
      mask: ALL_SPECIES_MASK,
      radius: 0.3,
      x: 15 + Math.cos((index / 12) * Math.PI * 2) * 0.9,
      z: 15 + Math.sin((index / 12) * Math.PI * 2) * 0.9
    }));
    expect(Number.isNaN(steerHeading(createTestNav(ring), SPECIES.deer, 15, 15, 0, 0, 1))).toBe(
      true
    );
  });

  it("pushes close herd mates apart", () => {
    const others = {
      active: Uint8Array.from([1, 1]),
      x: Float32Array.from([10, 10.3]),
      z: Float32Array.from([10, 10])
    };
    expect(getSeparation(10, 10, 0, others, 2, 1).x).toBeLessThan(0);
  });

  it("finds a path around a wall and string pulls it to few waypoints", () => {
    const wall: ColliderInput[] = Array.from({ length: 16 }, (_, index) => ({
      kind: COLLIDER_KIND.rock,
      mask: ALL_SPECIES_MASK,
      radius: 0.4,
      x: 15,
      z: 8 + index * 0.6
    }));
    const nav = createTestNav(wall);
    const out = new Float32Array(MAX_PATH_POINTS * 2);
    const count = createPathFinder(nav).findPath(SPECIES.deer, 10, 12, 20, 12, out);
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(MAX_PATH_POINTS);
    let x = 10;
    let z = 12;
    for (let point = 0; point < count; point += 1) {
      expect(isSegmentWalkable(nav, SPECIES.deer, x, z, out[point * 2]!, out[point * 2 + 1]!)).toBe(
        true
      );
      x = out[point * 2]!;
      z = out[point * 2 + 1]!;
    }
  });
});

/** A flat stub world for the simulation (ground height only). */
const createStubWorld = (): WorldData =>
  ({
    cellsX: SIZE,
    cellsZ: SIZE,
    heights: new Float32Array((SIZE + 1) * (SIZE + 1)).fill(1)
  }) as WorldData;

const createContext = (nav: NavWorld, capacity: number): WildlifeContext => ({
  field: {
    cellsX: SIZE,
    cellsZ: SIZE,
    peaks: SPECIES_IDS.map(() => 1),
    weights: SPECIES_IDS.map(() => new Float32Array(SIZE * SIZE).fill(1))
  },
  finder: createPathFinder(nav),
  motion: createMotionPool(capacity),
  nav,
  pathBudget: 3,
  pool: createAnimalPool(capacity),
  random: auditRandom("wildlife", createStatefulRandom(3)),
  region: createViewRegion(),
  tick: 0,
  time: 0,
  visualRandom: createRandom(4),
  world: createStubWorld()
});

/** Gap between an animal's body capsule and the nearest trunk or crown ring it may not enter. */
const getTreeGap = (
  nav: NavWorld,
  species: number,
  x: number,
  z: number,
  heading: number,
  size: number
) => {
  const speciesNav = nav.species[species]!;
  const back = speciesNav.back * size;
  const front = speciesNav.front * size;
  const clearance = speciesNav.clearance * size;
  const { bit } = speciesNav;
  const { colliders } = nav;
  const noseX = x + Math.cos(heading) * front;
  const noseZ = z + Math.sin(heading) * front;
  const rumpX = x - Math.cos(heading) * back;
  const rumpZ = z - Math.sin(heading) * back;
  let gap = Infinity;
  for (let index = 0; index < colliders.count; index += 1) {
    if ((colliders.mask[index]! & bit) === 0) continue;
    const distance = Math.sqrt(
      getSegmentDistanceSquared(
        colliders.x[index]!,
        colliders.z[index]!,
        rumpX,
        rumpZ,
        noseX,
        noseZ
      )
    );
    gap = Math.min(gap, distance - colliders.radius[index]! - clearance);
  }
  return gap;
};

describe("wildlife in a dense forest", () => {
  it.each(SPECIES_IDS)(
    "never lets species %i overlap a trunk or crown while wandering",
    (species) => {
      const profile = SPECIES_PROFILES[species]!;
      const crowns = SPECIES_PROFILES.map((other) => (other.body.height > 0.5 ? 0.7 : 0.3));
      const nav = createTestNav(createForest(1.15, crowns));
      const context = createContext(nav, 6);
      let placed = 0;
      for (let z = 6; z < 34 && placed < 6; z += 1.7) {
        for (let x = 2; x < 28 && placed < 6; x += 2.3) {
          if (!isStandFree(nav, species, x, z)) continue;
          context.pool.x[placed] = x;
          context.pool.z[placed] = z;
          const home = { centreX: 16, centreZ: 20, range: 12 };
          const age = [0.05, 0.5, 1][placed % 3]!;
          initAnimal(context, placed, species, placed, home, { age, birth: placed + 1, forest: 0.5, sex: 1 });
          if (!turnToFit(context, placed)) continue;
          placed += 1;
        }
      }
      expect(placed).toBeGreaterThan(0);
      let moved = 0;
      for (let step = 0; step < 2400; step += 1) {
        for (let animal = 0; animal < placed; animal += 1) {
          const { pool } = context;
          if (step % 3 === 0) think(context, animal, TICK_SECONDS * 3);
          const before = pool.x[animal]!;
          const headingBefore = pool.heading[animal]!;
          stepAnimal(context, animal, TICK_SECONDS);
          stepRest(context, animal, TICK_SECONDS);
          expect(Math.abs(wrapAngle(pool.heading[animal]! - headingBefore))).toBeLessThanOrEqual(
            profile.turnRate * TICK_SECONDS + 1e-6
          );
          const speed = Math.hypot(pool.velocityX[animal]!, pool.velocityZ[animal]!);
          if (speed > 0.01) {
            const course = Math.atan2(pool.velocityZ[animal]!, pool.velocityX[animal]!);
            expect(Math.abs(wrapAngle(course - pool.heading[animal]!))).toBeLessThan(0.002);
          }
          moved += Math.abs(pool.x[animal]! - before) > 0 ? 1 : 0;
          const { bodyScale, heading, x, z } = pool;
          const size = bodyScale[animal]!;
          const gap = getTreeGap(nav, species, x[animal]!, z[animal]!, heading[animal]!, size);
          expect(gap).toBeGreaterThanOrEqual(-1e-4);
          expect(isBodyFree(nav, species, x[animal]!, z[animal]!, heading[animal]!, size)).toBe(
            true
          );
        }
        context.pathBudget = 3;
      }
      expect(moved).toBeGreaterThan(0);
      expect(profile.clearance).toBeGreaterThan(0);
    }
  );
});
