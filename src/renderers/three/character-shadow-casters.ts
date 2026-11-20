import { type Camera, Vector3 } from "three";

/** Something that may draw into the sun shadow map this frame (a crowd member, a mount). */
export interface ShadowCaster {
  setCaster(casting: boolean): void;
}

const feet = new Vector3();

/**
 * Caster priority of a character: its projected height in device pixels, weighted down towards the
 * screen edges (the corner of the view counts a third of the centre), so the budget goes to the
 * large figures the player looks at.
 */
export const characterShadowScore = (camera: Camera, x: number, y: number, z: number, pixels: number) => {
  feet.set(x, y, z).project(camera);
  const offCentre = feet.x * feet.x + feet.y * feet.y;
  return Number.isFinite(offCentre) ? pixels / (1 + offCentre) : 0;
};

/**
 * Per-frame choice of the sun shadow casters of one crowd: candidates are offered with a score,
 * `select` lets the best `budget` cast and switches the rest off. The arrays only grow (no
 * allocation on ordinary frames); equal scores at the cut are taken in offer order.
 */
export const createShadowCasterSelection = () => {
  let scores = new Float64Array(64);
  let sorted = new Float64Array(64);
  const casters: ShadowCaster[] = [];
  let count = 0;
  let casting = 0;

  const grow = () => {
    const larger = new Float64Array(scores.length * 2);
    larger.set(scores);
    scores = larger;
    sorted = new Float64Array(larger.length);
  };

  /** The `budget`-th largest offered score (ascending sort, the unused tail padded below it). */
  const threshold = (budget: number) => {
    sorted.set(scores);
    sorted.fill(-Infinity, count);
    sorted.sort();
    return sorted[sorted.length - budget]!;
  };

  return {
    begin: () => { count = 0; },
    /** Casters chosen by the last `select`. */
    casting: () => casting,
    offer: (caster: ShadowCaster, score: number) => {
      if (count === scores.length) grow();
      scores[count] = score;
      casters[count] = caster;
      count++;
    },
    select: (budget: number) => {
      if (count <= budget) {
        for (let index = 0; index < count; index++) casters[index]!.setCaster(true);
        casting = count;
        return casting;
      }
      const cut = budget > 0 ? threshold(budget) : Infinity;
      let above = 0;
      for (let index = 0; index < count; index++) if (scores[index]! > cut) above++;
      let ties = budget - above;
      for (let index = 0; index < count; index++) {
        const score = scores[index]!;
        const chosen = score > cut || (score === cut && ties-- > 0);
        casters[index]!.setCaster(chosen);
      }
      casting = budget;
      return casting;
    }
  };
};

export type ShadowCasterSelection = ReturnType<typeof createShadowCasterSelection>;
