import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { chineseRoofBeddingHeight, chineseRoofContactSamples } from "../src/render-common/buildings/chinese-roof-bedding";

it.each([true, false])("keeps a ceramic skirt bonded across every actual bedding triangle break (%s)", detailed => {
  const roof: BuildingPart = { shape: "occupation-roof", surface: "roof", occupationRoof: "hip",
    position: [0, 1, 0], size: [2.7, .8, 3.2], roofSweep: .25, roofCurve: .4, stage: 3 };
  for (const [from, to] of [[[0, .3], [.499, .499]], [[.22, -.39], [.499, -.499]],
    [[-.018, .3], [.48, .499]]] as const) {
    const samples = chineseRoofContactSamples(roof, from, to, detailed);
    expect(samples.length).toBeGreaterThan(2);
    expect(samples[0]!.share).toBe(0); expect(samples.at(-1)!.share).toBe(1);
    for (let index = 1; index < samples.length; index++) {
      const a = samples[index - 1]!, b = samples[index]!;
      for (const fraction of [.1, .35, .7, .9]) {
        const t = a.share + (b.share - a.share) * fraction;
        const actual = chineseRoofBeddingHeight(roof, from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t, detailed);
        expect(a.height + (b.height - a.height) * fraction).toBeCloseTo(actual!, 9);
      }
    }
  }
});
