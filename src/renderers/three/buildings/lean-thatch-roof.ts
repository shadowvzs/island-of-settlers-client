import { BufferGeometry, Float32BufferAttribute } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { MAYA_PLANT_ROOF_CORE_EDGE, MAYA_PLANT_ROOF_CORE_SCALE, MAYA_PLANT_ROOF_CORE_THICKNESS }
  from "../../../render-common/buildings/maya-plant-roof-profile";
import { createMayaThatchRoof } from "./maya-thatch-roof";

type Vertex = { position:number[]; uv:number[]; colour:number[] };
const interpolate = (a:Vertex,b:Vertex) => {
  const t=-a.position[0]!/(b.position[0]!-a.position[0]!);
  const mix=(x:number[],y:number[])=>x.map((value,index)=>value+(y[index]!-value)*t);
  return {position:mix(a.position,b.position),uv:mix(a.uv,b.uv),colour:mix(a.colour,b.colour)};
};

/** A genuine half-gable weather core, loose bundles and fringe, closed where it meets the wall. */
export const createLeanThatchRoof = (part:BuildingPart,detailed:boolean) => {
  const source=createMayaThatchRoof({...part,compactGeometry:part.roofCompactGeometry,occupationRoof:"gable",plantRoofStyle:part.plantRoofStyle??"reed"},detailed);
  const flat=source.index?source.toNonIndexed():source;
  const input=flat.getAttribute("position"),uv=flat.getAttribute("uv"),colour=flat.getAttribute("color");
  const positions:number[]=[],uvs:number[]=[],colours:number[]=[];
  const emit=(vertex:Vertex)=> {
    positions.push(vertex.position[0]!*2-.5,vertex.position[1]!,vertex.position[2]!);
    uvs.push(...vertex.uv);colours.push(...vertex.colour);
  };
  for(let index=0;index<input.count;index+=3) {
    const triangle:Vertex[]=Array.from({length:3},(_,corner)=>{
      const at=index+corner;
      return {position:[input.getX(at),input.getY(at),input.getZ(at)],
        uv:[uv.getX(at),uv.getY(at)],colour:[colour.getX(at),colour.getY(at),colour.getZ(at)]};
    });
    const clipped:Vertex[]=[];
    for(let edge=0;edge<3;edge++) {
      const a=triangle[edge]!,b=triangle[(edge+1)%3]!,insideA=a.position[0]!>=0,insideB=b.position[0]!>=0;
      if(insideA)clipped.push(a);
      if(insideA!==insideB)clipped.push(interpolate(a,b));
    }
    for(let vertex=1;vertex<clipped.length-1;vertex++)for(const point of [clipped[0]!,clipped[vertex]!,clipped[vertex+1]!])emit(point);
  }
  const edge=MAYA_PLANT_ROOF_CORE_EDGE*MAYA_PLANT_ROOF_CORE_SCALE,top=.06+.86*.43;
  const cap=(y:number,z:number):Vertex=>({position:[0,y,z],uv:[z+.5,y+.5],colour:[.76,.76,.76]});
  const corners=[cap(top,-edge),cap(top,edge),cap(top-MAYA_PLANT_ROOF_CORE_THICKNESS,edge),cap(top-MAYA_PLANT_ROOF_CORE_THICKNESS,-edge)];
  for(const index of [0,2,1,0,3,2])emit(corners[index]!);
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));
  geometry.setAttribute("color",new Float32BufferAttribute(colours,3));
  geometry.computeVertexNormals();
  if(flat!==source)flat.dispose();source.dispose();
  return geometry;
};
