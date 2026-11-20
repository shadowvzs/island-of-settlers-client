import { BufferGeometry,Float32BufferAttribute } from "three";

import type { BuildingPart,Point3 } from "../../../render-common/buildings/building-recipe";

type Rect=readonly[number,number,number,number];
const subtract=(rect:Rect,hole:Rect):Rect[]=>{
  const left=Math.max(rect[0],hole[0]),right=Math.min(rect[1],hole[1]);
  const bottom=Math.max(rect[2],hole[2]),top=Math.min(rect[3],hole[3]);
  if(left>=right||bottom>=top)return[rect];
  const pieces:Rect[]=[[rect[0],left,rect[2],rect[3]],[right,rect[1],rect[2],rect[3]],
    [left,right,rect[2],bottom],[left,right,top,rect[3]]];
  return pieces.filter(r=>r[1]-r[0]>1e-7&&r[3]-r[2]>1e-7);
};

/** Closed wall skins/reveals; no solid box or opaque timber sheet behind an actual aperture. */
export const createYaguraWallGeometry=(part:BuildingPart)=>{
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const face=(points:Point3[],normal:Point3)=>{
    const [a,b,c]=points as[Point3,Point3,Point3],u=b.map((v,i)=>v-a[i]!) as Point3,v=c.map((n,i)=>n-a[i]!) as Point3;
    const dot=(u[1]*v[2]-u[2]*v[1])*normal[0]+(u[2]*v[0]-u[0]*v[2])*normal[1]+(u[0]*v[1]-u[1]*v[0])*normal[2];
    const start=positions.length/3;
    for(const point of points){positions.push(...point.map((n,i)=>n/part.size[i]!));uvs.push(point[0]+point[2],point[1]);}
    if(dot>=0)indices.push(start,start+1,start+2,start,start+2,start+3);
    else indices.push(start,start+2,start+1,start,start+3,start+2);
  };
  for(const axis of [0,2] as const)for(const sign of [-1,1] as const) {
    const along=axis===0?2:0,half=part.size[along]/2,base=-part.size[1]/2,top=part.size[1]/2;
    const outer=sign*part.size[axis]/2,inner=outer-sign*.055;
    const holes=(part.yaguraOpenings??[]).filter(hole=>hole.axis===axis&&hole.sign===sign)
      .map(hole=>[-hole.width/2,hole.width/2,Math.max(base,hole.bottom),Math.min(top,hole.top)] as Rect);
    const point=(x:number,y:number,depth:number):Point3=>axis===0?[depth,y,x]:[x,y,depth];
    let rectangles:Rect[]=[[-half,half,base,top]];
    for(const hole of holes)rectangles=rectangles.flatMap(rect=>subtract(rect,hole));
    const normal:Point3=axis===0?[sign,0,0]:[0,0,sign];
    for(const [left,right,bottom,head] of rectangles)for(const depth of [outer,inner])face([
      point(left,bottom,depth),point(right,bottom,depth),point(right,head,depth),point(left,head,depth)],
    depth===outer?normal:normal.map(n=>-n) as Point3);
    const reveal=(rect:Rect)=>{
      const [left,right,bottom,head]=rect;
      for(const [x,direction] of [[left,1],[right,-1]])face([point(x!,bottom,outer),point(x!,head,outer),
        point(x!,head,inner),point(x!,bottom,inner)],axis===0?[0,0,direction!]:[direction!,0,0]);
      for(const [y,direction] of [[bottom,1],[head,-1]])face([point(left,y!,outer),point(right,y!,outer),
        point(right,y!,inner),point(left,y!,inner)],[0,direction!,0]);
    };
    for(const hole of holes)reveal(hole);
    // The separate full deck slab seats exactly on this wall top and closes the tower.
    // Do not duplicate its hidden coplanar underside with four wall-top strips.
    for(const [y,direction] of [[base,-1]])face([point(-half,y!,outer),point(half,y!,outer),
      point(half,y!,inner),point(-half,y!,inner)],[0,direction!,0]);
  }
  const geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
};

/** A dimensional ring; the bonded rear face is hidden inside its supporting wall. */
export const createYaguraWindowFrame=()=>{
  const positions:number[]=[],indices:number[]=[],uvs:number[]=[];
  const outer=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  const inner=[[-.3833,-.4054],[.3833,-.4054],[.3833,.4054],[-.3833,.4054]];
  const quad=(points:number[][])=>{const at=positions.length/3;for(const p of points){positions.push(...p);uvs.push(p[0]!+.5,p[1]!+.5);}
    indices.push(at,at+1,at+2,at,at+2,at+3);};
  for(let i=0;i<4;i++){const next=(i+1)%4,a=outer[i]!,b=outer[next]!,c=inner[next]!,d=inner[i]!;
    quad([[...a,.5],[...b,.5],[...c,.5],[...d,.5]]);
    quad([[...d,.5],[...c,.5],[...c,-.5],[...d,-.5]]);
    quad([[...b,.5],[...a,.5],[...a,-.5],[...b,-.5]]);}
  const g=new BufferGeometry();g.setAttribute("position",new Float32BufferAttribute(positions,3));
  g.setAttribute("uv",new Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
};
