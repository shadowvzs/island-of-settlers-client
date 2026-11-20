import { BufferGeometry,CanvasTexture,ClampToEdgeWrapping,DataTexture,Float32BufferAttribute,
  MeshStandardMaterial,PlaneGeometry,RGBAFormat,SRGBColorSpace,type Texture } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { INDIGENOUS_BUILDING_MOTIFS,INDIGENOUS_MOTIF_ATLAS,
  type IndigenousBuildingMotif,type IndigenousPigmentRegion } from "../../../render-common/buildings/indigenous-building-motifs";
import { ownBuildingMaterial } from "./building-material-ownership";
import { createClothPanelGeometry } from "./cloth-panel-geometry";
import { indigenousCaveMineral } from "./indigenous-cave-art-minerals";
import { indigenousCaveScene } from "./indigenous-cave-art-scenes";
import { createIndigenousPigmentStoneSurface } from "./indigenous-pigment-stone-surface";
import { createIndigenousRoofGeometry } from "./indigenous-roof-geometry";
import { indigenousWatchfulOwlTone } from "./indigenous-watchful-owl";

let atlas:Texture|undefined;
const grain=(x:number,y:number)=>{
  const value=Math.sin(x*127.1+y*311.7)*43758.5453;return value-Math.floor(value);
};
const cacheAtlas=(texture:Texture)=>{
  atlas=texture;texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=ClampToEdgeWrapping;
  texture.addEventListener("dispose",()=>{if(atlas===texture)atlas=undefined;});return texture;
};

/** One transparent brown-pigment atlas; original skin colours, woven maps and geometry remain underneath. */
export const indigenousPigmentAtlas=()=>{
  if(atlas)return atlas;
  if(typeof document==="undefined") {
    const texture=new DataTexture(new Uint8Array([0,0,0,0]),1,1,RGBAFormat);
    texture.needsUpdate=true;return cacheAtlas(texture);
  }
  const cell=192,{columns,rows}=INDIGENOUS_MOTIF_ATLAS,canvas=document.createElement("canvas");
  canvas.width=columns*cell;canvas.height=rows*cell;
  const context=canvas.getContext("2d")!,pixels=context.createImageData(canvas.width,canvas.height);
  for(let tile=0;tile<INDIGENOUS_BUILDING_MOTIFS.length;tile++) {
    const motif=INDIGENOUS_BUILDING_MOTIFS[tile]!,ox=tile%columns*cell,oy=Math.floor(tile/columns)*cell;
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++) {
      const sx=x/(cell-1)*2-1,sy=y/(cell-1)*2-1;
      const owlTone = motif === "watchful-owl" ? indigenousWatchfulOwlTone(sx, sy) : undefined;
      if (motif === "watchful-owl" && owlTone === undefined) continue;
      if (motif !== "watchful-owl" && !indigenousCaveScene(motif, sx, sy) &&
        !indigenousCaveMineral(motif, sx, sy)) continue;
      const at=((oy+y)*canvas.width+ox+x)*4,wear=grain(x+tile*137,y);
      pixels.data[at] = owlTone === undefined ? 107 : 65 + Math.round(owlTone * 100);
      pixels.data[at + 1] = owlTone === undefined ? 67 : 39 + Math.round(owlTone * 78);
      pixels.data[at + 2] = owlTone === undefined ? 35 : 20 + Math.round(owlTone * 48);
      pixels.data[at+3]=Math.round((.72+wear*.22)*255);
    }
  }
  context.putImageData(pixels,0,0);
  const texture=new CanvasTexture(canvas);texture.anisotropy=4;texture.userData.mimeType="image/png";
  return cacheAtlas(texture);
};

/** Standard exportable alpha material, with shared texture accounting preserved by placement ghosts. */
export const createIndigenousPigmentMaterial=()=>ownBuildingMaterial(new MeshStandardMaterial({
  map:indigenousPigmentAtlas(),transparent:true,alphaTest:.025,depthWrite:false,
  roughness:.99,metalness:0,vertexColors:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1
}),undefined,true);

