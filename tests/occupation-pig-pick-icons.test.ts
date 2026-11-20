import {expect,it} from "vitest";

import {getBuildingDefinition} from "../src/render-common/buildings/building-catalog";
import {createBuildingOccupationSymbolSvg} from "../src/render-common/buildings/building-occupation-symbol";
import {createRomanBuildingRecipe} from "../src/render-common/buildings/building-recipe";
it.each([true,false])("draws a pig head with paired nostrils, eyes and pointed ears (detail=%s)", detailed=>{
  const parts=createRomanBuildingRecipe(getBuildingDefinition(28),detailed).parts;
  expect(parts.filter(part=>part.shape==="paint-triangle")).toHaveLength(6);
  const nostrils=parts.filter(part=>part.shape==="paint-ellipse"&&part.size[0]===.009&&part.size[1]===.015);
  expect(nostrils).toHaveLength(2);expect(Math.abs(nostrils[0]!.position[0]-nostrils[1]!.position[0])).toBeCloseTo(.034);
  expect(parts.filter(part=>part.shape==="paint-ellipse"&&part.size[0]===.014&&part.size[1]===.016)).toHaveLength(2);
  const svg=createBuildingOccupationSymbolSvg(getBuildingDefinition(28));expect(svg).toContain("<ellipse");expect(svg).toContain("<polygon");
});
it("draws a perpendicular straight pickaxe with opposing points, distinct from the farmer",()=>{
  const parts=createRomanBuildingRecipe(getBuildingDefinition(19),true).parts;
  const handle=parts.find(part=>part.shape==="paint-stroke"&&part.size[0]===.018&&part.size[1]===.123)!;
  const head=parts.find(part=>part.shape==="paint-stroke"&&part.size[0]===.117&&part.size[1]===.021)!;
  expect(handle.rotation?.[2]??0).toBe(0);expect(head.rotation?.[2]??0).toBe(0);
  expect(head.position[0]).toBeCloseTo(handle.position[0]);
  expect(parts.filter(part=>part.shape==="paint-triangle").map(part=>part.rotation![2])).toEqual([Math.PI/2,Math.PI/2,-Math.PI/2,-Math.PI/2]);
  expect(createBuildingOccupationSymbolSvg(getBuildingDefinition(19))).not.toBe(createBuildingOccupationSymbolSvg(getBuildingDefinition(37)));
});
