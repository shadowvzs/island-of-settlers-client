import { expect, it } from "vitest";

import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { createChineseWallFanGeometry, createChineseWallFanMaterial } from "../src/renderers/three/buildings/chinese-wall-fan";

it.each([true,false])("has genuine raised radial folds and ribs within the available wall panel (%s)", detailed=>{
  const geometry=createChineseWallFanGeometry(detailed),position=geometry.getAttribute("position");
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.max.z-geometry.boundingBox!.min.z).toBeGreaterThan(.5);
  const xDepths=new Set(Array.from({length:position.count},(_,i)=>position.getZ(i).toFixed(3)));
  expect(xDepths.size).toBeGreaterThan(8);
  const parts=createCatapultTowerRecipe("chinese",detailed).parts;
  expect(parts.filter(part=>part.shape==="chinese-wall-fan")).toHaveLength(1);
  expect(parts.some(part=>part.position[1]===1.56&&part.shape==="cylinder"&&part.surface==="iron")).toBe(false);
  const fan=parts.find(part=>part.shape==="chinese-wall-fan")!;
  expect(fan.position[1]-fan.size[1]/2).toBeGreaterThan(1.3);
  expect(fan.position[1]+fan.size[1]/2).toBeLessThan(1.85);
  geometry.dispose();
});

it("shares one owned painting until the last fan material is released",()=>{
  const a=createChineseWallFanMaterial(),b=createChineseWallFanMaterial();
  expect(a.map).toBe(b.map);
  const texture=a.map!;let disposals=0;
  texture.addEventListener("dispose",()=>disposals++);
  a.dispose();expect(disposals).toBe(0);
  b.dispose();expect(disposals).toBe(1);
});
