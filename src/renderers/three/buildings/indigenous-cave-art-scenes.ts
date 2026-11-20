import type { IndigenousBuildingMotif } from "../../../render-common/buildings/indigenous-building-motifs";
import { indigenousBerryDrink, indigenousEagle, indigenousPigHead } from "./indigenous-cave-art-animals";
import { artAxe, artEllipse, artLine, artMountain, artPath, artPolygon, artRing, artWheat } from "./indigenous-cave-art-primitives";
import { indigenousWatchfulOwl } from "./indigenous-watchful-owl";

const bison = (x: number, y: number) => {
  const body = artEllipse(x, y, -.14, -.02, .56, .28) || artEllipse(x, y, .10, -.19, .32, .27);
  const head = artEllipse(x, y, .58, -.02, .20, .20) || artPolygon(x, y, [[.4,.12],[.62,.34],[.7,.12]]);
  if ((body || head) && !artEllipse(x, y, .65, -.09, .035, .035)) return true;
  if (artPath(x,y,[[.63,-.16],[.78,-.34],[.72,-.36]],.035)) return true;
  for (const px of [-.53, -.26, .15, .42]) if (artPath(x, y, [[px,.15],[px-.025,.48],[px+.08,.49]], .045)) return true;
  return artLine(x,y,[-.64,-.06],[-.83,-.19],.035) || artLine(x,y,[-.95,.67],[.94,.67],.025) ||
    [-.8,-.59,-.04,.31,.78].some(px => artPath(x,y,[[px-.045,.66],[px,.55],[px+.055,.66]],.02));
};
const fish = (x: number, y: number) => {
  const body = artEllipse(x,y,.08,-.2,.55,.23) || artPolygon(x,y,[[-.39,-.2],[-.79,-.49],[-.79,.09]]);
  if (body && !artEllipse(x,y,.40,-.25,.045,.045)) return true;
  return [.3,.52,.74].some(cy => Math.abs(y-cy-Math.sin(x*9)*.045)<.028 && Math.abs(x)<.91);
};
const trees = (x: number, y: number) => [-.62,0,.62].some((cx,index) => {
  const peak = index === 1 ? -.77 : -.52, width = index === 1 ? .37 : .30;
  return artLine(x,y,[cx,peak],[cx,.72],.035) || [0,.25,.48].some(dy =>
    artPolygon(x,y,[[cx,peak+dy],[cx-width,peak+dy+.38],[cx+width,peak+dy+.38]]));
});
const people = (x: number, y: number, count: number) => {
  for (let person=0;person<count;person++) {
    const cx=(person-(count-1)/2)*(.0+1.4/count), width=.45/count;
    if (artEllipse(x,y,cx,-.48,.105,.12) || artLine(x,y,[cx,-.32],[cx,.23],.055)) return true;
    if (artPath(x,y,[[cx-width,.66],[cx,.23],[cx+width,.66]],.04)) return true;
    if (artPath(x,y,[[cx-width*1.6,-.02],[cx,-.17],[cx+width*1.6,-.02]],.04)) return true;
  }
  return false;
};
const headdress = (x: number, y: number) => {
  if (artPath(x,y,[[-.48,.15],[-.24,.02],[.24,.02],[.48,.15]],.055) || artEllipse(x,y,0,.35,.21,.26)) return true;
  for(let feather=0;feather<7;feather++) {
    const angle=(feather-3)*.23, sx=Math.sin(angle), sy=-Math.cos(angle);
    const centreX=sx*.58, centreY=.03+sy*.58;
    const along=(x-centreX)*sx+(y-centreY)*sy;
    const across=(x-centreX)*-sy+(y-centreY)*sx;
    if ((along/.27)**2+(across/.07)**2<1 && Math.abs(across)>.018) return true;
    if (artLine(x,y,[sx*.27,.03+sy*.27],[sx*.85,.03+sy*.85],.018)) return true;
  }
  return false;
};
const tools = (x:number,y:number) => artAxe((x+.58)*1.8,y) ||
  artLine(x,y,[0,.7],[0,-.55],.04) || artLine(x,y,[-.18,-.55],[.20,-.55],.09) ||
  artPath(x,y,[[.53,.65],[.64,-.13],[.43,-.53]],.04) || artPath(x,y,[[.83,.65],[.64,-.13],[.84,-.53]],.04);

export const indigenousCaveScene = (motif: IndigenousBuildingMotif, x: number, y: number): boolean => {
  if (motif === "watchful-owl") return indigenousWatchfulOwl(x, y);
  if (motif === "pig-head") return indigenousPigHead(x, y);
  if (motif === "eagle") return indigenousEagle(x, y);
  if (motif === "berry-drink") return indigenousBerryDrink(x, y);
  if (motif === "bison") return bison(x,y);
  if (motif === "fish") return fish(x,y);
  if (motif === "trees") return trees(x,y);
  if (motif === "mountains") return artMountain(x,y);
  if (motif === "axe") return artAxe(x,y);
  if (motif === "tools") return tools(x,y);
  if (motif === "wheat") return artWheat(x,y);
  if (motif === "headdress") return headdress(x,y);
  if (motif === "people2") return people(x,y,2);
  if (motif === "people3") return people(x,y,3);
  if (motif === "people4") return people(x,y,4);
  if (motif === "volcano") return artPath(x,y,[[-.85,.70],[-.28,-.32],[.25,-.32],[.85,.70]],.05) ||
    artLine(x,y,[-.28,-.32],[.25,-.32],.04) || [-.18,.07,.24].some(cx=>
      artPath(x,y,[[cx,-.39],[cx-.08,-.54],[cx+.06,-.69],[cx-.02,-.85]],.035));
  if (motif === "fortress") return artRing(x,y,0,0,.48,.055) || artPolygon(x,y,[[-.2,.3],[0,-.4],[.2,.3]]);
  return false;
};
