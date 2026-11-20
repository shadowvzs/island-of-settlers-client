import { MAX_SCHOOL } from "./fish-species";

/**
 * The fish and their schools as structs of arrays (fixed capacity, no allocation while running).
 * A fish belongs to one school; a school is the group living at one home.
 */
export interface FishPool {
  active: Uint8Array;
  /** Visual size 0 (hidden) .. 1: fades in on arrival, out when the school leaves the view. */
  appear: Float32Array;
  capacity: number;
  /** Seconds since the current dart began (-1: none), until the next one, and its signed reach. */
  dartAge: Float32Array;
  dartAmount: Float32Array;
  dartClock: Float32Array;
  /** Its own layer: an offset to the school's depth share (fish-depth.ts). */
  depthShare: Float32Array;
  heading: Float32Array;
  pitch: Float32Array;
  /** Tail beat phase (radians) and amplitude (share of the length). */
  phase: Float32Array;
  scale: Float32Array;
  school: Int16Array;
  shade: Float32Array;
  species: Uint8Array;
  wagAmplitude: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export interface SchoolPool {
  active: Uint8Array;
  /** Seconds left of the scare: the school scatters, then regroups as it runs out. */
  alarm: Float32Array;
  capacity: number;
  /** Centre and mean velocity of the members (refreshed every step). */
  centerX: Float32Array;
  centerZ: Float32Array;
  /** Phase (radians) of the school's slow depth drift, fixed per home. */
  driftPhase: Float32Array;
  home: Int32Array;
  leaving: Uint8Array;
  meanVx: Float32Array;
  meanVz: Float32Array;
  memberCount: Uint8Array;
  /** Fish slots of the members, MAX_SCHOOL per school. */
  members: Int16Array;
  /** The point the school is heading for within its home and the seconds until a new one. */
  targetX: Float32Array;
  targetZ: Float32Array;
  targetTimer: Float32Array;
}

const floats = (capacity: number) => new Float32Array(capacity);

export const createFishPool = (capacity: number): FishPool => ({
  active: new Uint8Array(capacity),
  appear: floats(capacity),
  capacity,
  dartAge: floats(capacity).fill(-1),
  dartAmount: floats(capacity),
  dartClock: floats(capacity),
  depthShare: floats(capacity),
  heading: floats(capacity),
  phase: floats(capacity),
  pitch: floats(capacity),
  scale: floats(capacity),
  school: new Int16Array(capacity).fill(-1),
  shade: floats(capacity),
  species: new Uint8Array(capacity),
  vx: floats(capacity),
  vz: floats(capacity),
  wagAmplitude: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createSchoolPool = (capacity: number): SchoolPool => ({
  active: new Uint8Array(capacity),
  alarm: floats(capacity),
  capacity,
  centerX: floats(capacity),
  centerZ: floats(capacity),
  driftPhase: floats(capacity),
  home: new Int32Array(capacity).fill(-1),
  leaving: new Uint8Array(capacity),
  meanVx: floats(capacity),
  meanVz: floats(capacity),
  memberCount: new Uint8Array(capacity),
  members: new Int16Array(capacity * MAX_SCHOOL).fill(-1),
  targetTimer: floats(capacity),
  targetX: floats(capacity),
  targetZ: floats(capacity)
});

/** The first free slot, or -1. */
export const findFreeSlot = (active: Uint8Array) => {
  for (let index = 0; index < active.length; index += 1) if (active[index] === 0) return index;
  return -1;
};

export const countFree = (active: Uint8Array) => {
  let free = 0;
  for (let index = 0; index < active.length; index += 1) if (active[index] === 0) free += 1;
  return free;
};

/** Refreshes a school's centre and mean velocity from its members. */
export const measureSchool = (fish: FishPool, schools: SchoolPool, school: number) => {
  const count = schools.memberCount[school]!;
  let x = 0, z = 0, vx = 0, vz = 0;
  for (let member = 0; member < count; member += 1) {
    const index = schools.members[school * MAX_SCHOOL + member]!;
    x += fish.x[index]!;
    z += fish.z[index]!;
    vx += fish.vx[index]!;
    vz += fish.vz[index]!;
  }
  const share = 1 / Math.max(1, count);
  schools.centerX[school] = x * share;
  schools.centerZ[school] = z * share;
  schools.meanVx[school] = vx * share;
  schools.meanVz[school] = vz * share;
};
