import type { BuildingPart,BuildingRecipe,Point3 } from "./building-recipe";

type JambPart=BuildingPart&{bambooDoorJamb?:true};

/** One seated round jamb supports the lintel; duplicated facing below it would make a false front post. */
export const refineBambooForesterDoorway=(recipe:BuildingRecipe,detailed:boolean):BuildingRecipe=>{
  const parts=recipe.parts as JambPart[],jambs=parts.filter(part=>part.bambooDoorJamb);
  if(jambs.length!==2)return recipe;
  const width=recipe.doorDimensions?.width??.46;
  const replacements=new Map<BuildingPart,BuildingPart>();
  for(const jamb of jambs) {
    const left=jamb.position[0]<recipe.door[0]+width/2;
    // The hinge-side strap sweeps farther than the panel thickness when the door opens out.
    const position:Point3=[left?recipe.door[0]-.085:recipe.door[0]+width+.065,
      jamb.position[1],recipe.door[2]-.009];
    replacements.set(jamb,{...jamb,position,size:[.055,jamb.size[1],.055],radialSegments:detailed?10:4});
    const facing=parts.filter(part=>part.bambooSection==="facing"&&part.stage===1&&
      Math.abs(part.rotation?.[1]??0)<1e-6&&Math.abs(part.position[2]-(recipe.door[2]-.003))<.01)
      .sort((a,b)=>Math.abs(a.position[0]-position[0])-Math.abs(b.position[0]-position[0]))[0];
    if(!facing)continue;
    const top=facing.position[1]+facing.size[1]/2,bottom=jamb.position[1]+jamb.size[1]/2;
    if(top>bottom+.005)replacements.set(facing,{...facing,position:[facing.position[0],(top+bottom)/2,facing.position[2]],
      size:[facing.size[0],top-bottom,facing.size[2]]});
  }
  return {...recipe,parts:parts.map(part=>replacements.get(part)??part)};
};
