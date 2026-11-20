import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import type { WorldData } from "../world/world-data";

export interface MilitaryArrow {
  id: number; shooter: number; faction: number; rank: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number; age: number;
  /** Free-point shots end at their bounded aim distance instead of extending high arcs beyond range. */
  maximumAge?: number;
  /** Shot from this garrisoned building: its own walls never stop the arrow. */
  building?: number;
  /** Colony tower bonus fixed at release, including arrows whose shooter subsequently dies. */
  damageMultiplier?: number;
  /** Shot at this building's walls (a colony fort under direct assault). */
  wall?: number;
  /** Fixed target and impact position: boulders never home or hit bystanders. `kind` absent = stone. */
  boulder?: {
    diameter?: number; kind?: import("./catapult-ammo-kinds").CatapultAmmoKind;
    /** CAT-5: one of the granite bundle's five airborne fragments. */
    fragment?: boolean;
    /** CAT-7: seconds since the shot came to rest; absent while flying or rolling. */
    restAge?: number;
    /** CAT-6: a landed marble shot rolling on (kept after it stops, for the ball's final turn). */
    roll?: import("./military-catapult-roll").CatapultRoll;
    target: number; x: number; y: number; z: number;
  };
}
export const ARROW_GRAVITY = 9.8;
export const ARROW_SPEED = 10;
export const shootMilitaryArrow = (
  origin: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  velocity: { x: number; z: number }, rank: number, random: () => number
) => {
  const flight = Math.max(.15, DMath.hypot(target.x - origin.x, target.z - origin.z) / ARROW_SPEED);
  // Gaussian angular dispersion: rank improves aim, never rerolls contact into a miss.
  const gaussian = Math.sqrt(-2 * DMath.log(Math.max(1e-9, random()))) * DMath.cos(2 * Math.PI * random());
  const angle = gaussian * [.019, .015, .011][rank]!;
  const dx = target.x + velocity.x * flight - origin.x;
  const dz = target.z + velocity.z * flight - origin.z;
  return {
    x: origin.x, y: origin.y, z: origin.z,
    vx: (dx * DMath.cos(angle) - dz * DMath.sin(angle)) / flight,
    vz: (dx * DMath.sin(angle) + dz * DMath.cos(angle)) / flight,
    vy: (target.y - origin.y + .5 * ARROW_GRAVITY * flight * flight) / flight,
    age: 0
  };
};

/**
 * Swept contact prevents tunnelling through soldiers, terrain or building walls. Arrows fly through
 * friendly soldiers: they never hurt or stop at them (owner decision 2026-10-13).
 */
export const sweepMilitaryArrow = (
  arrow: MilitaryArrow, dt: number, world: WorldData,
  targets: readonly { id: number; faction: number; x: number; y: number; z: number }[],
  walls: readonly { uid?: number; x: number; z: number; y: number; width: number; depth: number }[]
) => {
  if (arrow.maximumAge !== undefined) dt = Math.min(dt, Math.max(0, arrow.maximumAge - arrow.age));
  const start = { x: arrow.x, y: arrow.y, z: arrow.z };
  const samples = Math.max(1, Math.ceil(DMath.hypot(arrow.vx, arrow.vy, arrow.vz) * dt / .06));
  for (let sample = 1; sample <= samples; sample++) {
    const time = dt * sample / samples;
    const x = start.x + arrow.vx * time, z = start.z + arrow.vz * time;
    const y = start.y + arrow.vy * time - .5 * ARROW_GRAVITY * time * time;
    arrow.x = x; arrow.y = y; arrow.z = z;
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ ||
      y <= sampleSmooth(world, world.heights, x, z)) return { stopped: true };
    if (walls.some(wall => wall.uid !== arrow.building && Math.abs(x - wall.x) < wall.width / 2 &&
      Math.abs(z - wall.z) < wall.depth / 2 && y < wall.y + 1.4)) return { stopped: true };
    for (const target of targets) {
      if (target.id === arrow.shooter || target.faction === arrow.faction) continue;
      const radius = DMath.hypot(x - target.x, z - target.z);
      if (radius > .22 || y < target.y + .12 || y > target.y + 1.06) continue;
      const lateral = Math.abs((x - target.x) * arrow.vz - (z - target.z) * arrow.vx) /
        Math.max(1e-6, DMath.hypot(arrow.vx, arrow.vz));
      return { stopped: true, target: target.id, full: lateral <= .176 &&
        y >= target.y + .2 && y <= target.y + .95 };
    }
  }
  arrow.vy -= ARROW_GRAVITY * dt; arrow.age += dt;
  return { stopped: arrow.age > 3 || arrow.maximumAge !== undefined && arrow.age >= arrow.maximumAge - 1e-9 };
};
