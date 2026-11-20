import { describe, expect, it } from "vitest";

import { getCritterModels } from "../src/render-common/critters/critter-models";
import { CRITTER } from "../src/render-common/critters/critter-species";

/** Mean colour (rgb) of a critter's standing frame. */
const meanColor = (species: number, winter: boolean) => {
  const { colors } = getCritterModels(winter)[species]!.frames[0]!;
  const sum = [0, 0, 0];
  for (let index = 0; index < colors.length; index += 1) sum[index % 3]! += colors[index]!;
  return sum.map((channel) => channel / (colors.length / 3));
};
const brightness = (color: number[]) => color[0]! + color[1]! + color[2]!;

describe("critter winter coats", () => {
  it("keeps every species' geometry and only recolours the coats", () => {
    const summer = getCritterModels(false);
    const winter = getCritterModels(true);
    expect(winter.length).toBe(summer.length);
    for (const species of [CRITTER.marmot, CRITTER.chamois, CRITTER.mallardDrake]) {
      expect(winter[species]!.frames.length).toBe(summer[species]!.frames.length);
    }
  });

  it("darkens the chamois and the boar, deepens the fox, keeps the hibernating marmot", () => {
    expect(brightness(meanColor(CRITTER.chamois, true))).toBeLessThan(
      brightness(meanColor(CRITTER.chamois, false)) * 0.85
    );
    expect(brightness(meanColor(CRITTER.boar, true))).toBeLessThan(
      brightness(meanColor(CRITTER.boar, false))
    );
    expect(meanColor(CRITTER.fox, true)).not.toEqual(meanColor(CRITTER.fox, false));
    expect(meanColor(CRITTER.marmot, true)).toEqual(meanColor(CRITTER.marmot, false));
  });

  it("gives the wolf a paler, thicker winter coat on the same vertices", () => {
    expect(brightness(meanColor(CRITTER.wolf, true))).toBeGreaterThan(
      brightness(meanColor(CRITTER.wolf, false))
    );
    const standing = (season: boolean) => getCritterModels(season)[CRITTER.wolf]!.frames[0]!;
    expect(standing(true).positions.length).toBe(standing(false).positions.length);
    expect(standing(true).radius).toBeGreaterThan(standing(false).radius);
  });
});
