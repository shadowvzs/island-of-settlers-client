import type { BuildingPart,BuildingRecipe,Point3 } from "./building-recipe";

export interface YaguraWallOpening { axis:0|2; sign:1|-1; width:number; bottom:number; top:number }

/** Only thin horizontal dressing rails are cut; load-bearing posts and the true frame remain. */
export const clearYaguraWindowRails=(recipe:BuildingRecipe,members:readonly BuildingPart[]=recipe.parts):BuildingRecipe=>{
  const panes=recipe.parts.filter(part=>part.windowShadow&&!part.doorwayShadow);
  const parts=members.flatMap(part=>{
    if(part.stock||!["wood","planks"].includes(part.surface)||!(["box","bevel-box"].includes(part.shape))||
      part.rotation||part.size[1]>.12)return [part];
    let pieces=[part];
    for(const pane of panes) {
      const opening=pane.windowOpeningPosition??pane.position,size=pane.windowOpeningSize??pane.size;
      const across=size[0]<size[2]?0:2,along=across===0?2:0;
      if(part.size[across]>.20||part.size[along]<.3)continue;
      pieces=pieces.flatMap(piece=>{
        if(Math.abs(piece.position[across]-opening[across])>(piece.size[across]+.08)/2||
          Math.abs(piece.position[1]-opening[1])>size[1]/2+piece.size[1]/2)return[piece];
        const low=piece.position[along]-piece.size[along]/2,high=piece.position[along]+piece.size[along]/2;
        const left=opening[along]-size[along]/2,right=opening[along]+size[along]/2;
        if(high<=left||low>=right)return[piece];
        return [[low,Math.min(high,left)],[Math.max(low,right),high]].filter(([a,b])=>b!-a!>.004)
          .map(([a,b])=>{const position:Point3=[...piece.position],dimensions:Point3=[...piece.size];
            position[along]=(a!+b!)/2;dimensions[along]=b!-a!;return{...piece,position,size:dimensions};});
      });
    }
    return pieces;
  });
  return {...recipe,parts};
};
