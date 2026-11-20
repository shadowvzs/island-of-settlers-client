/** A scare (felling, a fleeing animal) keeps critters away from its spot this long (seconds). */
const SCARE_SECONDS = 4;
const SCARE_CAPACITY = 8;

interface Point {
  x: number;
  z: number;
}

/**
 * What critters keep away from: the workers (always) and recent scares with their radius.
 * `find` answers the nearest one within a radius (a scare counts within its own radius too).
 */
export const createThreats = (getWorkers?: () => readonly Point[]) => {
  const scareX = new Float32Array(SCARE_CAPACITY);
  const scareZ = new Float32Array(SCARE_CAPACITY);
  const scareRadius = new Float32Array(SCARE_CAPACITY);
  const scareUntil = new Float32Array(SCARE_CAPACITY);
  const found = { distance: Infinity, x: 0, z: 0 };
  let workers: readonly Point[] = [];
  let time = 0;
  let next = 0;

  const update = (now: number) => {
    time = now;
    workers = getWorkers?.() ?? [];
  };

  const scare = (x: number, z: number, radius: number) => {
    scareX[next] = x;
    scareZ[next] = z;
    scareRadius[next] = radius;
    scareUntil[next] = time + SCARE_SECONDS;
    next = (next + 1) % SCARE_CAPACITY;
  };

  /** Keeps the nearest point within its reach (scratch result: no allocation per call). */
  const consider = (x: number, z: number, atX: number, atZ: number, reach: number) => {
    const distance = Math.hypot(atX - x, atZ - z);
    if (distance >= reach || distance >= found.distance) return;
    found.distance = distance;
    found.x = atX;
    found.z = atZ;
  };

  const find = (x: number, z: number, radius: number) => {
    found.distance = Infinity;
    for (const worker of workers) consider(x, z, worker.x, worker.z, radius);
    for (let index = 0; index < SCARE_CAPACITY; index += 1) {
      if (scareUntil[index]! <= time) continue;
      consider(x, z, scareX[index]!, scareZ[index]!, Math.max(radius, scareRadius[index]!));
    }
    return found.distance < Infinity ? found : null;
  };

  return { find, scare, update };
};
