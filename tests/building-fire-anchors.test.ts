import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import { buildingCollapseScale, sampleBuildingFireAnchors } from "../src/renderers/three/buildings/building-fire-anchors";

describe("demolition sources stay attached to real structure",()=>{
  it.each([0,Math.PI/2])("samples roofs and avoids the unsupported gap, rotation=%s",rotation=>{
    const root=new Group();root.position.set(7,2,11);root.rotation.y=rotation;
    const geometry=new BoxGeometry(1,2,2),material=new MeshBasicMaterial();
    for(const x of [-1.5,1.5]){const part=new Mesh(geometry,material);part.position.set(x,1,0);root.add(part);}
    root.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(root),anchors=sampleBuildingFireAnchors(root,bounds,48);
    expect(anchors.length).toBeGreaterThan(8);
    for(const anchor of anchors){
      expect(anchor.y).toBeCloseTo(2);
      const across=rotation?anchor.z:anchor.x;
      expect(Math.abs(across)).toBeGreaterThanOrEqual(1);
    }
    expect(buildingCollapseScale(1)).toBe(1);
    expect(buildingCollapseScale(8)).toBe(.5);
    expect(buildingCollapseScale(11)).toBe(.03);
    geometry.dispose();material.dispose();
  });
});
