import type { BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

/** Two real ground places per input: delivery must not clamp the second unit onto the first. */
export const withChineseTeaInputBays=(recipe:BuildingRecipe):BuildingRecipe=>{
  const raw=recipe.parts.find(part=>part.stock?.kind==="input"&&part.stock.wares?.includes("teaLeaves"));
  const water=recipe.parts.filter(part=>part.stock?.kind==="input"&&part.stock.ware==="water");
  if(!raw||!water.length)return recipe;
  const waterBounds=water.map(part=>getRomanPartBounds(part));
  const waterX=(Math.min(...waterBounds.map(b=>b.min[0]))+Math.max(...waterBounds.map(b=>b.max[0])))/2;
  const parts=recipe.parts.filter(part=>part.stock?.kind!=="input");
  for(let slot=0;slot<2;slot++) {
    parts.push({shape:"box",surface:"paint",stage:3,size:[.10,.025,.10],
      position:[.72+slot*.30,.0125,-.34],stock:{...raw.stock!,ware:"teaLeaves",slot}});
    parts.push({shape:"box",surface:"paint",stage:3,size:[.10,.025,.10],
      position:[waterX,.0125,-.52+slot*.29],stock:{...water[0]!.stock!,slot}});
  }
  return {...recipe,parts};
};
