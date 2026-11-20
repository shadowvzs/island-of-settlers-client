import { describe, expect, it } from "vitest";

import {
  createRabbitAppearance,
  PATCH_BLOBS,
  RABBIT_COAT,
  RABBIT_COAT_COUNT,
  RABBIT_COAT_SHARES
} from "../src/render-common/wildlife/model/rabbit-coat";
import { getPatchMask } from "../src/render-common/wildlife/model/rabbit-coat-shading";
import {
  createPersonality,
  PERSONALITY_SPREAD
} from "../src/render-common/wildlife/sim/animal-personality";

const SAMPLES = 20_000;

describe("rabbit identity", () => {
  it("recreates the same individual from the same seeds", () => {
    expect(createRabbitAppearance(42)).toEqual(createRabbitAppearance(42));
    expect(createPersonality(7)).toEqual(createPersonality(7));
    expect(createRabbitAppearance(42)).not.toEqual(createRabbitAppearance(43));
  });

  it("follows the population shares (agouti 45 %, chestnut 20, tan 12, white 5, patched 10, charcoal 8)", () => {
    const counts = new Array<number>(RABBIT_COAT_COUNT).fill(0);
    for (let seed = 0; seed < SAMPLES; seed += 1) {
      counts[createRabbitAppearance(seed, 0.3).archetype]! += 1;
    }
    const total = counts.reduce((sum, count) => sum + count, 0);
    counts.forEach((count, archetype) => {
      expect(count / total).toBeCloseTo(RABBIT_COAT_SHARES[archetype]!, 1);
    });
    expect(counts[RABBIT_COAT.agouti]).toBeGreaterThan(counts[RABBIT_COAT.white]! * 5);
  });

  it("biases coats by place: more charcoal in forests, more tan in meadows", () => {
    const share = (forest: number, archetype: number) => {
      let count = 0;
      for (let seed = 0; seed < SAMPLES; seed += 1) {
        if (createRabbitAppearance(seed, forest).archetype === archetype) count += 1;
      }
      return count / SAMPLES;
    };
    expect(share(1, RABBIT_COAT.charcoal)).toBeGreaterThan(share(0, RABBIT_COAT.charcoal));
    expect(share(0, RABBIT_COAT.tan)).toBeGreaterThan(share(1, RABBIT_COAT.tan));
  });

  it("gives patches only to the mixed coat and varies the ears asymmetrically", () => {
    let asymmetric = 0;
    for (let seed = 0; seed < 500; seed += 1) {
      const look = createRabbitAppearance(seed);
      const patched = look.archetype === RABBIT_COAT.whitePatched;
      expect(look.patchPattern >= 0).toBe(patched);
      if (Math.abs(look.earLeft - look.earRight) > 0.02) asymmetric += 1;
    }
    expect(asymmetric).toBeGreaterThan(400);
  });

  it("never mirrors a patch pattern onto both sides", () => {
    PATCH_BLOBS.forEach((blobs, pattern) => {
      const oneSided = blobs.some(([x, y, z]) => {
        const here = getPatchMask([x, y, z], pattern, 0.2);
        const mirrored = getPatchMask([x, y, -z], pattern, 0.2);
        return Math.abs(here - mirrored) > 0.3;
      });
      expect(oneSided).toBe(true);
    });
  });
});

describe("personality", () => {
  it("stays subtle: every factor within its spread around 1", () => {
    for (let seed = 0; seed < 2000; seed += 1) {
      const personality = createPersonality(seed);
      for (const [key, spread] of Object.entries(PERSONALITY_SPREAD)) {
        const value = personality[key as keyof typeof personality];
        expect(value).toBeGreaterThanOrEqual(1 - spread);
        expect(value).toBeLessThanOrEqual(1 + spread);
      }
    }
  });
});
