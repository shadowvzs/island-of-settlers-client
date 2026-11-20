import type { IndigenousBuildingMotif } from "../../../render-common/buildings/indigenous-building-motifs";
import { artEllipse, artLine, artPath, artPolygon, artRing } from "./indigenous-cave-art-primitives";

const ROCK = [[-.78,.55],[-.86,-.03],[-.47,-.65],[.18,-.72],[.79,-.24],[.72,.59],[-.78,.55]] as const;
const block = (x:number,y:number) => artPath(x,y,[[-.75,-.65],[.75,-.65],[.75,.65],[-.75,.65],[-.75,-.65]],.045);

/** Every resource has its own silhouette/internal marks, so hue is never the identifier. */
export const indigenousCaveMineral = (motif: IndigenousBuildingMotif, x:number,y:number) => {
  if (motif === "coal") return [[-.39,.28,.42],[.39,.30,.39],[0,-.36,.40]].some(([cx,cy,r]) =>
    artPolygon((x-cx!)/r!,(y-cy!)/r!,[[-.9,.65],[-1,-.1],[-.32,-.9],[.5,-.75],[1,.24],[.62,.85]]));
  if (motif === "iron") return artPath(x,y,ROCK,.05) ||
    artPath(x,y,[[-.63,.25],[-.20,-.12],[.06,-.06],[.57,-.43]],.06) ||
    artPath(x,y,[[-.38,.46],[.10,.17],[.39,.24],[.64,.03]],.04);
  if (motif === "gold") {
    if (artPath(x,y,ROCK,.045)) return true;
    return [[-.36,.1],[.27,-.23],[.35,.32]].some(([cx,cy]) =>
      artRing(x,y,cx!,cy!,.13,.04) || artLine(x,y,[cx!-.05,cy!],[cx!+.05,cy!],.025));
  }
  if (motif === "marble") return block(x,y) || [-.3,.06,.38].some(cy =>
    Math.abs(y-cy-Math.sin(x*5+cy)*.12)<.03 && Math.abs(x)<.7);
  if (motif === "limestone") return block(x,y) ||
    [-.35,.35].some(cy=>artLine(x,y,[-.7,cy],[.7,cy],.025)) ||
    [0,.18,.36].some(radius=>Math.abs(Math.hypot(x,y+.03)-(.10+radius))<.025 && y<.13);
  if (motif === "basalt") return [-.5,0,.5].some(cx => artPath(x,y,
    [[cx-.2,-.52],[cx,-.68],[cx+.2,-.52],[cx+.2,.58],[cx,.73],[cx-.2,.58],[cx-.2,-.52]],.035) ||
    artLine(x,y,[cx,-.36],[cx,.63],.025));
  if (motif === "granite") return artPath(x,y,ROCK,.05) ||
    [[-.43,.21],[-.39,-.18],[.03,-.4],[.44,-.06],[.27,.35],[-.1,.23]].some(([cx,cy]) =>
      artEllipse(x,y,cx!,cy!,.055,.075));
  return false;
};
