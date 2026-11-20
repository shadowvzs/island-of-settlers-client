import { CATAPULT_SHAFT_HEIGHT } from "../../../render-common/buildings/catapult-dimensions";

export type RubblePoint=readonly[number,number];
export interface RubbleCell { outline:RubblePoint[]; seed:number }
const cache=new Map<boolean,RubbleCell[]>();
export const rubbleRandom=(seed:number)=>{const value=Math.sin(seed*17.713+8.51)*43758.5453;return value-Math.floor(value);};
const WIDTH=Math.PI*2*.83,HEIGHT=CATAPULT_SHAFT_HEIGHT;
export const clipRubbleCell=(polygon:RubblePoint[],a:number,b:number,c:number)=>{
  const output:RubblePoint[]=[];
  for(let i=0;i<polygon.length;i++){
    const start=polygon[i]!,end=polygon[(i+1)%polygon.length]!;
    const from=a*start[0]+b*start[1]-c,to=a*end[0]+b*end[1]-c;
    if(from<=1e-9)output.push(start);
    if((from<0)!==(to<0)){
      const t=from/(from-to);output.push([start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t]);
    }
  }
  return output;
};
/** Periodic irregular fitted polygons: varied rubble proportions, no uniform slab courses. */
export const indigenousRubbleCells=(detailed:boolean):readonly RubbleCell[]=>{
  const cached=cache.get(detailed);if(cached)return cached;
  const columns=detailed?11:10,rows=detailed?10:7,sites:RubblePoint[]=[];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const seed=row*columns+column;
    sites.push([(column+.5+(rubbleRandom(seed+2)-.5)*.86)*WIDTH/columns,
      (row+.5+(rubbleRandom(seed+17)-.5)*.87)*HEIGHT/rows]);
  }
  const periodic=sites.flatMap((site,seed)=>[-WIDTH,0,WIDTH].map(shift=>({seed,point:[site[0]+shift,site[1]] as RubblePoint})));
  const cells:RubbleCell[]=[];
  for(const {point:site,seed} of periodic){
    let polygon:RubblePoint[]=[[0,0],[WIDTH,0],[WIDTH,HEIGHT],[0,HEIGHT]];
    for(const {point:other} of periodic){
      if(site===other)continue;
      const a=2*(other[0]-site[0]),b=2*(other[1]-site[1]);
      const c=other[0]**2+other[1]**2-site[0]**2-site[1]**2;
      polygon=clipRubbleCell(polygon,a,b,c);if(polygon.length<3)break;
    }
    if(polygon.length>=3)cells.push({outline:polygon,seed});
  }
  cache.set(detailed,cells);return cells;
};
