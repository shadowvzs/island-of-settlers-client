/** Diagnostic only: actual posed skin triangles against the drawn hull, excluding intentional arm/hand contacts. */
export const fisherBodySurface = (three: any, worker: any, hull: any, includeArms = false) => {
  let hullMesh: any;hull.traverse((o:any)=>{if(o.isMesh&&!hullMesh)hullMesh=o;});
  if(!hullMesh)return {crossings:0,parts:{},triangles:0};
  worker.updateMatrixWorld(true);hullMesh.updateWorldMatrix(true,false);
  const cell=.1,grid=new Map<string,any[]>(),triangles:any[]=[];
  const add=(a:any,b:any,c:any)=>{const triangle=new three.Triangle(a,b,c),box=new three.Box3().setFromPoints([a,b,c]);const item={triangle,box};triangles.push(item);
    for(let x=Math.floor(box.min.x/cell);x<=Math.floor(box.max.x/cell);x++)for(let y=Math.floor(box.min.y/cell);y<=Math.floor(box.max.y/cell);y++)for(let z=Math.floor(box.min.z/cell);z<=Math.floor(box.max.z/cell);z++){const key=`${x}/${y}/${z}`;const list=grid.get(key)??[];list.push(item);grid.set(key,list);}};
  const hg=hullMesh.geometry,hp=hg.attributes.position,hi=hg.index;
  for(let i=0;i<(hi?.count??hp.count);i+=3){const point=(j:number)=>new three.Vector3().fromBufferAttribute(hp,hi?hi.getX(i+j):i+j).applyMatrix4(hullMesh.matrixWorld);add(point(0),point(1),point(2));}
  const ray=new three.Ray(),direction=new three.Vector3(),hit=new three.Vector3();
  const segment=(a:any,b:any,t:any)=>{direction.copy(b).sub(a);const length=direction.length();if(length<1e-8)return false;ray.set(a,direction.divideScalar(length));const found=ray.intersectTriangle(t.a,t.b,t.c,false,hit);return found&&a.distanceTo(hit)>1e-5&&a.distanceTo(hit)<length-1e-5;};
  const cross=(a:any,b:any)=>segment(a.a,a.b,b)||segment(a.b,a.c,b)||segment(a.c,a.a,b)||segment(b.a,b.b,a)||segment(b.b,b.c,a)||segment(b.c,b.a,a);
  const parts:Record<string,number>={};let crossings=0,bodyTriangles=0;
  worker.traverse((mesh:any)=>{
    if(!mesh.isSkinnedMesh||!mesh.visible)return;
    const g=mesh.geometry,p=g.attributes.position,indices=g.index,joints=g.attributes.skinIndex,weights=g.attributes.skinWeight;
    const points:any[]=[],labels:string[]=[];
    const point=(v:number)=>{if(points[v])return points[v];let best=0,label="";for(let k=0;k<4;k++)if(weights.getComponent(v,k)>best){best=weights.getComponent(v,k);label=mesh.skeleton.bones[joints.getComponent(v,k)].name;}labels[v]=label;return points[v]=mesh.getVertexPosition(v,new three.Vector3()).applyMatrix4(mesh.matrixWorld);};
    for(let i=0;i<(indices?.count??p.count);i+=3){const ids=[0,1,2].map(k=>indices?indices.getX(i+k):i+k),pts=ids.map(point);
      if(ids.some(v=> (includeArms ? /hand|finger|thumb|index|middle|ring|pinky/i : /hand|finger|thumb|index|middle|ring|pinky|forearm|lowerarm|upperarm|shoulder|leftarm|rightarm/i).test(labels[v]!)))continue;
      bodyTriangles++;const triangle=new three.Triangle(...pts),box=new three.Box3().setFromPoints(pts),candidates=new Set<any>();
      for(let x=Math.floor(box.min.x/cell);x<=Math.floor(box.max.x/cell);x++)for(let y=Math.floor(box.min.y/cell);y<=Math.floor(box.max.y/cell);y++)for(let z=Math.floor(box.min.z/cell);z<=Math.floor(box.max.z/cell);z++)for(const candidate of grid.get(`${x}/${y}/${z}`)??[])candidates.add(candidate);
      for(const candidate of candidates)if(box.intersectsBox(candidate.box)&&cross(triangle,candidate.triangle)){crossings++;const label=labels[ids[0]!]??"unknown";parts[label]=(parts[label]??0)+1;break;}
    }
  });
  return {crossings,parts,triangles:bodyTriangles};
};
