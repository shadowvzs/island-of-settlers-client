import type { Point3 } from "./building-recipe";

/** Subtract the existing two side-window apertures without changing the accepted Maya outer wall. */
export const mayaCatapultWallSections=(position:Point3,size:Point3):{position:Point3;size:Point3}[]=>{
  const unchanged=[{position,size}];
  if(Math.abs(position[0])<.52||size[0]>.2)return unchanged;
  const bottom=position[1]-size[1]/2,top=position[1]+size[1]/2;
  const rear=position[2]-size[2]/2,front=position[2]+size[2]/2;
  const low=Math.max(bottom,1.785),high=Math.min(top,2.105);
  const left=Math.max(rear,-.21),right=Math.min(front,.05);
  if(low>=high||left>=right)return unchanged;
  const sections:{position:Point3;size:Point3}[]=[];
  const add=(minZ:number,maxZ:number,minY:number,maxY:number)=>{
    if(maxZ-minZ<.001||maxY-minY<.001)return;
    sections.push({position:[position[0],(minY+maxY)/2,(minZ+maxZ)/2],
      size:[size[0],maxY-minY,maxZ-minZ]});
  };
  add(rear,left,bottom,top);add(right,front,bottom,top);
  add(left,right,bottom,low);add(left,right,high,top);
  return sections;
};
