import { lerp } from "../../shared/world/noise";
import { lerpAngle } from "../birds/bird-flight";
import { type HabitatField,sampleHabitat } from "../birds/bird-habitat";
import { BUTTERFLY_VARIANTS } from "../flyers/flyer-atlas-layout";
import { getButterflyVariant, getWingAngle, getWingBend } from "./butterfly-flight";
import type { ButterflyFrame, ButterflyHistory, ButterflyPool } from "./butterfly-pool";
import { BUTTERFLY_SPECIES } from "./butterfly-species";

/** Butterflies fading in below this are not drawn yet. */
const MIN_APPEAR = 0.02;

/** Packs the visible butterflies into the frame, interpolated between the last two steps. */
export const createButterflyFrameWriter = (
  pool: ButterflyPool,
  history: ButterflyHistory,
  frame: ButterflyFrame,
  habitat: HabitatField
) => {
  const capacity = pool.active.length;

  const writeButterfly = (index: number, slot: number, alpha: number, appear: number) => {
    const x = lerp(history.x[index]!, pool.x[index]!, alpha);
    const z = lerp(history.z[index]!, pool.z[index]!, alpha);
    const species = pool.species[index]!;
    const phase = lerpAngle(history.phase[index]!, pool.phase[index]!, alpha);
    const flap = lerp(history.flap[index]!, pool.flap[index]!, alpha);
    const sit = lerp(history.sit[index]!, pool.sit[index]!, alpha);
    frame.x[slot] = x;
    frame.y[slot] = lerp(history.y[index]!, pool.y[index]!, alpha);
    frame.z[slot] = z;
    frame.heading[slot] = lerpAngle(history.heading[index]!, pool.heading[index]!, alpha);
    frame.wing[slot] = getWingAngle(phase, flap, sit);
    frame.bend[slot] = getWingBend(phase, flap, sit);
    frame.variant[slot] = getButterflyVariant(pool.seed[index]!, BUTTERFLY_VARIANTS);
    frame.scale[slot] = BUTTERFLY_SPECIES[species]!.size * appear;
    frame.shade[slot] = pool.shade[index]!;
    frame.species[slot] = species;
    frame.ground[slot] = habitat.surface(x, z);
    frame.visibility[slot] = sampleHabitat(habitat, habitat.open, x, z);
  };

  /** Packs the visible butterflies, interpolated `alpha` (0..1) between the last two steps. */
  return (alpha: number) => {
    let count = 0;
    for (let index = 0; index < capacity; index += 1) {
      if (pool.active[index] === 0) continue;
      const appear = lerp(history.appear[index]!, pool.appear[index]!, alpha);
      if (appear <= MIN_APPEAR) continue;
      writeButterfly(index, count, alpha, appear);
      count += 1;
    }
    frame.count = count;
  };
};
