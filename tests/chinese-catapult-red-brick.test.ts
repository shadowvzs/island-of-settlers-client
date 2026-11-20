import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { NATION_SURFACES, nationSurfaceResolution, surfacePaintKey } from "../src/renderers/three/buildings/building-surface-paint";
import { chineseRedBrickDetail } from "../src/renderers/three/buildings/chinese-red-brick-detail";

const pixel=(u:number,v:number)=>chineseRedBrickDetail({grain:.5,mineral:.5,u,v,weather:0});
it("has straight staggered fired-brick courses with neutral grey recessed joints",()=>{
  const brick=pixel(.5/3,.5/8),joint=pixel(0,.5/8),nextRow=pixel(0,1.5/8);
  const base=[160,91,72],rgb=joint.colour.map((value,index)=>value*base[index]!*joint.brightness);
  expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThan(6);
  expect(brick.height-joint.height).toBeGreaterThan(.1);
  expect(nextRow.height-joint.height).toBeGreaterThan(.1);
  expect(base[0]!*brick.colour[0]-base[1]!*brick.colour[1]).toBeGreaterThan(50);
});

it("restricts the brick surface to the Chinese Catapult and bounds the shared map sizes",()=>{
  expect(leveledBuildingRecipe(getBuildingDefinition(16),"chinese",false,1).parts
    .some(part=>part.surface==="chinese-red-brick")).toBe(true);
  for(const nation of ["roman","japanese","persian","nubian","maya","viking","indigenous"] as const)
    expect(leveledBuildingRecipe(getBuildingDefinition(16),nation,false,1).parts
      .some(part=>part.surface==="chinese-red-brick")).toBe(false);
  for(const id of [0,6,9,20,29,39])expect(leveledBuildingRecipe(getBuildingDefinition(id),"chinese",false,1).parts
    .some(part=>part.surface==="chinese-red-brick")).toBe(false);
  expect(NATION_SURFACES.chinese?.["chinese-red-brick"]?.sample).toBe(chineseRedBrickDetail);
  expect(nationSurfaceResolution("chinese","chinese-red-brick",true)).toBe(512);
  expect(nationSurfaceResolution("chinese","chinese-red-brick",false)).toBe(256);
  expect(surfacePaintKey({nation:"indigenous",surface:"indigenous-rubble",detailed:true,resolution:1024}))
    .toContain("rough-recessed-grey-binder-v2");
});
