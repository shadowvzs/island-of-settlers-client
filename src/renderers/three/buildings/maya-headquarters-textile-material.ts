import { CanvasTexture, ClampToEdgeWrapping, DataTexture, DoubleSide, MeshStandardMaterial,
  SRGBColorSpace, type Texture, Vector2 } from "three";

import { paintMayaHeadquartersTextile } from "../../../render-common/props/maya-headquarters-textile";
import { ownBuildingMaterial } from "./building-material-ownership";

const texture = (pixels: Uint8ClampedArray, size: number) => {
  let map: Texture;
  if (typeof document === "undefined" || typeof ImageData === "undefined")
    map = new DataTexture(new Uint8Array(pixels),size,size);
  else {
    const canvas=document.createElement("canvas");canvas.width=canvas.height=size;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels),size,size),0,0);
    map=new CanvasTexture(canvas);
  }
  map.wrapS=map.wrapT=ClampToEdgeWrapping;map.generateMipmaps=true;
  map.userData.mimeType="image/png";map.needsUpdate=true;return map;
};
const normalPixels=(height:Float32Array,size:number)=>{
  const pixels=new Uint8ClampedArray(size*size*4);
  const at=(x:number,y:number)=>height[Math.max(0,Math.min(size-1,y))*size+Math.max(0,Math.min(size-1,x))]!;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const dx=(at(x-1,y)-at(x+1,y))*.7,dy=(at(x,y-1)-at(x,y+1))*.7,length=Math.hypot(dx,dy,1);
    pixels.set([128+dx/length*127,128+dy/length*127,128+127/length,255],(y*size+x)*4);
  }
  return pixels;
};
const maps=new Map<boolean,{albedo:Texture;normal?:Texture}>();

/** Shared original textile maps; a placement ghost keeps them alive until the last owned material releases. */
export const createMayaHeadquartersTextileMaterial=(detailed:boolean)=>{
  let shared=maps.get(detailed);
  if(!shared) {
    const size=detailed?512:256,painted=paintMayaHeadquartersTextile(size);
    shared={albedo:texture(painted.pixels,size)};shared.albedo.colorSpace=SRGBColorSpace;
    if(detailed)shared.normal=texture(normalPixels(painted.heights,size),size);
    maps.set(detailed,shared);
    const held=shared;
    shared.albedo.addEventListener("dispose",()=>{if(maps.get(detailed)===held)maps.delete(detailed);});
  }
  return ownBuildingMaterial(new MeshStandardMaterial({name:"maya_headquarters_quetzal",map:shared.albedo,normalMap:shared.normal??null,
    normalScale:new Vector2(.35,.35),color:0xffffff,roughness:.95,metalness:0,side:DoubleSide,
    transparent:false,opacity:1,vertexColors:true}),undefined,true);
};
