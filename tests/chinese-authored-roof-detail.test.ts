import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it.each([0,7,20])("retains actual High pan/cover tile geometry despite generic prop compact flags: Chinese%s",id=>{
  const recipe=createNationBuildingRecipe(getBuildingDefinition(id),"chinese",true);
  const roofs=recipe.parts.filter(part=>part.shape==="occupation-roof"&&part.roofTiles==="pan-cover");
  expect(roofs.length).toBeGreaterThan(0);
  for(const roof of roofs) {
    const high=createRomanPartGeometry({...roof,compactGeometry:true},true);
    const minimal=createRomanPartGeometry(roof,false);
    const count=(g:typeof high)=>(g.index?.count??g.getAttribute("position").count)/3;
    try {expect(count(high)).toBeGreaterThan(count(minimal)*2);}
    finally {high.dispose();minimal.dispose();}
  }
});
