import type {Object3D} from "three";

/** Above-water foreground geometry must never become a wave-distorted seabed sample. */
export const withoutRefractionForeground=<T>(objects:readonly Object3D[],render:()=>T):T=>{
  const visibility=objects.map(object=>object.visible);
  objects.forEach(object=>object.visible=false);
  try{return render();}
  finally{objects.forEach((object,index)=>object.visible=visibility[index]!);}
};
