/** A ground point (world units). */
export interface FormationPoint {
  x: number;
  z: number;
}

/** Distance between neighbouring workers of a group (cells): a loose crowd, not a drill. */
export const FORMATION_SPACING = 0.8;
/** Rings searched around the centre before the formation gives up on more slots. */
const MAX_RINGS = 5;
/** Turns every ring a little, so the rings do not line up into spokes. */
const RING_TWIST = 0.5;

/** The candidate spots of one ring: 6 per ring step around the centre (hexagon like). */
const listRingSpots = (center: FormationPoint, ring: number, spacing: number) => {
  if (ring === 0) return [center];
  const count = ring * 6;
  return Array.from({ length: count }, (_, step) => {
    const angle = (step / count) * Math.PI * 2 + ring * RING_TWIST;
    return {
      x: center.x + Math.cos(angle) * ring * spacing,
      z: center.z + Math.sin(angle) * ring * spacing
    };
  });
};

/**
 * Up to `count` slots around `center`, nearest rings first, each one accepted by `isFree`
 * (walkable and reachable). Empty when the centre itself is not free.
 */
export const listFormationSlots = (
  center: FormationPoint,
  count: number,
  isFree: (x: number, z: number) => boolean,
  spacing = FORMATION_SPACING
) => {
  if (count <= 0 || !isFree(center.x, center.z)) return [];
  const slots: FormationPoint[] = [];
  for (let ring = 0; ring <= MAX_RINGS && slots.length < count; ring++)
    for (const spot of listRingSpots(center, ring, spacing)) {
      if (slots.length === count) break;
      if (isFree(spot.x, spot.z)) slots.push(spot);
    }
  return slots;
};

/**
 * Slot index per worker: the closest worker / slot pairs first, so nobody crosses the whole
 * group. Workers without a slot (fewer slots than workers) share the centre slot; -1 only when
 * there is no slot at all.
 */
export const assignFormationSlots = (
  workers: readonly FormationPoint[],
  slots: readonly FormationPoint[]
) => {
  const assigned = workers.map(() => -1);
  const taken = slots.map(() => false);
  for (let pair = 0; pair < Math.min(workers.length, slots.length); pair++) {
    let best = { distance: Infinity, slot: -1, worker: -1 };
    workers.forEach((worker, workerIndex) => {
      if (assigned[workerIndex] !== -1) return;
      slots.forEach((slot, slotIndex) => {
        if (taken[slotIndex]) return;
        const distance = Math.hypot(slot.x - worker.x, slot.z - worker.z);
        if (distance < best.distance) best = { distance, slot: slotIndex, worker: workerIndex };
      });
    });
    assigned[best.worker] = best.slot;
    taken[best.slot] = true;
  }
  return assigned.map((slot) => (slot === -1 && slots.length > 0 ? 0 : slot));
};
