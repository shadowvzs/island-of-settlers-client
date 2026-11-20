import { createRandom, deriveSeed } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import { type BoidContext, pickSchoolTarget, stepSchool } from "./fish-boids";
import { getDriftPhase, getSchoolDepthShare, getSwimHeight, LAYER_REACH, resetDart } from "./fish-depth";
import { createFishHomes, FISH_MIN_DEPTH } from "./fish-school-homes";
import { countFree, createFishPool, createSchoolPool, findFreeSlot } from "./fish-school-pool";
import { FISH_SPECIES, MAX_SCHOOL } from "./fish-species";
import { createFishThreats } from "./fish-threats";
import { createFishWater } from "./fish-water";

/** Which homes are around the camera: a test of a point and the centre homes are ranked from. */
export interface FishFocus {
  centerX: number;
  centerZ: number;
  contains: (x: number, z: number) => boolean;
}

/** Seconds between two choices of the occupied homes. */
const CHOOSE_SECONDS = 0.25;
const FADE_SECONDS = 0.8;
/** Longest simulated step (a hitch or a jump in time is not replayed). */
const MAX_STEP = 0.05;
/** Homes kept in the threat bounds this far beyond their radius (a fleeing school leaves it). */
const BOUNDS_MARGIN = 6;
const SPAWN_SPREAD = 0.9;

/**
 * Decorative fish schools near the camera (render-only, no gameplay effect): fixed homes per world
 * seed, occupied by distance from the focus within a fish budget, faded in and out. Each school
 * swims as boids (cohesion, alignment, separation, a wandering target), keeps to swimmable water,
 * scatters from ships, boats and people (`threats`) and regroups. Tiny fixed-capacity CPU work.
 */
