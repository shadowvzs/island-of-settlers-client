import { lerp } from "../../shared/world/noise";
import { getWingTuck, lerpAngle } from "./bird-flight";
import { type HabitatField,sampleHabitat } from "./bird-habitat";
import type { BirdFrame, BirdHistory, BirdPool } from "./bird-pool";
import { BIRD_SPECIES } from "./bird-species";

/** Birds fading in below this are not drawn yet. */
const MIN_APPEAR = 0.02;

/** Packs the visible birds into the frame, interpolated between the last two steps. */
export const createBirdFrameWriter = (
  pool: BirdPool,
  history: BirdHistory,
  frame: BirdFrame,
  field: HabitatField
) => {
  const capacity = pool.flock.length;

  const writeBird = (bird: number, slot: number, alpha: number, appear: number) => {
    const x = lerp(history.x[bird]!, pool.x[bird]!, alpha);
    const z = lerp(history.z[bird]!, pool.z[bird]!, alpha);
    const species = pool.species[bird]!;
    frame.x[slot] = x;
    frame.y[slot] = lerp(history.y[bird]!, pool.y[bird]!, alpha);
    frame.z[slot] = z;
    frame.heading[slot] = lerpAngle(history.heading[bird]!, pool.heading[bird]!, alpha);
    frame.bank[slot] = lerp(history.bank[bird]!, pool.bank[bird]!, alpha);
    frame.pitch[slot] = lerp(history.pitch[bird]!, pool.pitch[bird]!, alpha);
    frame.flapPhase[slot] = lerpAngle(history.phase[bird]!, pool.phase[bird]!, alpha);
    frame.flapAmount[slot] = lerp(history.flap[bird]!, pool.flap[bird]!, alpha);
    frame.scale[slot] = BIRD_SPECIES[species]!.size * appear;
    frame.shade[slot] = pool.shade[bird]!;
    frame.species[slot] = species;
    frame.tuck[slot] = getWingTuck(frame.bank[slot]!, pool.settle[bird]!);
    frame.ground[slot] = field.surface(x, z);
    frame.visibility[slot] = sampleHabitat(field, field.open, x, z);
  };

  /** Packs the visible birds, interpolated `alpha` (0..1) between the last two steps. */
  return (alpha: number) => {
    let count = 0;
    for (let bird = 0; bird < capacity; bird += 1) {
      if (pool.flock[bird] === -1 || (pool.delay[bird]! > 0 && pool.appear[bird]! < 1)) continue;
      const appear = lerp(history.appear[bird]!, pool.appear[bird]!, alpha);
      if (appear <= MIN_APPEAR) continue;
      writeBird(bird, count, alpha, appear);
      count += 1;
    }
    frame.count = count;
  };
};
