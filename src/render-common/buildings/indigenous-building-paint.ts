import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart,BuildingRecipe } from "./building-recipe";
import { indigenousBuildingMotif } from "./indigenous-building-motifs";
import { indigenousFisherPaintCloth } from "./indigenous-fisher-paint-cloth";
import { indigenousDrinkPainting, indigenousFrontPainting } from "./indigenous-front-paint";
import { indigenousQuarryPainting } from "./indigenous-quarry-painting";

/** Exactly one ample actual textile carries the owner's occupation-specific brown painting. */
export const withIndigenousBuildingPaint=(recipe:BuildingRecipe,typeId:number,nation:WorkerNation):BuildingRecipe=>{
  if(nation!=="indigenous")return recipe;
  const motif=indigenousBuildingMotif(typeId);if(!motif)return recipe;
  if ([19, 43, 47, 51, 55].includes(typeId)) {
    const painting = indigenousQuarryPainting(recipe, motif);
    return painting ? { ...recipe, parts: [...recipe.parts, painting] } : recipe;
  }
  if (typeId === 6) {
    const painting = indigenousDrinkPainting(recipe);
    return painting ? { ...recipe, parts: [...recipe.parts, painting] } : recipe;
  }
  let added: BuildingPart[] = [];
  if (typeId === 18) added = indigenousFisherPaintCloth(recipe);
  if (typeId === 37) added = indigenousFisherPaintCloth(recipe, "right");
  const skins=[...recipe.parts,...added].filter(part=>(part.shape==="indigenous-roof"||part.shape==="cloth-panel")&&!part.stock&&
    (part.shape === "cloth-panel" ||
    part.size[1]>.5&&(part.surface.startsWith("cloth")||part.surface.startsWith("hide"))));
  let candidates = skins;
  if (typeId === 18 || typeId === 37) candidates = added.filter(part => part.shape === "cloth-panel");
  if (typeId === 9) candidates = skins.filter(part => part.indigenousRoof === "framed" && part.position[2] > .5);
  const skin=candidates.sort((a,b)=>b.size[0]*b.size[1]*b.size[2]-a.size[0]*a.size[1]*a.size[2])[0];
  if(!skin)return recipe;
  const framed=skin.indigenousRoof==="framed";
  // Avoid the armourer's right-hand anvil and the metalworker's left-hand tool rack.
  let u = .17, width = .085;
  if (framed) { u = .125; width = .08; }
  if (typeId === 24) { u = .82; width = .07; }
  if (typeId === 25) { u = .09; width = .045; }
  const circumference=framed?(skin.size[0]+skin.size[2])*2:Math.PI*(skin.size[0]+skin.size[2])/2*.53;
  const aspect=["bison","fish","people2","people3","people4","tools"].includes(motif)?1.45:1.1;
  const height=Math.max(.10,Math.min(.20,circumference*width/(skin.size[1]*aspect)));
  const painting:BuildingPart=indigenousFrontPainting(recipe, skin, typeId, motif) ?? {...skin,shape:"indigenous-pigment",surface:"paint",worldUv:undefined,
    tint:[1,1,1],architecture:true,indigenousPigment:motif,
    indigenousPigmentRegion:skin.shape === "cloth-panel" ? [.5,.5,.46,.46] : [u,.53,width,height]};
  // Older illustrated hide styles must not leave unrelated figures beneath the new uniform brown art.
  const parts=recipe.parts.map(part=>part===skin&&part.surface.startsWith("hide-")?
    {...part,surface:"hide" as const}:part);
  return {...recipe,parts:[...parts,...added,painting]};
};
