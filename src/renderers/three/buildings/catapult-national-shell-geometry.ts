import { BufferGeometry, Float32BufferAttribute } from "three";

import { CATAPULT_SHAFT_HEIGHT } from "../../../render-common/buildings/catapult-dimensions";
import { catapultShellInnerRadius, type CatapultShellNation,catapultShellOuterRadius, catapultShellVoid }
  from "../../../render-common/buildings/catapult-national-shell-profile";
import { chineseCatapultRoundReveal, cutChineseCatapultRoundWindow } from "./catapult-round-window-aperture";

type Point=readonly[number,number,number];
const H=CATAPULT_SHAFT_HEIGHT,DIAMETER=1.7;

/** Real recessed grey binder, pinning the fitted frame/reveal seats and the protected inner room. */
const binderRadius=(angle:number,y:number,centre=false)=>{
  const outer=catapultShellOuterRadius("indigenous",angle,y),inner=catapultShellInnerRadius("indigenous",angle,y);
  const x=Math.sin(angle),z=Math.cos(angle);
  const doorway=z>.84&&Math.abs(x)<.46&&y<1.10;
  const window=Math.abs(x)>.87&&z>-.38&&z<.20&&y>1.72&&y<2.17;
  if(doorway||window)return outer;
  const irregular=.5+.23*Math.sin(angle*17.3+y*11.1)+.19*Math.sin(angle*9.7-y*23.2);
  const inset=.008+irregular*.016+(centre?.010:0);
  return outer-Math.min(Math.max(0,outer-inner-.008),inset);
};

/** Closed national wall sections with actual entry/window voids and a connected upper hatch buttress. */
export const createCatapultNationalShell=(nation:CatapultShellNation,detailed:boolean,band?:[number,number])=>{
  let segments=detailed?48:16;
  if(!detailed&&nation==="indigenous")segments=8;
  const angles=Array.from({length:segments+1},(_,i)=>i/segments*Math.PI*2);
  // Inner square and NW hatch corners are exact in both LODs; a coarse chord must not cut them off.
  for(let corner=0;corner<=8;corner++)angles.push(corner*Math.PI/4);
  const bounds=[Math.asin(.345),Math.acos(.095),Math.acos(-.30)];
  for(const angle of bounds)angles.push(angle,Math.PI*2-angle);
  const unique=(values:number[])=>values.sort((a,b)=>a-b).filter((value,index,array)=>
    index===0||value-array[index-1]!>1e-8);
  const knots=unique(angles);
  const levels=band??unique([0,.86,H-.90,H-.70,1.785,2.105,H]);
  const base=band?.[0]??0,height=band?band[1]-band[0]:H;
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const point=(angle:number,y:number,inner:boolean):Point=>{
    let radius=(inner?catapultShellInnerRadius:catapultShellOuterRadius)(nation,angle,y);
    if(nation==="indigenous"&&!band&&!inner)radius=binderRadius(angle,y);
    if(band)radius=catapultShellOuterRadius(nation,angle,y)+(inner?-.018:.012);
    return [Math.sin(angle)*radius,y,Math.cos(angle)*radius];
  };
  const polygonFace=(points:Point[],normal:Point)=>{
    const start=positions.length/3;
    for(const p of points) {
      positions.push(p[0]/DIAMETER,(p[1]-base)/height-.5,p[2]/DIAMETER);
      uvs.push(Math.atan2(p[0],p[2])*.82,p[1]);
    }
    for(let index=1;index<points.length-1;index++) {
      const a=points[0]!,b=points[index]!,c=points[index+1]!;
      const u=b.map((value,axis)=>value-a[axis]!),v=c.map((value,axis)=>value-a[axis]!);
      const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
      if(Math.hypot(...cross)<1e-8)continue;
      const dot=cross.reduce((sum,value,axis)=>sum+value*normal[axis]!,0);
      if(dot>=0)indices.push(start,start+index,start+index+1);
      else indices.push(start,start+index+1,start+index);
    }
  };
  const face=(points:Point[],normal:Point)=>{
    const polygons=nation==="chinese"&&!band?cutChineseCatapultRoundWindow(points,detailed):[points];
    for(const polygon of polygons)polygonFace(polygon,normal);
  };
  const filled=(angle:number,y:number)=>!catapultShellVoid(angle,y);
  for(let column=0;column<knots.length-1;column++) {
    const a=knots[column]!,b=knots[column+1]!;
    const previous=column===0?(knots.at(-2)!+Math.PI*2)/2-Math.PI*2:(knots[column-1]!+a)/2;
    const next=column===knots.length-2?knots[1]!/2:(b+knots[column+2]!)/2;
    let columnLevels=levels;
    if(nation==="chinese"&&!band) {
      // Plain rear/front wall planes need no copies at unrelated doorway/window heights.
      // Keep every local opening/reveal boundary and the exact upper NW hatch transitions.
      const nearby=[previous,(a+b)/2,next],values=[0,H];
      if(nearby.some(angle=>catapultShellVoid(angle,.4)==="door"))values.push(.86);
      if(nearby.some(angle=>catapultShellVoid(angle,1.9)==="window"))values.push(1.785,2.105);
      if([a,b,(a+b)/2].some(angle=>Math.sin(angle)<0&&Math.cos(angle)<0))values.push(H-.90,H-.70);
      columnLevels=unique(values);
    }
    for(let row=0;row<columnLevels.length-1;row++) {
    const low=columnLevels[row]!,high=columnLevels[row+1]!;
    const angle=(a+b)/2,y=(low+high)/2;
    if(!filled(angle,y))continue;
    const outward:Point=[Math.sin(angle),0,Math.cos(angle)];
    const outer=[point(a,low,false),point(b,low,false),point(b,high,false),point(a,high,false)];
    const inner=[point(a,low,true),point(b,low,true),point(b,high,true),point(a,high,true)];
    // Indigenous continuous irregular masonry owns the exterior; retain inner wall/reveals.
    if(nation!=="indigenous"||band)face(outer,outward);
    // Attached bands overlap the existing load-bearing wall. Their inward face is entirely
    // buried in that wall; retain their outside and edge thickness without drawing hidden faces.
    if(!band)face(inner,[-outward[0],0,-outward[2]]);
    if(row===0||!filled(angle,(columnLevels[row-1]!+low)/2))
      face([outer[0]!,outer[1]!,inner[1]!,inner[0]!],[0,-1,0]);
    if(row===columnLevels.length-2||!filled(angle,(high+columnLevels[row+2]!)/2))
      face([outer[3]!,outer[2]!,inner[2]!,inner[3]!],[0,1,0]);
    if(!filled(previous,y))face([outer[0]!,inner[0]!,inner[3]!,outer[3]!],[-Math.cos(a),0,Math.sin(a)]);
    if(!filled(next,y))face([outer[1]!,inner[1]!,inner[2]!,outer[2]!],[Math.cos(b),0,-Math.sin(b)]);
    }
  }
  if(nation==="chinese"&&!band)for(const reveal of chineseCatapultRoundReveal(detailed)) {
    const middleX=(reveal[0]![0]+reveal[1]![0])/2;
    const middleY=(reveal[0]![1]+reveal[1]![1])/2-1.49;
    polygonFace(reveal,[-middleX,-middleY,0]);
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
};