type Vertex={position:number[];normal:number[];uv:number[]};
const interpolate=(a:Vertex,b:Vertex,t:number):Vertex=>{
  const mix=(x:number[],y:number[])=>x.map((value,index)=>value+(y[index]!-value)*t);
  return {position:mix(a.position,b.position),normal:mix(a.normal,b.normal),uv:mix(a.uv,b.uv)};
};
const clip=(polygon:Vertex[],axis:number,edge:number,greater:boolean)=>{
  const result:Vertex[]=[];
  for(let index=0;index<polygon.length;index++) {
    const a=polygon[index]!,b=polygon[(index+1)%polygon.length]!;
    const insideA=greater?a.uv[axis]!>=edge:a.uv[axis]!<=edge;
    const insideB=greater?b.uv[axis]!>=edge:b.uv[axis]!<=edge;
    if(insideA)result.push(a);
    if(insideA!==insideB)result.push(interpolate(a,b,(edge-a.uv[axis]!)/(b.uv[axis]!-a.uv[axis]!)));
  }
  return result;
};

/** Only existing textile triangles carry pigment: no rectangular placard and no covering real door holes. */
const pigmentSurface = (part: BuildingPart, detailed: boolean) => {
  if (part.indigenousPigmentCarriers) return createIndigenousPigmentStoneSurface(part, detailed);
  if (part.indigenousPigmentFlat) return new PlaneGeometry(1, 1);
  if (part.clothPanelCorners) return createClothPanelGeometry(part.clothPanelCorners, part.size, detailed);
  return createIndigenousRoofGeometry(part.indigenousRoof ?? "tipi", detailed, part.indigenousEntrance,
    part.indigenousRearEntrance, part.indigenousCutout, part.indigenousFrameRadius);
};

export const createIndigenousPigmentGeometry=(part:BuildingPart,detailed:boolean,
  motif:IndigenousBuildingMotif,region:IndigenousPigmentRegion)=>{
  const source = pigmentSurface(part, detailed);
  const p=source.getAttribute("position"),n=source.getAttribute("normal"),uv=source.getAttribute("uv"),index=source.index;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[];
  const [u,v,w,h]=region,{columns,rows}=INDIGENOUS_MOTIF_ATLAS,tile=INDIGENOUS_BUILDING_MOTIFS.indexOf(motif);
  const emit=(vertex:Vertex)=>{
    positions.push(...vertex.position);normals.push(...vertex.normal);
    const x=(vertex.uv[0]!-u)/(2*w)+.5,y=(vertex.uv[1]!-v)/(2*h)+.5;
    uvs.push((tile%columns+x)/columns,1-(Math.floor(tile/columns)+y)/rows);
  };
  const emitTriangle=(a:Vertex,b:Vertex,c:Vertex)=>{
    const u=b.position.map((value,axis)=>value-a.position[axis]!);
    const v=c.position.map((value,axis)=>value-a.position[axis]!);
    const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
    if(cross.reduce((sum,value)=>sum+value*value,0)<1e-16)return;
    for(const vertex of [a,b,c])emit(vertex);
  };
  const count=index?.count??p.count;
  for(let offset=0;offset<count;offset+=3) {
    let polygon=Array.from({length:3},(_,corner):Vertex=>{
      const at=index?index.getX(offset+corner):offset+corner;
      return {position:[p.getX(at),p.getY(at),p.getZ(at)],normal:[n.getX(at),n.getY(at),n.getZ(at)],
        uv:part.indigenousPigmentProjection === "front" ? [p.getX(at) + .5, .5 - p.getY(at)] :
          [uv.getX(at),uv.getY(at)]};
    });
    if (part.indigenousPigmentProjection === "front" &&
      polygon.reduce((sum, vertex) => sum + vertex.normal[2]!, 0) <= .15) continue;
    for(const [axis,edge,greater]of[[0,u-w,true],[0,u+w,false],[1,v-h,true],[1,v+h,false]] as const)
      polygon=clip(polygon,axis,edge,greater);
    for(let vertex=1;vertex<polygon.length-1;vertex++)emitTriangle(polygon[0]!,polygon[vertex]!,polygon[vertex+1]!);
  }
  source.dispose();
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("normal",new Float32BufferAttribute(normals,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));
  if (part.indigenousPigmentCarriers) {
    // Carrier normals are world-facing for clipping. Store their inverse-scaled local form so
    // the part's normal matrix restores the exact smoothed stone lighting after placement.
    const local = geometry.getAttribute("normal");
    for (let at = 0; at < local.count; at++) {
      const x = local.getX(at) * part.size[0], y = local.getY(at) * part.size[1];
      const z = local.getZ(at) * part.size[2], length = Math.hypot(x, y, z) || 1;
      local.setXYZ(at, x / length, y / length, z / length);
    }
  }
  return geometry;
};
