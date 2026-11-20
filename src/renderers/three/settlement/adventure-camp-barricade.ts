import { BufferGeometry, CircleGeometry, CylinderGeometry, Float32BufferAttribute, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from "three";

import type { CampColor } from "../../../render-common/adventure/adventure-camp-style";
import type { CampGeometryBuilder, CampPoint } from "./adventure-camp-geometry";

/** Short, open timber obstacles. Both quality tiers fit the shared 1.25 × .62 half-extents. */
export const addCampBarricade = (builder:CampGeometryBuilder,wood:CampColor,detailed:boolean) => {
  const cut:CampColor=[Math.min(.7,wood[0]*1.45+.08),Math.min(.52,wood[1]*1.35+.06),wood[2]*1.3+.035];
  const rope:CampColor=[.45,.35,.22];
  // Classify authored timber before rotating it: 1=bark side, 2=cut end; rope stays unmarked.
  const woodSurface=(geometry:BufferGeometry,endGrain=false)=>{
    const normals=geometry.getAttribute("normal"),values=new Float32Array(normals.count);
    for(let vertex=0;vertex<normals.count;vertex++) values[vertex]=endGrain||Math.abs(normals.getY(vertex))>.95?2:1;
    geometry.setAttribute("campWood",new Float32BufferAttribute(values,1));return geometry;
  };
  // Cross rails and splayed braces keep a rough portable barrier, rather than a closed fort wall.
  const support=(from:CampPoint,to:CampPoint,radius:number)=>{
    const a=new Vector3(...from),b=new Vector3(...to),delta=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5);
    const geometry=woodSurface(new CylinderGeometry(radius*.86,radius,delta.length(),4));
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));
    builder.add(geometry,wood,...mid.toArray() as [number,number,number]);
  };
  for(const [y,z] of [[.56,.06],[.9,-.16]])support([-1.16,y!,z!],[1.16,y!,z!],.057);
  for(const x of [-.88,.88])support([x,.055,.46],[x,.93,-.18],.07);
  const stakes=5;
  for(let index=0;index<stakes;index++){
    const x=(index-(stakes-1)/2)*.5;
    const from=new Vector3(x+(index%2?.025:-.025),.12,.39);
    const to=new Vector3(x,1.08+(index%3)*.055,-.33-(index%2)*.035);
    const axis=to.clone().sub(from),rotation=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),axis.clone().normalize());
    const middle=from.clone().add(to).multiplyScalar(.5);
    const trunk=woodSurface(new CylinderGeometry(.075,.105,axis.length(),detailed?6:5,1));
    trunk.applyQuaternion(rotation);builder.add(trunk,wood,...middle.toArray() as [number,number,number]);
    const tipLength=.23;
    const tip=woodSurface(new CylinderGeometry(0,.075,tipLength,detailed?6:5));
    tip.applyQuaternion(rotation);
    const tipCentre=to.clone().addScaledVector(axis.clone().normalize(),tipLength/2);
    builder.add(tip,cut,...tipCentre.toArray() as [number,number,number]);
    // The pale end-grain is capped, not an extra texture or material.
    const end=woodSurface(new CircleGeometry(.105,detailed?6:5),true);
    end.rotateX(Math.PI/2);end.applyQuaternion(rotation);builder.add(end,cut,...from.toArray() as [number,number,number]);
    // Low-poly rope loops keep the binding silhouette in Minimal without adding another material.
    for(const [y,z] of [[.56,.06]]){
      const winding=new TorusGeometry(.115,.012,3,5);
      winding.rotateX(Math.PI/2);
      builder.add(winding,rope,x,y!,z!);
      if(detailed && (index===1 || index===3) && y===.56){
        builder.add(new SphereGeometry(.025,4,2),rope,x+.1,y-.025,z!+.075);
        const tail=new CylinderGeometry(.008,.009,.12,3);
        tail.rotateZ(-.16);builder.add(tail,rope,x+.12,y-.075,z!+.095);
      }
    }
  }
};
