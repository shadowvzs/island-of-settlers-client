import { describe, expect, it } from "vitest";

import { createChamoisModel } from "../src/render-common/critters/model/chamois";
import { FOOD_FRAME } from "../src/render-common/critters/model/quadruped-food";

const triangles = (options: Parameters<typeof createChamoisModel>[0]) =>
  createChamoisModel(options).frames[0]!.indices.length / 3;

describe("chamois model (antelope source, baked clips)", () => {
  it("has every food critter frame on one topology", () => {
    const model = createChamoisModel({ kid: false, minimal: false, winter: false });
    expect(model.frames.length).toBe(FOOD_FRAME.dying + 4);
    const vertices = model.frames[0]!.positions.length;
    for (const frame of model.frames) expect(frame.positions.length).toBe(vertices);
  });

  it("lies lower than it stands and grazes with the head down", () => {
    const { frames } = createChamoisModel({ kid: false, minimal: false, winter: false });
    expect(frames[FOOD_FRAME.rest]!.height).toBeLessThan(frames[FOOD_FRAME.stand]!.height * 0.8);
    expect(frames[FOOD_FRAME.reach]!.height).toBeLessThan(frames[FOOD_FRAME.stand]!.height);
  });

  it("draws about half the triangles on Minimal and the kid without horns", () => {
    const high = triangles({ kid: false, minimal: false, winter: false });
    expect(triangles({ kid: false, minimal: true, winter: false })).toBeLessThan(high * 0.6);
    expect(triangles({ kid: true, minimal: false, winter: false })).toBeLessThan(high);
  });

  it("wears a darker coat in winter on the same geometry", () => {
    const summer = createChamoisModel({ kid: false, minimal: false, winter: false }).frames[0]!;
    const winter = createChamoisModel({ kid: false, minimal: false, winter: true }).frames[0]!;
    const mean = (colors: Float32Array) => colors.reduce((sum, value) => sum + value, 0) / colors.length;
    expect(winter.positions).toEqual(summer.positions);
    expect(mean(winter.colors)).toBeLessThan(mean(summer.colors) * 0.75);
  });
});
