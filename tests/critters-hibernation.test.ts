import { Vector4 } from "three";
import { describe, expect, it } from "vitest";

import { CRITTER, CRITTER_SHADE, isHibernating } from "../src/render-common/critters/critter-species";
import { createCritterFrame } from "../src/render-common/critters/sim/critter-pool";
import { createThreeCritters } from "../src/renderers/three/three-critters";

const SPECIES = [CRITTER.marmot, CRITTER.burrow, CRITTER.bear, CRITTER.boar];

/** A frame with one marmot, its burrow, a bear and a boar standing in the open. */
const createFrame = () => {
  const frame = createCritterFrame(8, 4);
  SPECIES.forEach((id, index) => {
    frame.species[index] = id;
    frame.scale[index] = 1;
    frame.shade[index] = 1;
    frame.visibility[index] = 1;
  });
  frame.count = SPECIES.length;
  return frame;
};

/** Many marmots with evenly spread spawn shades. */
const createMarmotFrame = (count: number) => {
  const frame = createCritterFrame(count, 4);
  for (let index = 0; index < count; index += 1) {
    frame.species[index] = CRITTER.marmot;
    frame.scale[index] = 1;
    frame.shade[index] = CRITTER_SHADE.base + CRITTER_SHADE.range * (index + 0.5) / count;
    frame.visibility[index] = 1;
  }
  frame.count = count;
  return frame;
};

describe("critter hibernation", () => {
  it("hibernates only the marmot, and only while the winter share is above zero", () => {
    expect(isHibernating(CRITTER.marmot, 1, 1)).toBe(true);
    expect(isHibernating(CRITTER.marmot, 0, 1)).toBe(false);
    for (const species of [CRITTER.burrow, CRITTER.bear, CRITTER.boar, CRITTER.chamois]) {
      expect(isHibernating(species, 1, 1)).toBe(false);
    }
  });

  it("leaves marmots undrawn in the prepared winter while burrows, bears and boars stay", async () => {
    for (const winter of [false, true]) {
      const critters = createThreeCritters({}, winter);
      await critters.prepare(SPECIES);
      critters.update(createFrame());
      const drawn = critters.getDrawnCounts();
      expect(drawn[CRITTER.marmot]).toBe(winter ? 0 : 1);
      expect(drawn[CRITTER.burrow]).toBe(1);
      expect(drawn[CRITTER.bear]).toBe(1);
      expect(drawn[CRITTER.boar]).toBe(1);
    }
  });

  it("thins marmots gradually and monotonically with the season snow cover", async () => {
    const cover = new Vector4();
    const critters = createThreeCritters({ uSeasonCover: { value: cover } }, false);
    await critters.prepare([CRITTER.marmot]);
    const frame = createMarmotFrame(100);
    const drawnAt = (snow: number) => {
      cover.w = snow;
      critters.update(frame);
      return critters.getDrawnCounts()[CRITTER.marmot];
    };
    const counts = [0, 0.3, 0.5, 0.6, 0.75, 0.9, 1].map(drawnAt);
    expect(counts[0]).toBe(100);
    expect(counts[1]).toBe(100);
    expect(counts.at(-1)).toBe(0);
    expect(counts[3]).toBeGreaterThan(20);
    expect(counts[3]).toBeLessThan(80);
    for (let step = 1; step < counts.length; step += 1) expect(counts[step]).toBeLessThanOrEqual(counts[step - 1]!);
    expect(drawnAt(0.6)).toBe(counts[3]);
  });
});