export const createFishSchools = (world: WorldData, capacity: number, winter = false) => {
  const water = createFishWater(world);
  const homes = createFishHomes(water, winter);
  const fish = createFishPool(capacity);
  const schools = createSchoolPool(Math.max(1, Math.ceil(capacity / 2)));
  const threats = createFishThreats();
  const random = createRandom(deriveSeed(world.seed, "fish-life"));
  const context: BoidContext = { fish, homes, random, schools, threats, time: 0, water };
  const homeSchool = new Int32Array(homes.length).fill(-1);
  const candidates = new Int32Array(homes.length);
  const distances = new Float32Array(homes.length);
  const wanted = new Uint8Array(homes.length);
  let lastTime = -1;
  let chooseTimer = 0;

  const spawnFish = (school: number, member: number) => {
    const home = homes[schools.home[school]!]!;
    const index = findFreeSlot(fish.active);
    const angle = random() * Math.PI * 2, spread = Math.sqrt(random()) * SPAWN_SPREAD;
    const x = home.x + Math.cos(angle) * spread, z = home.z + Math.sin(angle) * spread;
    const swimmable = water.depth(x, z) >= FISH_MIN_DEPTH;
    const heading = random() * Math.PI * 2;
    const species = FISH_SPECIES[home.species]!;
    fish.active[index] = 1;
    fish.appear[index] = 0;
    fish.depthShare[index] = (random() * 2 - 1) * LAYER_REACH;
    fish.heading[index] = heading;
    fish.phase[index] = random() * Math.PI * 2;
    fish.pitch[index] = 0;
    fish.scale[index] = 0.88 + random() * 0.24;
    fish.school[index] = school;
    fish.shade[index] = 0.9 + random() * 0.2;
    fish.species[index] = home.species;
    fish.vx[index] = Math.cos(heading) * species.cruise;
    fish.vz[index] = Math.sin(heading) * species.cruise;
    fish.wagAmplitude[index] = 0.05;
    fish.x[index] = swimmable ? x : home.x;
    fish.z[index] = swimmable ? z : home.z;
    resetDart(fish, index, random);
    fish.y[index] = getSwimHeight(water, fish, index,
      getSchoolDepthShare(schools.driftPhase[school]!, context.time));
    schools.members[school * MAX_SCHOOL + member] = index;
  };

  const occupy = (homeIndex: number) => {
    const school = findFreeSlot(schools.active);
    const home = homes[homeIndex]!;
    if (school < 0 || countFree(fish.active) < home.count) return;
    schools.active[school] = 1;
    schools.alarm[school] = 0;
    schools.driftPhase[school] = getDriftPhase(home.x, home.z);
    schools.home[school] = homeIndex;
    schools.leaving[school] = 0;
    schools.memberCount[school] = home.count;
    for (let member = 0; member < home.count; member += 1) spawnFish(school, member);
    pickSchoolTarget(context, school);
    homeSchool[homeIndex] = school;
  };

  const release = (school: number) => {
    for (let member = 0; member < schools.memberCount[school]!; member += 1) {
      const index = schools.members[school * MAX_SCHOOL + member]!;
      fish.active[index] = 0;
      fish.school[index] = -1;
    }
    homeSchool[schools.home[school]!] = -1;
    schools.active[school] = 0;
    schools.memberCount[school] = 0;
  };

  /** A new school arrives only where the player sees (fog) and the water is still deep enough. */
  const canSettle = (homeIndex: number) => {
    const { x, z } = homes[homeIndex]!;
    return water.fog(x, z) >= 1 && water.depth(x, z) >= FISH_MIN_DEPTH + 0.1;
  };

  /** Homes in focus, nearest first (insertion sort: a few dozen at most). */
  const rankCandidates = (focus: FishFocus) => {
    let count = 0;
    for (let home = 0; home < homes.length; home += 1) {
      const { x, z } = homes[home]!;
      if (!focus.contains(x, z)) continue;
      const distance = Math.hypot(x - focus.centerX, z - focus.centerZ);
      let slot = count;
      while (slot > 0 && distances[slot - 1]! > distance) {
        distances[slot] = distances[slot - 1]!;
        candidates[slot] = candidates[slot - 1]!;
        slot -= 1;
      }
      distances[slot] = distance;
      candidates[slot] = home;
      count += 1;
    }
    return count;
  };

  /** The nearest homes in focus within the budget stay or arrive; the others leave. */
  const choose = (focus: FishFocus) => {
    const count = rankCandidates(focus);
    let budget = capacity;
    for (let rank = 0; rank < count; rank += 1) {
      const homeIndex = candidates[rank]!;
      const home = homes[homeIndex]!;
      if (home.count > budget) continue;
      const occupied = homeSchool[homeIndex]! >= 0;
      if (!occupied && !canSettle(homeIndex)) continue;
      budget -= home.count;
      wanted[homeIndex] = 1;
    }
    for (let school = 0; school < schools.capacity; school += 1) {
      if (schools.active[school] === 0) continue;
      schools.leaving[school] = wanted[schools.home[school]!] === 1 ? 0 : 1;
    }
    for (let rank = 0; rank < count; rank += 1) {
      const homeIndex = candidates[rank]!;
      if (wanted[homeIndex] === 1 && homeSchool[homeIndex]! < 0) occupy(homeIndex);
      wanted[homeIndex] = 0;
    }
  };

  /** Fades the members in (or out while leaving); a faded out school is freed. */
  const fadeSchool = (school: number, dt: number) => {
    const change = (schools.leaving[school] === 1 ? -dt : dt) / FADE_SECONDS;
    let shown = 0;
    for (let member = 0; member < schools.memberCount[school]!; member += 1) {
      const index = schools.members[school * MAX_SCHOOL + member]!;
      fish.appear[index] = Math.min(1, Math.max(0, fish.appear[index]! + change));
      shown = Math.max(shown, fish.appear[index]!);
    }
    if (shown <= 0 && schools.leaving[school] === 1) release(school);
  };

  /** Starts a frame's threats: the bounds of the active schools (call before `addThreat`). */
  const beginThreats = () => {
    threats.clear();
    for (let school = 0; school < schools.capacity; school += 1) {
      if (schools.active[school] === 0) continue;
      const home = homes[schools.home[school]!]!;
      threats.include(home.x, home.z, home.radius + BOUNDS_MARGIN);
    }
  };

  /** Advances to `time` (seconds; a pause or a jump back holds the fish) around `focus`. */
  const update = (time: number, focus: FishFocus) => {
    const dt = lastTime < 0 ? 0 : Math.min(MAX_STEP, Math.max(0, time - lastTime));
    lastTime = time;
    context.time = time;
    chooseTimer -= dt;
    if (chooseTimer <= 0) {
      chooseTimer = CHOOSE_SECONDS;
      choose(focus);
    }
    if (dt <= 0) return;
    for (let school = 0; school < schools.capacity; school += 1) {
      if (schools.active[school] === 0) continue;
      stepSchool(context, school, dt);
      fadeSchool(school, dt);
    }
  };

  /** Releases every school at once (the decorative setting switched off). */
  const clear = () => {
    for (let school = 0; school < schools.capacity; school += 1) if (schools.active[school]) release(school);
    chooseTimer = 0;
  };

  return {
    addThreat: threats.add,
    beginThreats,
    clear,
    fish,
    homes,
    schools,
    update,
    water
  };
};

export type FishSchools = ReturnType<typeof createFishSchools>;
