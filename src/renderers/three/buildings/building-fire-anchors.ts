import { Box3, Mesh, Object3D, Raycaster, Vector3 } from "three";

import { BUILDING_BATCH_SOURCE_LAYER } from "./building-static-batches";

/** Actual exposed building surfaces; never populate empty bounding-box space. */
export const sampleBuildingFireAnchors = (structure: Object3D, bounds: Box3, count: number) => {
  structure.updateMatrixWorld(true);
  const surfaces: Mesh[] = [];
  structure.traverse(object => {
    if (!(object instanceof Mesh) || /flag|resident|horse|pig/i.test(object.name)) return;
    for (let parent: Object3D | null = object; parent; parent = parent.parent)
      if (!parent.visible || /flag|resident|horse|pig/i.test(parent.name)) return;
    surfaces.push(object);
  });
  const centre = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const ray = new Raycaster(new Vector3(), new Vector3(0,-1,0));
  ray.layers.enable(BUILDING_BATCH_SOURCE_LAYER);
  const anchors: Vector3[] = [];
  const columns = Math.ceil(Math.sqrt(count * Math.max(.5,size.x / Math.max(.1,size.z))));
  const rows = Math.ceil(count / columns);
  for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
    const x = centre.x + ((column+.5)/columns-.5)*size.x*.82;
    const z = centre.z + ((row+.5)/rows-.5)*size.z*.82;
    ray.ray.origin.set(x,bounds.max.y+1,z);
    const hit = ray.intersectObjects(surfaces,false)[0];
    if (!hit || hit.point.y < bounds.min.y-.01) continue;
    anchors.push(new Vector3(hit.point.x-centre.x,hit.point.y-bounds.min.y,hit.point.z-centre.z));
    if (anchors.length===count) return anchors;
  }
  return anchors;
};

/** Must match the visual building collapse; final embers sit in its charred debris. */
export const buildingCollapseScale = (age: number) => Math.max(.03,1-Math.max(0,age-6)/4);
