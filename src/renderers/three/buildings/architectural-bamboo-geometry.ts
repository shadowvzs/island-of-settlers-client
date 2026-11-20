import { BufferGeometry, Float32BufferAttribute } from "three";

export type BambooSection = "round" | "facing" | "split";

/** Closed structural culms, flat-backed wall halves and genuinely hollow split roofing culms. */
export const createArchitecturalBamboo = (section:BambooSection,detailed:boolean,phase=0,concave=false,radialSegments?:number) => {
  const full=section==="round",split=section==="split";
  let sides=detailed?3:2;
  if(full) {
    sides=detailed?6:3;
    if(radialSegments!==undefined)sides=Math.max(3,Math.min(16,Math.round(radialSegments)));
  }
  const angle=(index:number)=>(full?Math.PI*2:Math.PI)*index/sides;
  const positions:number[]=[],uvs:number[]=[],colours:number[]=[],indices:number[]=[];
  const vertex=(x:number,y:number,z:number,u:number,v:number,shade=1)=>{
    const index=positions.length/3;
    positions.push(x,y,concave?-z:z);uvs.push(u,v);colours.push(shade,shade,shade);return index;
  };
  const tri=(a:number,b:number,c:number)=>{if(concave)indices.push(a,c,b);else indices.push(a,b,c);};
  const node=full?0:-.08+(phase%1)*.16;
  // One raised joint per structural pole; fine rings on the private map describe the other internodes.
  // Wall culms stagger their joints: a third intersect this cropped facing, the others are internodes.
  const raised=detailed&&!split&&(full||phase%1<.34);
  const bands=raised?[[-.5,.465],[node-.012,.465],[node,.5],[node+.012,.465],[.5,.455]]:[[-.5,.465],[.5,.455]];
  bands.sort((a,b)=>a[0]!-b[0]!);
  const outer:number[][]=[];
  for(const [y,r]of bands) {
    const ring:number[]=[];
    for(let side=0;side<=sides;side++)ring.push(vertex(Math.cos(angle(side))*r!,y!,Math.sin(angle(side))*r!,
      side/sides,y!+.5-node,y===node?.92:1));
    outer.push(ring);
  }
  const bridge=(a:number[],b:number[],inward=false)=>{
    for(let side=0;side<sides;side++) {
      if(inward){tri(a[side]!,a[side+1]!,b[side]!);tri(a[side+1]!,b[side+1]!,b[side]!);}
      else {tri(a[side]!,b[side]!,a[side+1]!);tri(a[side+1]!,b[side]!,b[side+1]!);}
    }
  };
  for(let row=1;row<outer.length;row++)bridge(outer[row-1]!,outer[row]!);
  if(split) {
    const inner:number[][]=[];
    for(const y of [-.5,.5]) {
      const ring:number[]=[];
      for(let side=0;side<=sides;side++)ring.push(vertex(Math.cos(angle(side))*.37,y,Math.sin(angle(side))*.37,
        side/sides,y+.5,.82));
      inner.push(ring);
    }
    bridge(inner[0]!,inner[1]!,true);
    for(let end=0;end<2;end++)for(let side=0;side<sides;side++) {
      const a=outer[end===0?0:outer.length-1]!,b=inner[end]!;
      if(end===0){tri(a[side]!,a[side+1]!,b[side]!);tri(a[side+1]!,b[side+1]!,b[side]!);}
      else {tri(a[side]!,b[side]!,a[side+1]!);tri(a[side+1]!,b[side]!,b[side+1]!);}
    }
    for(const side of [0,sides]) {
      tri(outer[0]![side]!,inner[0]![side]!,outer.at(-1)![side]!);
      tri(outer.at(-1)![side]!,inner[0]![side]!,inner[1]![side]!);
    }
  } else {
    for(let end=0;end<2;end++) {
      const row=bands[end===0?0:bands.length-1]!,y=row[0]!,r=row[1]!;
      const centre=vertex(0,y,0,.5,.5,.94),ring:number[]=[];
      for(let side=0;side<=sides;side++)ring.push(vertex(Math.cos(angle(side))*r,y,Math.sin(angle(side))*r,
        Math.cos(angle(side))*.45+.5,Math.sin(angle(side))*.45+.5,.95));
      for(let side=0;side<sides;side++) {
        if(end===0)tri(centre,ring[side]!,ring[side+1]!);
        else tri(centre,ring[side+1]!,ring[side]!);
      }
    }
    if(!full)for(let row=1;row<outer.length;row++) {
      tri(outer[row-1]![0]!,outer[row-1]![sides]!,outer[row]![0]!);
      tri(outer[row]![0]!,outer[row-1]![sides]!,outer[row]![sides]!);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));
  geometry.setAttribute("color",new Float32BufferAttribute(colours,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
};
