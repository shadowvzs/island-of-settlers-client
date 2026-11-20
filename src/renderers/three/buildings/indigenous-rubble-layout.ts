import { CATAPULT_SHAFT_HEIGHT } from "../../../render-common/buildings/catapult-dimensions";
import { catapultShellVoid } from "../../../render-common/buildings/catapult-national-shell-profile";
import { indigenousRubbleCells, type RubblePoint, rubbleRandom } from "./indigenous-rubble-cells";
import { indigenousRubbleStone, type RubbleSurface } from "./indigenous-rubble-stones";

const cache=new Map<boolean,readonly RubbleSurface[]>();
const depthAt=(surface:RubbleSurface,point:RubblePoint)=>{
  let depth=-Infinity;
  for(let index=1;index<surface.length-1;index++){
    const a=surface[0]!,b=surface[index]!,c=surface[index+1]!;
    const x=b.point[0]-a.point[0],y=b.point[1]-a.point[1];
    const u=c.point[0]-a.point[0],v=c.point[1]-a.point[1],area=x*v-y*u;
    if(Math.abs(area)<1e-10)continue;
    const px=point[0]-a.point[0],py=point[1]-a.point[1];
    const first=(px*v-py*u)/area,second=(x*py-y*px)/area;
    if(first<0||second<0||first+second>1)continue;
    depth=Math.max(depth,a.depth+(b.depth-a.depth)*first+(c.depth-a.depth)*second);
  }
  return depth;
};

/** Small physical packing stones are seated only in measured gaps between the actual large rocks. */
export const indigenousRubbleSurfaces=(detailed:boolean):readonly RubbleSurface[]=>{
  const cached=cache.get(detailed);if(cached)return cached;
  const cells=indigenousRubbleCells(detailed),surfaces=cells.flatMap(cell=>indigenousRubbleStone(cell,detailed?80:20));
  const unique=new Map<string,RubblePoint>();
  for(const {outline} of cells)for(const point of outline){
    if(point[1]<.07||point[1]>CATAPULT_SHAFT_HEIGHT-.07||catapultShellVoid(point[0]/.83,point[1]))continue;
    unique.set(point.map(value=>value.toFixed(4)).join(":"),point);
  }
  const candidates=[...unique.values()].map(point=>({point,depth:surfaces.reduce((value,surface)=>
    Math.max(value,depthAt(surface,point)),-Infinity)})).filter(value=>value.depth<-.055)
    .sort((a,b)=>a.depth-b.depth);
  const selected:RubblePoint[]=[],limit=detailed?70:28;
  for(const {point} of candidates){
    if(selected.length>=limit)break;
    if(selected.some(other=>Math.hypot(point[0]-other[0],point[1]-other[1])<.13))continue;
    const seed=1000+selected.length,width=.095+rubbleRandom(seed)*.035,height=.075+rubbleRandom(seed+1)*.035;
    const outline:RubblePoint[]=[[point[0]-width/2,point[1]-height/2],[point[0]+width/2,point[1]-height/2],
      [point[0]+width/2,point[1]+height/2],[point[0]-width/2,point[1]+height/2]];
    surfaces.push(...indigenousRubbleStone({outline,seed},8));selected.push(point);
  }
  cache.set(detailed,surfaces);return surfaces;
};
