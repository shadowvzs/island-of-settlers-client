import { expect, it } from "vitest";
import { sampleRomanSurfaceDetail } from "../src/renderers/three/buildings/roman-surface-detail";
import { mudBrickDetail } from "../src/renderers/three/buildings/wall-surface-detail";

it("keeps exposed stone and dressed block faces within a coherent quarry palette", () => {
  for (const surface of ["stone", "cut-stone"] as const) {
    const channels: number[][] = [[], [], []];
    for (let row = 0; row < 8; row++) for (let column = 0; column < 5; column++)
      for (const grain of [.25, .5, .75]) for (const mineral of [0, .25, .5, .75, 1])
        for (const weather of [0, .25, .5, .75, 1]) {
          const point = { u: (column + .5 - row % 2 * .5) / 5, v: (row + .5) / 8,
            grain, mineral, weather };
          const sample = sampleRomanSurfaceDetail(surface, point, true);
          sample.colour.forEach((colour, index) => channels[index]!.push(colour * sample.brightness));
        }
    for (const values of channels) expect(Math.max(...values) / Math.min(...values), surface).toBeLessThan(1.15);
  }
});

it("keeps mudbrick faces close in tone while retaining recessed dark mortar", () => {
  const face: number[] = [], joint: number[] = [];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const sample = mudBrickDetail({ u: x / 128, v: y / 128, grain: .5, mineral: .5, weather: .5 });
    if (sample.height > .64) face.push(sample.brightness);
    if (sample.height < .2) joint.push(sample.brightness);
  }
  expect(Math.max(...face) / Math.min(...face)).toBeLessThan(1.15);
  expect(Math.min(...joint)).toBeLessThan(Math.min(...face));
});
