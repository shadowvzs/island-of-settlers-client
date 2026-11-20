import { HARBOUR_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingPart } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { chineseHarbourBuriedTowerWindows } from "./chinese-harbour-roof";
import type { NationBody } from "./nation-kit-classify";

/** The old Roman gable pane cannot stay in the air above a new closed Chinese hip roof. */
export const chineseObsoleteAtticWindows = (body:NationBody,typeId:number) => {
  if(typeId===HARBOUR_TYPE_ID)return chineseHarbourBuriedTowerWindows(body);
  if(typeId!==37)return new Set<BuildingPart>();
  const top=Math.max(...body.walls.map(wall=>wall.max[1]));
  const panes=body.keep.filter(part=>!part.stock&&part.surface==="dark"&&part.size[1]>.15&&
    Math.min(part.size[0],part.size[2])<.04&&getRomanPartBounds(part).min[1]>top+.025);
  const removed=new Set<BuildingPart>(panes);
  for(const part of body.keep) {
    if(part.stock||!["wood","planks"].includes(part.surface))continue;
    const bounds=getRomanPartBounds(part);
    if(panes.some(pane=>{
      const opening=getRomanPartBounds(pane);
      return [0,1,2].every(axis=>bounds.min[axis]!>=opening.min[axis]!-.085&&
        bounds.max[axis]!<=opening.max[axis]!+.085);
    }))removed.add(part);
  }
  return removed;
};
