import { describe, expect, it } from "vitest";

import { getFishExtent } from "../src/render-common/fish-schools/fish-depth";
import { createFishHomes, FISH_MIN_DEPTH } from "../src/render-common/fish-schools/fish-school-homes";
import { MAX_SCHOOL } from "../src/render-common/fish-schools/fish-species";
import { createFishSchools, type FishFocus } from "../src/render-common/fish-schools/fish-school-sim";
import { createFishWater } from "../src/render-common/fish-schools/fish-water";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createCritterWorld } from "./critter-test-world";

const STEP = 1 / 30;

const focusOn = (x: number, z: number, reach = 12): FishFocus => ({
  centerX: x,
  centerZ: z,
  contains: (atX, atZ) => Math.hypot(atX - x, atZ - z) <= reach
});

const run = (schools: ReturnType<typeof createFishSchools>, focus: FishFocus, from: number, seconds: number,
  threat?: { x: number; z: number }) => {
  let time = from;
  for (let step = 0; step < seconds * 30; step += 1) {
    time += STEP;
    schools.beginThreats();
    if (threat) schools.addThreat(threat.x, threat.z, 2.4);
    schools.update(time, focus);
  }
  return time;
};

const activeFish = (schools: ReturnType<typeof createFishSchools>) =>
  Array.from(schools.fish.active.keys()).filter((index) => schools.fish.active[index] === 1);

describe("fish schools", () => {
  const world = createCritterWorld();

  it("finds the same shallow homes for the same seed, only reef-free silversides on snowy islands", () => {
    const water = createFishWater(world);
    const homes = createFishHomes(water, false);
    expect(homes.length).toBeGreaterThan(0);
    expect(createFishHomes(water, false)).toEqual(homes);
    for (const home of homes) expect(water.depth(home.x, home.z)).toBeGreaterThanOrEqual(0.45);
    expect(createFishHomes(water, true).every((home) => home.species === 0)).toBe(true);
  });

  it("keeps within the budget, in swimmable water, and swims along", () => {
    const schools = createFishSchools(world, 40);
    const home = schools.homes[0]!;
    const focus = focusOn(home.x, home.z, 40);
    run(schools, focus, 0, 20);
    const fish = activeFish(schools);
    expect(fish.length).toBeGreaterThan(0);
    expect(fish.length).toBeLessThanOrEqual(40);
    for (const index of fish) {
      const { x, z } = { x: schools.fish.x[index]!, z: schools.fish.z[index]! };
      expect(schools.water.depth(x, z)).toBeGreaterThan(FISH_MIN_DEPTH * 0.8);
      expect(schools.fish.y[index]!).toBeLessThan(schools.water.surface(x, z));
    }
  });

  it("scatters from a threat, then regroups", () => {
    const schools = createFishSchools(world, 40);
    const home = schools.homes.find((item) => item.count >= 6) ?? schools.homes[0]!;
    const focus = focusOn(home.x, home.z, 3);
    let time = run(schools, focus, 0, 6);
    const school = schools.schools.home.indexOf(schools.homes.indexOf(home));
    expect(school).toBeGreaterThanOrEqual(0);
    const centre = { x: schools.schools.centerX[school]!, z: schools.schools.centerZ[school]! };
    time = run(schools, focus, time, 0.5, centre);
    expect(schools.schools.alarm[school]!).toBeGreaterThan(0);
    time = run(schools, focus, time, 1, centre);
    const members = Array.from({ length: schools.schools.memberCount[school]! },
      (_, member) => schools.schools.members[school * MAX_SCHOOL + member]!);
    const nearest = Math.min(...members.map((index) =>
      Math.hypot(schools.fish.x[index]! - centre.x, schools.fish.z[index]! - centre.z)));
    expect(nearest).toBeGreaterThan(0.5);
    run(schools, focus, time, 8);
    expect(schools.schools.alarm[school]!).toBe(0);
    const spread = Math.max(...members.map((index) => Math.hypot(
      schools.fish.x[index]! - schools.schools.centerX[school]!, schools.fish.z[index]! - schools.schools.centerZ[school]!)));
    expect(spread).toBeLessThan(2.5);
  });

  it("swims at varied depths without clipping through the surface or the seabed", () => {
    const schools = createFishSchools(world, 60);
    const home = schools.homes.reduce((best, item) =>
      (schools.water.depth(item.x, item.z) > schools.water.depth(best.x, best.z) ? item : best));
    const focus = focusOn(home.x, home.z, 30);
    let time = run(schools, focus, 0, 2);
    const shares: number[] = [];
    for (let sample = 0; sample < 40; sample += 1) {
      time = run(schools, focus, time, 1.5);
      for (const index of activeFish(schools)) {
        const x = schools.fish.x[index]!, y = schools.fish.y[index]!, z = schools.fish.z[index]!;
        const surface = schools.water.surface(x, z), ground = schools.water.ground(x, z);
        const extent = getFishExtent(schools.fish, index);
        if (surface - ground > 2 * extent + 0.2) {
          expect(y + extent).toBeLessThanOrEqual(surface - 0.1);
          expect(y - extent).toBeGreaterThanOrEqual(ground + 0.05);
        }
        expect(y).toBeLessThan(surface);
        expect(y).toBeGreaterThan(ground);
        shares.push((surface - y) / Math.max(1e-3, surface - ground));
      }
    }
    expect(Math.max(...shares) - Math.min(...shares)).toBeGreaterThan(0.3);
  });

  it("builds no fish where the preset has no refraction (Minimal)", () => {
    expect(QUALITY_PRESETS.minimal.refraction).toBe(false);
    expect(QUALITY_PRESETS.minimal.fishSchools).toBe(0);
    expect(QUALITY_PRESETS.high.fishSchools).toBeGreaterThan(0);
  });
});
