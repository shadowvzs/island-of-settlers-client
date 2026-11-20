import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { ChineseRoofBearingProfile } from "../../../render-common/buildings/chinese-roof-bearing-profile";

/** Closed continuous timber bearing: a flat seated bottom and triangulated curved roof-contact top. */
export const createChineseRoofBearingGeometry=(profile:ChineseRoofBearingProfile)=>{
  const positions:number[]=[],uvs:number[]=[];
  const point=(share:number,y:number,side:number)=>profile.axis===0
    ?new Vector3(share-.5,y,side*.5):new Vector3(side*.5,y,share-.5);
  const triangle=(a:Vector3,b:Vector3,c:Vector3,hint:Vector3)=>{
    const normal=b.clone().sub(a).cross(c.clone().sub(a));
    for(const p of normal.dot(hint)>=0?[a,b,c]:[a,c,b]){positions.push(...p.toArray());uvs.push(p.x+.5,p.y+.5);}
  };
  const quad=(a:Vector3,b:Vector3,c:Vector3,d:Vector3,hint:Vector3)=>{triangle(a,b,c,hint);triangle(a,c,d,hint);};
  const along=profile.axis===0?new Vector3(1,0,0):new Vector3(0,0,1);
  const across=profile.axis===0?new Vector3(0,0,1):new Vector3(1,0,0);
  for(let i=1;i<profile.samples.length;i++) {
    const a=profile.samples[i-1]!,b=profile.samples[i]!;
    for(let j=1;j<profile.across.length;j++) {
      const near=profile.across[j-1]!*2,far=profile.across[j]!*2;
      const an=point(a.share,a.heights[j-1]!,near),af=point(a.share,a.heights[j]!,far);
      const bn=point(b.share,b.heights[j-1]!,near),bf=point(b.share,b.heights[j]!,far);
      const adn=point(a.share,-.5,near),adf=point(a.share,-.5,far),bdn=point(b.share,-.5,near),bdf=point(b.share,-.5,far);
      quad(an,bn,bf,af,new Vector3(0,1,0));quad(adn,adf,bdf,bdn,new Vector3(0,-1,0));
      if(j===1)quad(adn,bdn,bn,an,across.clone().negate());
      if(j===profile.across.length-1)quad(adf,af,bf,bdf,across);
      if(i===1)quad(adn,an,af,adf,along.clone().negate());
      if(i===profile.samples.length-1)quad(bdn,bdf,bf,bn,along);
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new Float32BufferAttribute(new Float32Array(positions.length).fill(1),3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
};
