export const SOWING_RELEASE_PHASE = .54;
export const SOWING_CYCLE_SECONDS = 2.4;
export const SOWING_GRAVITY = 9.81 * (1.0625 / 1.75);

/** Ballistic grains stay anchored at the recorded hand release, rather than following its return. */
export const sowingSeedPosition = (origin: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number }, age: number, floor: number) => {
  const y = origin.y + velocity.y * age - SOWING_GRAVITY * age * age / 2;
  return { x: origin.x + velocity.x * age, y, z: origin.z + velocity.z * age,
    visible: age >= 0 && y > floor + .003 && age < 1 };
};
