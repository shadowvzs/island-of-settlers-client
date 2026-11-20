import type { BirdBuildingAvoidance, BirdPosition } from "../../birds/bird-building-avoidance";
import { steerHeading, wrapAngle } from "../../birds/bird-flight";
import { BEHAVIOUR } from "../critter-colonies";
import { CRITTER } from "../critter-species";
import { CLIP } from "../model/critter-model";
import type { CritterContext } from "./critter-context";
import type { CritterPool } from "./critter-pool";

const steeringPosition = { x: 0, y: 0, z: 0 };
/**
 * A sphere enclosing every original baked wing pose, including the trailing heron legs (High
 * models: eagle all frames, heron and gull their flight frames from 8). Baked numbers, so the
 * simulation never waits for a model file; tests/critters-flight-envelope.test.ts recomputes
 * them from the models.
 */
const FLIGHT_ENVELOPES: ReadonlyMap<number, { height: number; radius: number }> = new Map([
  [CRITTER.eagle, { height: 0.13748589158058167, radius: 1.2341385327774668 }],
  [CRITTER.heron, { height: 0.333903007209301, radius: 0.36927828695858256 }],
  [CRITTER.gull, { height: 0.1568053513765335, radius: 0.5007641760192384 }]
]);

export const getCritterBirdFlightEnvelope = (species: number) => FLIGHT_ENVELOPES.get(species);

const airborne = (pool: CritterPool, index: number) => pool.behaviour[index] === BEHAVIOUR.soar ||
  pool.clip[index] === CLIP.fly;

export const createCritterBuildingFlight = (pool: CritterPool, buildings: BirdBuildingAvoidance) => {
  const from: BirdPosition = { x: 0, y: 0, z: 0 }, to: BirdPosition = { x: 0, y: 0, z: 0 };
  const soaringHeadings = new Map<number, number>();
  const recover = (index: number) => {
    if (!airborne(pool, index) || pool.carcass[index]) return false;
    const envelope = getCritterBirdFlightEnvelope(pool.species[index]!);
    if (!envelope) return false;
    const scale = pool.scale[index]!, height = envelope.height * scale;
    to.x = pool.x[index]!; to.y = pool.y[index]! + height; to.z = pool.z[index]!;
    if (!buildings.recover(to, envelope.radius * scale)) return false;
    const dx = to.x - pool.x[index]!, dz = to.z - pool.z[index]!, dy = to.y - height - pool.y[index]!;
    if (pool.behaviour[index] === BEHAVIOUR.soar) {
      pool.targetX[index]! += dx; pool.targetZ[index]! += dz;
    }
    pool.x[index] = to.x; pool.z[index] = to.z; pool.y[index]! += dy; pool.lift[index]! += dy;
    return true;
  };
  const remember = (index: number) => {
    from.x = pool.x[index]!; from.y = pool.y[index]!; from.z = pool.z[index]!;
  };
  const finish = (index: number) => {
    if (!pool.active[index] || !airborne(pool, index) || pool.carcass[index]) return;
    const envelope = getCritterBirdFlightEnvelope(pool.species[index]!);
    if (!envelope) return;
    const height = envelope.height * pool.scale[index]!, radius = envelope.radius * pool.scale[index]!;
    from.y += height;
    to.x = pool.x[index]!; to.y = pool.y[index]! + height; to.z = pool.z[index]!;
    const speed = Math.max(pool.speed[index]!, 1.5);
    if (pool.behaviour[index] === BEHAVIOUR.soar) {
      const desired = pool.heading[index]!;
      const safe = buildings.heading(from, desired, speed, radius, pool, index);
      if (Math.abs(wrapAngle(safe - desired)) > .001) {
        const heading = steerHeading(soaringHeadings.get(index) ?? desired, safe, 2.5, 1 / 30);
        soaringHeadings.set(index, heading);
        const distance = Math.hypot(to.x - from.x, to.z - from.z);
        to.x = from.x + Math.cos(heading) * distance;
        to.z = from.z + Math.sin(heading) * distance;
        pool.heading[index] = heading;
      } else soaringHeadings.delete(index);
    }
    const floor = buildings.clearance(from, pool.heading[index]!, speed, radius);
    // All wildlife simulation ticks are fixed at 30 Hz; never snap above a newly approached roof.
    if (floor > from.y) to.y = Math.max(to.y, from.y + Math.min(floor - from.y, 2 / 30));
    else if (floor > to.y) to.y = floor;
    buildings.move(from, to, radius);
    if (pool.behaviour[index] === BEHAVIOUR.soar) {
      pool.targetX[index]! += to.x - pool.x[index]!; pool.targetZ[index]! += to.z - pool.z[index]!;
    }
    pool.lift[index]! += to.y - height - pool.y[index]!;
    pool.x[index] = to.x; pool.y[index] = to.y - height; pool.z[index] = to.z;
  };
  return { finish, recover, remember };
};

/** Ground birds already avoid occupied plots; this is only their ascending flight segment. */
export const steerCritterBirdFlight = (pool: CritterPool, index: number, context: CritterContext) => {
  if (!context.buildings) return;
  const envelope = getCritterBirdFlightEnvelope(pool.species[index]!);
  if (!envelope) return;
  steeringPosition.x = pool.x[index]!; steeringPosition.y = pool.y[index]! + envelope.height * pool.scale[index]!;
  steeringPosition.z = pool.z[index]!;
  const desired = context.buildings.heading(steeringPosition, pool.heading[index]!, pool.speed[index]!,
    envelope.radius * pool.scale[index]!, pool, index);
  pool.heading[index] = steerHeading(pool.heading[index]!, desired, 2.5, context.step);
};
