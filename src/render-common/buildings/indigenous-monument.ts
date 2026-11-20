import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { monumentRecipe } from "./monument-definition";
import { type Add, runBetween } from "./nation-kit-parts";

const CENTRE_Z = -.35;
const WALL_OUTER_RADIUS = 3.39;
const WALL_TOP = 1.39;
const ROOF_SIZE: Point3 = [7.30,5,7.30];
const ROOF_BASE = 1;

/** Umana Yana-inspired communal hall: continuous palm-trunk walls carry a monumental layered palm roof. */
export const indigenousMonumentRecipe = (detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = [];
  const add: Add = part => parts.push({ compactGeometry: true, stage: 2, ...part });
  add({ position:[0,.015,CENTRE_Z], radialSegments:detailed?64:24, shape:"cylinder",
    size:[7.4,.03,7.4], stage:1, surface:"straw" });
  const count=detailed?144:88, diameter=detailed?.155:.255;
  const wallRadius=WALL_OUTER_RADIUS-diameter/2;
  for(let index=0;index<count;index++) {
    const angle=index/count*Math.PI*2, x=Math.sin(angle)*wallRadius, z=Math.cos(angle)*wallRadius;
    if(Math.cos(angle)>.8 && Math.abs(x)<.62)continue;
    add({ position:[x,WALL_TOP/2,CENTRE_Z+z], radialSegments:detailed?7:4,
      shape:"cylinder", size:[diameter,WALL_TOP,diameter], stage:1, surface:"palm-trunk" });
  }
  // Continuous inner wall plates bind the low trunk wall; the lower course respects the clear doorway.
  const segments=detailed?48:24;
  for(let index=0;index<segments;index++) {
    const a=index/segments*Math.PI*2,b=(index+1)/segments*Math.PI*2;
    const point=(angle:number,y:number):Point3=>[Math.sin(angle)*3.25,y,CENTRE_Z+Math.cos(angle)*3.25];
    runBetween(add,point(a,1.37),point(b,1.37),[.13,.13],{surface:"wood"});
    if(Math.cos((a+b)/2)<.8 || Math.abs(Math.sin((a+b)/2)*3.25)>.72)
      runBetween(add,point(a,.14),point(b,.14),[.09,.09],{surface:"wood"});
  }
  for(const x of [-.64,.64]) add({position:[x,.68,CENTRE_Z+3.27],radialSegments:detailed?8:5,
    shape:"cylinder",size:[.17,1.36,.17],surface:"wood"});
  runBetween(add,[-.72,1.35,CENTRE_Z+3.16],[.72,1.35,CENTRE_Z+3.16],[.17,.17],{surface:"wood"});
  add({position:[0,ROOF_BASE+ROOF_SIZE[1]/2,CENTRE_Z],shape:"indigenous-palm-roof",
    size:ROOF_SIZE,stage:3,surface:"palm-thatch"});
  // Curved radial rafters follow the roof's real underside; none extend through the closed apex.
  const rafters=detailed?24:12, steps=detailed?6:3;
  const roofPoint=(angle:number,t:number):Point3=> {
    const radius=(.484*Math.pow(1-t,.86)+.005)*ROOF_SIZE[0]*.95;
    return [Math.sin(angle)*radius,ROOF_BASE+t*ROOF_SIZE[1]*.975-.025,CENTRE_Z+Math.cos(angle)*radius];
  };
  for(let index=0;index<rafters;index++) {
    const angle=index/rafters*Math.PI*2;
    for(let step=0;step<steps;step++) {
      const from=.085+.84*step/steps,to=.085+.84*(step+1)/steps;
      runBetween(add,roofPoint(angle,from),roofPoint(angle,to),[.09,.09],{surface:"wood"});
    }
  }
  // Interior posts and tied circular purlins give the great roof a credible load path.
  for(const t of detailed?[.12,.37,.64,.87]:[.12,.64]) {
    const rings=detailed?32:16;
    for(let index=0;index<rings;index++) runBetween(add,
      roofPoint(index/rings*Math.PI*2,t),roofPoint((index+1)/rings*Math.PI*2,t),[.07,.07],{surface:"wood"});
  }
  for(let index=0;index<8;index++) {
    const angle=(index+.5)/8*Math.PI*2, top=roofPoint(angle,.37);
    add({position:[top[0],top[1]/2,top[2]],radialSegments:detailed?8:4,
      shape:"cylinder",size:[.15,top[1],.15],stage:1,surface:"wood"});
  }
  // Plain communal benches stand inside the hall, leaving its entrance and central gathering floor open.
  for(const side of [-1,1]) {
    const x=side*2.1;
    add({position:[x,.37,CENTRE_Z-.2],shape:"bevel-box",size:[.40,.10,2.35],surface:"wood"});
    for(const z of [-.95,.55]) add({position:[x,.17,z],shape:"bevel-box",
      size:[.24,.34,.22],stage:1,surface:"wood"});
  }
  return {...monumentRecipe(),parts};
};
