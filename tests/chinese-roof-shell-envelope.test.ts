import { Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { chineseRoofBeddingHeight } from "../src/render-common/buildings/chinese-roof-bedding";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { getOccupationRoofHeight } from "../src/render-common/buildings/occupation-roof-height";
import { createChinesePanCoverRoof } from "../src/renderers/three/buildings/chinese-pan-cover-roof";

it.each([true, false])("covers clipped half-hip corners in the actual Farm roof bedding (%s)", detailed => {
  const recipe = leveledBuildingRecipe(getBuildingDefinition(37), "chinese", detailed, 5);
  for (const roof of recipe.parts.filter(part => part.shape === "occupation-roof" && part.occupationRoof === "half-hip")) {
    for (const x of [-.49, -.4, -.3103448275862069, 0, .3103448275862069, .4, .49])
      for (const z of [-.499, -.47, -.4, 0, .4, .47, .499])
        expect(chineseRoofBeddingHeight(roof, x, z, detailed), `${x}/${z}`).not.toBeNull();
  }
});

it.each([true, false])("keeps actual dark bedding triangles beneath ceramic envelopes (%s)", detailed => {
  for (const profile of ["hip", "half-hip", "pyramid", "gable"] as const)
    for (const [sweep, curve] of [[.3, .62], [.35, .85]]) {
    const roof: BuildingPart = { occupationRoof: profile, position: [0, 0, 0], roofSweep: sweep,
      roofCurve: curve, roofTiles: "pan-cover", shape: "occupation-roof", size: [1.56, .45, 1.66], stage: 3, surface: "roof" };
    const geometry = createChinesePanCoverRoof(roof, detailed), position = geometry.getAttribute("position");
    const colour = geometry.getAttribute("color"), indices = geometry.index!;
    expect(Array.from(position.array).every(value => Number.isFinite(value) && Math.abs(value) <= .50001)).toBe(true);
    let checked = 0;
    for (let index = 0; index < indices.count; index += 3) {
      const ids = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
      if (!ids.every(id => Math.abs(colour.getX(id) - .9) < 1e-6)) continue;
      const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(position, id));
      if (b!.clone().sub(a!).cross(c!.clone().sub(a!)).y < 1e-10) continue;
      checked++;
      for (let u = 0; u <= 12; u++) for (let v = 0; v <= 12 - u; v++) {
        const point = a!.clone().multiplyScalar(u / 12).addScaledVector(b!, v / 12)
          .addScaledVector(c!, 1 - (u + v) / 12);
        const ceiling = getOccupationRoofHeight(profile, point.x, point.z, roof.roofSweep, roof.roofCurve);
        expect(point.y, `${profile}/${detailed}/${point.x}/${point.z}`).toBeLessThan(ceiling - .018);
      }
    }
    expect(checked).toBeGreaterThan(0);
    geometry.dispose();
  }
});

it.each([true, false])("assigns one height to both actual half-hip seam triangulations (%s)", detailed => {
  const recipe = leveledBuildingRecipe(getBuildingDefinition(37), "chinese", detailed, 5);
  for (const roof of recipe.parts.filter(part => part.shape === "occupation-roof" && part.occupationRoof === "half-hip")) {
    const geometry = createChinesePanCoverRoof(roof, detailed), positions = geometry.getAttribute("position");
    const colours = geometry.getAttribute("color"), indices = geometry.index!;
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) for (let sample = 1; sample < 40; sample++) {
      const t = sample / 40, x = sideX * t * .2 * 2.7 / 1.74, z = sideZ * (.3 + t * .2);
      const heights: number[] = [];
      for (let index = 0; index < indices.count; index += 3) {
        const ids = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
        if (!ids.every(id => Math.abs(colours.getX(id) - .9) < 1e-6)) continue;
        const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(positions, id));
        if (b!.clone().sub(a!).cross(c!.clone().sub(a!)).y < 1e-10) continue;
        const denominator = (b!.z - c!.z) * (a!.x - c!.x) + (c!.x - b!.x) * (a!.z - c!.z);
        const u = ((b!.z - c!.z) * (x - c!.x) + (c!.x - b!.x) * (z - c!.z)) / denominator;
        const v = ((c!.z - a!.z) * (x - c!.x) + (a!.x - c!.x) * (z - c!.z)) / denominator;
        const w = 1 - u - v;
        if (Math.min(u, v, w) >= -1e-6) heights.push(a!.y * u + b!.y * v + c!.y * w);
      }
      expect(heights.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-6);
    }
    geometry.dispose();
  }
});
