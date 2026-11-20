import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { CATAPULT_SHAFT_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import type { CatapultShellNation } from "../src/render-common/buildings/catapult-national-shell-profile";
import { createCatapultNationalShell } from "../src/renderers/three/buildings/catapult-national-shell-geometry";

const nations:CatapultShellNation[]=["roman","japanese","chinese","persian","nubian","indigenous","viking"];
it.each([true,false])("keeps real entry/windows/hatch empty and provides solid bearing walls (%s)",detailed=>{
  for(const nation of nations) {
    const geometry=createCatapultNationalShell(nation,detailed),material=new MeshBasicMaterial({side:DoubleSide});
    const mesh=new Mesh(geometry,material);mesh.scale.set(1.7,CATAPULT_SHAFT_HEIGHT,1.7);
    mesh.position.y=CATAPULT_SHAFT_HEIGHT/2;mesh.updateMatrixWorld(true);
    const hits=(p:number[],d:number[])=>new Raycaster(new Vector3(...p),new Vector3(...d)).intersectObject(mesh);
    try {
      expect(hits([0,.4,0],[0,0,1]),`${nation}: actual entry`).toHaveLength(0);
      expect(hits([0,1.945,-.08],[1,0,0]),`${nation}: real right window`).toHaveLength(0);
      expect(hits([0,1.945,-.08],[-1,0,0]),`${nation}: real left window`).toHaveLength(0);
      expect(hits([-.59,CATAPULT_SHAFT_HEIGHT-.6,-.59],[0,1,0]),`${nation}: protected upper hatch`).toHaveLength(0);
      expect(hits([0,1.25,0],[0,0,1]).length,`${nation}: supporting front wall`).toBeGreaterThan(0);
      expect(hits([0,.4,0],[0,0,-1]).length,`${nation}: supporting rear wall`).toBeGreaterThan(0);
      if(nation==="chinese") {
        for(const x of [-.12,0,.12])
          expect(hits([x,1.49,0],[0,0,-1]),"additional circular rear aperture passes through both wall faces")
            .toHaveLength(0);
        for(const x of [-.25,.25])
          expect(hits([x,1.49,0],[0,0,-1]).length,"circle retains its actual supporting wall on each side")
            .toBeGreaterThan(0);
      }
      const p=geometry.getAttribute("position"),index=geometry.index!;
      expect(index.count/3).toBeLessThan(detailed?2000:1100);
      for(let i=0;i<index.count;i+=3) {
        const a=new Vector3().fromBufferAttribute(p,index.getX(i));
        const b=new Vector3().fromBufferAttribute(p,index.getX(i+1));
        const c=new Vector3().fromBufferAttribute(p,index.getX(i+2));
        expect(b.sub(a).cross(c.sub(a)).length(),`${nation}: nondegenerate wall`).toBeGreaterThan(1e-10);
      }
    } finally { geometry.dispose();material.dispose(); }
  }
});
