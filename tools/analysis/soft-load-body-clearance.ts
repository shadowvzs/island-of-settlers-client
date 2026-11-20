import { Box3, type Mesh, type Object3D, type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { snapshotHatchGeometry } from "./catapult-hatch-sections";

/** Exact two-way surface crossings against the original torso/head/hair; support hands/arms are reported separately. */
export const createSoftLoadBodyClearance = (root: Object3D) => {
  const bodies: {mesh: Mesh; indices: number[]}[] = [];
  // Capture the loaded body before its asynchronous held props are added.
  root.traverseVisible(node => {
    const mesh=node as SkinnedMesh;if(!mesh.isMesh)return;
    const position=mesh.geometry.getAttribute("position"),order=mesh.geometry.index;
    const joints=mesh.geometry.getAttribute("skinIndex"),weights=mesh.geometry.getAttribute("skinWeight");
    const armShare=(vertex:number)=> {
      if(!mesh.isSkinnedMesh)return 0;
      let share=0;
      for(let slot=0;slot<4;slot++) if(/^(Left|Right)(Arm|ForeArm|Hand)/
        .test(mesh.skeleton.bones[joints.getComponent(vertex,slot)]!.name)) share+=weights.getComponent(vertex,slot);
      return share;
    };
    const indices:number[]=[];
    for(let at=0;at<(order?.count??position.count);at+=3) {
      const corners=[0,1,2].map(corner=>order?order.getX(at+corner):at+corner);
      if(corners.some(vertex=>armShare(vertex)>.35))continue;
      indices.push(...corners);
    }
    bodies.push({mesh,indices});
  });
  return (cargo:Object3D) => {
    const cargoVertices:Vector3[]=[],cargoIndices:number[]=[];
    for(const shape of snapshotHatchGeometry(cargo)) {
      const start=cargoVertices.length;
      for(let at=0;at<shape.vertices.length;at+=3)cargoVertices.push(new Vector3().fromArray(shape.vertices,at));
      cargoIndices.push(...shape.indices.map(index=>start+index));
    }
    const cargoBox=new Box3().setFromPoints(cargoVertices).expandByScalar(.001);
    const bodyVertices:Vector3[]=[],bodyIndices:number[]=[];
    const triangleBox=new Box3();
    for(const {indices,mesh} of bodies) {
      const position=mesh.geometry.getAttribute("position");
      const points=Array.from({length:position.count},(_,at)=> {
        const point=new Vector3();
        if((mesh as SkinnedMesh).isSkinnedMesh)(mesh as SkinnedMesh).getVertexPosition(at,point);
        else point.fromBufferAttribute(position,at);
        return point.applyMatrix4(mesh.matrixWorld);
      });
      for(let at=0;at<indices.length;at+=3) {
        const corners=[points[indices[at]!]!,points[indices[at+1]!]!,points[indices[at+2]!]!];
        triangleBox.setFromPoints(corners);if(!triangleBox.intersectsBox(cargoBox))continue;
        const start=bodyVertices.length;bodyVertices.push(...corners);bodyIndices.push(start,start+1,start+2);
      }
    }
    if(!bodyIndices.length)return {bodyFaces:0,bodyEdgesThroughCargo:0,cargoEdgesThroughBody:0};
    const bodyGrid=new TriangleGrid(bodyVertices,bodyIndices,.04),cargoGrid=new TriangleGrid(cargoVertices,cargoIndices,.04);
    const direction=new Vector3();
    const crossings=(positions:Vector3[],indices:number[],target:TriangleGrid)=> {
      let hits=0;
      for(let at=0;at<indices.length;at+=3) for(let edge=0;edge<3;edge++) {
        const a=positions[indices[at+edge]!]!,b=positions[indices[at+(edge+1)%3]!]!;
        direction.copy(b).sub(a);const length=direction.length();if(length<.0001)continue;
        if(target.raycast(a,direction.normalize(),.00005,length-.00005))hits++;
      }
      return hits;
    };
    return {bodyFaces:bodyIndices.length/3,bodyEdgesThroughCargo:crossings(bodyVertices,bodyIndices,cargoGrid),
      cargoEdgesThroughBody:crossings(cargoVertices,cargoIndices,bodyGrid)};
  };
};
