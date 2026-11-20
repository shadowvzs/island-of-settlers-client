import { MeshStandardMaterial, SRGBColorSpace, Texture, TextureLoader } from "three";

import { ownBuildingMaterial } from "./building-material-ownership";

interface SharedImage { disposed:boolean; texture:Texture; users:number }
const images=new Map<string,SharedImage>();

/** Original rendered game icons can be reused by backed architectural signs, with shared map ownership. */
export const createBuildingImageSignMaterial=(url:string)=>{
  let entry=images.get(url);
  if(!entry) {
    entry={disposed:false,texture:new Texture(),users:0};
    const current=entry;
    if(typeof document!=="undefined")entry.texture=new TextureLoader().load(url,texture=>{
      if(current.disposed)(texture as Texture).image=null;
    });
    entry.texture.colorSpace=SRGBColorSpace;
    entry.texture.addEventListener("dispose",()=>{current.disposed=true;current.texture.image=null;});
    images.set(url,entry);
  }
  const current=entry;current.users++;
  const material=new MeshStandardMaterial({map:current.texture,alphaTest:.05,transparent:true,
    roughness:.92,metalness:0,vertexColors:true,color:0xffffff});
  ownBuildingMaterial(material,undefined,true);
  let released=false;
  material.addEventListener("dispose",()=>{
    if(released)return;released=true;
    if(--current.users===0&&images.get(url)===current)images.delete(url);
  });
  return material;
};
