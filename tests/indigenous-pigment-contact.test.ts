import { Triangle,Vector3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { shareBuildingMaterialOwnership } from "../src/renderers/three/buildings/building-material-ownership";
import { createIndigenousPigmentMaterial } from "../src/renderers/three/buildings/indigenous-pigment-overlay";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it.each([true,false])("bonds every painted vertex to the actual existing textile instead of a floating rectangle (%s)",detailed=>{
  for(const id of [9,12,18,22,24,25,37,59]) {
    const recipe=leveledBuildingRecipe(getBuildingDefinition(id),"indigenous",detailed,5);
    const paint=recipe.parts.find(part=>part.shape==="indigenous-pigment")!;
    const skin=recipe.parts.find(part=>(part.shape==="indigenous-roof"||part.shape==="cloth-panel")&&
      part.position.every((value,axis)=>value===paint.position[axis])&&part.size.every((value,axis)=>value===paint.size[axis]))!;
    const base=createRomanPartGeometry(skin,detailed),overlay=createRomanPartGeometry(paint,detailed);
    try {
      const p=base.getAttribute("position"),index=base.index,triangles:Triangle[]=[];
      const count=index?.count??p.count;
      for(let offset=0;offset<count;offset+=3) {
        const point=(corner:number)=>new Vector3().fromBufferAttribute(p,index?index.getX(offset+corner):offset+corner);
        const triangle=new Triangle(point(0),point(1),point(2));
        if(triangle.getArea()>1e-12)triangles.push(triangle);
      }
      const painted=overlay.getAttribute("position"),target=new Vector3(),point=new Vector3();
      for(let vertex=0;vertex<painted.count;vertex++) {
        point.fromBufferAttribute(painted,vertex);let distance=Infinity;
        for(const triangle of triangles)distance=Math.min(distance,triangle.closestPointToPoint(point,target).distanceTo(point));
        expect(distance,`${id}: pigment must follow cloth`).toBeLessThan(.0012);
      }
    }finally {base.dispose();overlay.dispose();}
  }
});

it("shares one pigment atlas through model and ghost material lifetimes and releases it after the last owner",()=>{
  const first=createIndigenousPigmentMaterial(),second=createIndigenousPigmentMaterial(),texture=first.map!;
  expect(second.map).toBe(texture);let disposed=0;texture.addEventListener("dispose",()=>disposed++);
  const ghost=first.clone();shareBuildingMaterialOwnership(first,ghost);
  first.dispose();second.dispose();expect(disposed).toBe(0);expect(ghost.map).toBe(texture);
  ghost.dispose();expect(disposed).toBe(1);
  const fresh=createIndigenousPigmentMaterial();expect(fresh.map).not.toBe(texture);fresh.dispose();
});
