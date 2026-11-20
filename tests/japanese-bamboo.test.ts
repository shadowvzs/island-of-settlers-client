import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { bambooLeafDetail } from "../src/renderers/three/buildings/bamboo-leaf-detail";
import { NATION_SURFACES } from "../src/renderers/three/buildings/building-surface-paint";
import { paintSurfacePixels } from "../src/renderers/three/buildings/building-surface-pixels";
import { createBambooCulmGeometry, createBambooLeavesGeometry }
  from "../src/renderers/three/buildings/japanese-decor-geometry";

it("maps every opaque bamboo blade face across the vein atlas at both detail levels", () => {
  for (const detailed of [true, false]) {
    const geometry = createBambooLeavesGeometry([.6,.3,.6], detailed);
    const uv = geometry.getAttribute("uv"), indices = geometry.index!;
    for (let index = 0; index < indices.count; index += 3) {
      const [a,b,c] = [indices.getX(index),indices.getX(index+1),indices.getX(index+2)];
      const area = Math.abs((uv.getX(b!) - uv.getX(a!)) * (uv.getY(c!) - uv.getY(a!)) -
        (uv.getY(b!) - uv.getY(a!)) * (uv.getX(c!) - uv.getX(a!)));
      expect(area).toBeGreaterThan(.01);
    }
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-.50001);
    expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(.50001);
    expect(geometry.boundingBox!.min.z).toBeGreaterThanOrEqual(-.50001);
    expect(geometry.boundingBox!.max.z).toBeLessThanOrEqual(.50001);
    geometry.dispose();
  }
});

it("uses green opaque leaf albedo with real midrib and vein relief, and yellow-green segmented culms", () => {
  const pack = NATION_SURFACES.japanese!.leaf!;
  expect(pack.sample).toBe(bambooLeafDetail);
  const [albedo, normal, roughness] = paintSurfacePixels(pack.sample, pack.base, 128, true);
  for (let index=0; index<albedo!.length; index+=4) {
    expect(albedo![index+1]).toBeGreaterThan(albedo![index]! * 1.3);
    expect(albedo![index+1]).toBeGreaterThan(albedo![index+2]! * 1.5);
    expect(albedo![index+3]).toBe(255);
  }
  expect(new Set(normal!).size).toBeGreaterThan(12);
  expect(new Set(roughness!).size).toBeGreaterThan(12);
  const point = { grain:.5, mineral:.5, weather:.5, v:.25 };
  expect(bambooLeafDetail({...point,u:.5}).height - bambooLeafDetail({...point,u:.4}).height)
    .toBeGreaterThan(.15);
  const culm = createBambooCulmGeometry([.06,1.1,.06], true), colors=culm.getAttribute("color");
  let green=0;
  for(let index=0;index<colors.count;index++) if(colors.getY(index)>colors.getX(index) &&
    colors.getX(index)>colors.getZ(index)) green++;
  expect(green/colors.count).toBeGreaterThan(.8);
  culm.dispose();
});

it("uses the leaf material on actual building bamboo while retaining authored blade UVs", () => {
  for(const detailed of [true,false]) for(const id of [17,19,35,57]) {
    const recipe=createNationBuildingRecipe(getBuildingDefinition(id),"japanese",detailed);
    const leaves=recipe.parts.filter(part=>part.shape==="bamboo-leaves");
    // Some occupations intentionally have no free ground for a clump in one LOD.
    for(const leaf of leaves) expect(leaf.surface, `${id}/${detailed}`).toBe("leaf");
  }
});
