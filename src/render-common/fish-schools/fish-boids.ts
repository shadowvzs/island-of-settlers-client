import type { Random } from "../../shared/world/rng";
import { clampSwimHeight, getFishExtent, getSchoolDepthShare, getSwimHeight, updateDart } from "./fish-depth";
import { FISH_MIN_DEPTH, type FishHome } from "./fish-school-homes";
import { type FishPool, measureSchool, type SchoolPool } from "./fish-school-pool";
import { FISH_SPECIES, MAX_SCHOOL } from "./fish-species";
import type { FishThreats } from "./fish-threats";
import type { FishWater } from "./fish-water";

export interface BoidContext {
  fish: FishPool;
  homes: readonly FishHome[];
  random: Random;
  schools: SchoolPool;
  threats: FishThreats;
  /** Presentation time (seconds): the schools' depth drift. */
  time: number;
  water: FishWater;
}

/** Steering weights (per second): the classic boids rules plus the home, the shore and fear. */
const COHESION = 0.9;
const ALIGNMENT = 1.6;
const SEPARATION = 2.4;
const SEEK = 0.8;
const SHORE = 5;
const FLEE = 14;
/** Separation distance in body lengths. */
const PERSONAL_SPACE = 2.2;
/** A scared school scatters this long (seconds), then regroups as the cohesion returns. */
const ALARM_SECONDS = 2.2;
/** A threat this far beyond its own reach already alarms the school. */
const ALARM_MARGIN = 1.2;
const TARGET_SECONDS: readonly [number, number] = [2.5, 6];
const TARGET_REACHED = 0.4;
const MAX_PITCH = 0.35;

const steer = { x: 0, z: 0 };
const flee = { x: 0, z: 0 };

const memberAt = (schools: SchoolPool, school: number, member: number) =>
  schools.members[school * MAX_SCHOOL + member]!;

/** A new wander point within the home that is swimmable water (keeps the old one otherwise). */
export const pickSchoolTarget = (context: BoidContext, school: number) => {
  const { homes, random, schools, water } = context;
  const home = homes[schools.home[school]!]!;
  schools.targetTimer[school] = TARGET_SECONDS[0] + random() * (TARGET_SECONDS[1] - TARGET_SECONDS[0]);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * home.radius;
    const x = home.x + Math.cos(angle) * distance, z = home.z + Math.sin(angle) * distance;
    if (water.depth(x, z) < FISH_MIN_DEPTH + 0.1) continue;
    schools.targetX[school] = x;
    schools.targetZ[school] = z;
    return;
  }
  schools.targetX[school] = home.x;
  schools.targetZ[school] = home.z;
};

/** Scatters from a threat near the school; the wander point jumps away from it. */
const updateAlarm = (context: BoidContext, school: number, dt: number) => {
  const { schools, threats } = context;
  schools.alarm[school] = Math.max(0, schools.alarm[school]! - dt);
  const threat = threats.find(schools.centerX[school]!, schools.centerZ[school]!, ALARM_MARGIN);
  if (!threat) return;
  const fresh = schools.alarm[school]! <= 0;
  schools.alarm[school] = ALARM_SECONDS;
  if (!fresh) return;
  const home = context.homes[schools.home[school]!]!;
  const dx = schools.centerX[school]! - threat.x, dz = schools.centerZ[school]! - threat.z;
  const distance = Math.hypot(dx, dz) || 1;
  const x = home.x + (dx / distance) * home.radius, z = home.z + (dz / distance) * home.radius;
  if (context.water.depth(x, z) < FISH_MIN_DEPTH + 0.1) return;
  schools.targetX[school] = x;
  schools.targetZ[school] = z;
};

const addSeparation = (context: BoidContext, school: number, index: number, space: number) => {
  const { fish, schools } = context;
  const count = schools.memberCount[school]!;
  for (let member = 0; member < count; member += 1) {
    const other = memberAt(schools, school, member);
    if (other === index) continue;
    const dx = fish.x[index]! - fish.x[other]!, dz = fish.z[index]! - fish.z[other]!;
    const distance = Math.hypot(dx, dz);
    if (distance >= space || distance < 1e-5) continue;
    const weight = SEPARATION * (1 - distance / space) / distance;
    steer.x += dx * weight;
    steer.z += dz * weight;
  }
};

/** Steers away from water too shallow ahead: back towards the home (always deep enough). */
const addShore = (context: BoidContext, index: number, home: FishHome, speed: number) => {
  const { fish, water } = context;
  const look = 0.4 + speed * 0.6;
  const aheadX = fish.x[index]! + (fish.vx[index]! / speed) * look;
  const aheadZ = fish.z[index]! + (fish.vz[index]! / speed) * look;
  if (water.depth(aheadX, aheadZ) >= FISH_MIN_DEPTH + 0.1) return;
  const dx = home.x - fish.x[index]!, dz = home.z - fish.z[index]!;
  const distance = Math.hypot(dx, dz) || 1;
  steer.x += (dx / distance) * SHORE;
  steer.z += (dz / distance) * SHORE;
};

/** The boids forces of one fish (written into `steer`). */
const gatherSteering = (context: BoidContext, school: number, index: number, speed: number) => {
  const { fish, schools, threats } = context;
  const species = FISH_SPECIES[fish.species[index]!]!;
  const home = context.homes[schools.home[school]!]!;
  const calm = 1 - (schools.alarm[school]! / ALARM_SECONDS) * 0.85;
  steer.x = (schools.centerX[school]! - fish.x[index]!) * COHESION * calm;
  steer.z = (schools.centerZ[school]! - fish.z[index]!) * COHESION * calm;
  steer.x += (schools.meanVx[school]! - fish.vx[index]!) * ALIGNMENT * calm;
  steer.z += (schools.meanVz[school]! - fish.vz[index]!) * ALIGNMENT * calm;
  const tx = schools.targetX[school]! - fish.x[index]!, tz = schools.targetZ[school]! - fish.z[index]!;
  const toTarget = Math.hypot(tx, tz) || 1;
  steer.x += ((tx / toTarget) * species.cruise - fish.vx[index]!) * SEEK;
  steer.z += ((tz / toTarget) * species.cruise - fish.vz[index]!) * SEEK;
  addSeparation(context, school, index, species.length * PERSONAL_SPACE * fish.scale[index]!);
  if (threats.count() > 0) {
    threats.push(fish.x[index]!, fish.z[index]!, FLEE, flee);
    steer.x += flee.x;
    steer.z += flee.z;
  }
  addShore(context, index, home, speed);
};

/** Speed limits: a slow drift at least, the burst while scared. */
const limitSpeed = (fish: FishPool, index: number, alarmed: boolean) => {
  const species = FISH_SPECIES[fish.species[index]!]!;
  const speed = Math.hypot(fish.vx[index]!, fish.vz[index]!);
  const top = alarmed ? species.burst : species.cruise * 1.35;
  const least = species.cruise * 0.3;
  const limited = Math.min(top, Math.max(least, speed));
  if (speed < 1e-5) {
    fish.vx[index] = Math.cos(fish.heading[index]!) * least;
    fish.vz[index] = Math.sin(fish.heading[index]!) * least;
    return least;
  }
  fish.vx[index] = (fish.vx[index]! / speed) * limited;
  fish.vz[index] = (fish.vz[index]! / speed) * limited;
  return limited;
};

/** Moves the fish unless that would take it into the shallows (then it turns back). */
const moveFish = (context: BoidContext, index: number, dt: number) => {
  const { fish, water } = context;
  const x = fish.x[index]! + fish.vx[index]! * dt, z = fish.z[index]! + fish.vz[index]! * dt;
  const depth = water.depth(x, z);
  if (depth < FISH_MIN_DEPTH && depth < water.depth(fish.x[index]!, fish.z[index]!)) {
    fish.vx[index] = -fish.vx[index]! * 0.6;
    fish.vz[index] = -fish.vz[index]! * 0.6;
    return;
  }
  fish.x[index] = x;
  fish.z[index] = z;
};

/** Tail beat: faster and wider with speed; the pitch follows the climb or dive. */
const animateFish = (context: BoidContext, index: number, speed: number, dt: number, schoolShare: number) => {
  const { fish, random, water } = context;
  const species = FISH_SPECIES[fish.species[index]!]!;
  const effort = Math.min(1, Math.max(0, (speed - species.cruise) / (species.burst - species.cruise)));
  fish.phase[index] = (fish.phase[index]! + dt * Math.PI * 2 * species.wag * (0.55 + speed / species.cruise * 0.45))
    % (Math.PI * 2);
  fish.wagAmplitude[index] = 0.05 + 0.07 * effort;
  fish.heading[index] = Math.atan2(fish.vz[index]!, fish.vx[index]!);
  updateDart(fish, index, random, dt);
  const height = getSwimHeight(water, fish, index, schoolShare);
  const x = fish.x[index]!, z = fish.z[index]!, before = fish.y[index]!;
  // Eased towards the aim, then clamped again: a rising seabed or a shallow edge never clips it.
  fish.y[index] = clampSwimHeight(before + (height - before) * Math.min(1, dt * 2), water.surface(x, z),
    water.ground(x, z), getFishExtent(fish, index));
  const rise = fish.y[index]! - before;
  const pitch = Math.atan2(rise / Math.max(dt, 1e-4), speed);
  fish.pitch[index] = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
};

/** One step of a school: its alarm and wander point, then every member's boids forces. */
export const stepSchool = (context: BoidContext, school: number, dt: number) => {
  const { fish, schools } = context;
  measureSchool(fish, schools, school);
  updateAlarm(context, school, dt);
  schools.targetTimer[school] = schools.targetTimer[school]! - dt;
  const toTarget = Math.hypot(schools.targetX[school]! - schools.centerX[school]!,
    schools.targetZ[school]! - schools.centerZ[school]!);
  if (schools.targetTimer[school]! <= 0 || toTarget < TARGET_REACHED) pickSchoolTarget(context, school);
  const alarmed = schools.alarm[school]! > 0;
  const schoolShare = getSchoolDepthShare(schools.driftPhase[school]!, context.time);
  for (let member = 0; member < schools.memberCount[school]!; member += 1) {
    const index = memberAt(schools, school, member);
    const speed = Math.max(1e-4, Math.hypot(fish.vx[index]!, fish.vz[index]!));
    gatherSteering(context, school, index, speed);
    fish.vx[index] = fish.vx[index]! + steer.x * dt;
    fish.vz[index] = fish.vz[index]! + steer.z * dt;
    const limited = limitSpeed(fish, index, alarmed);
    moveFish(context, index, dt);
    animateFish(context, index, limited, dt, schoolShare);
  }
};
