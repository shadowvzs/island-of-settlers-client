import { Box3,DoubleSide,Mesh,MeshBasicMaterial,Raycaster,Vector3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockLayout } from "../src/render-common/buildings/building-stock-layout";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding,createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true,false])("retains a complete supported Indigenous Tannery bench beneath actual leather residents (%s)",detailed=>{
  const materials=createPlainBuildingMaterials(),definition=getBuildingDefinition(8);
  try {for(const level of [1,5] as const) {
    const recipe=leveledBuildingRecipe(definition,"indigenous",detailed,level);
    const bench=recipe.parts.filter(part=>part.workyardAssembly==="tannery-table"&&!part.stock&&
      (part.size[1]>.1||part.size[0]>.3));
    expect(bench).toHaveLength(5);
    const top=bench.find(part=>part.size[1]<.08)!;
    expect(top).toBeDefined();const bounds=getRomanPartBounds(top);
    for(const leg of bench.filter(part=>part!==top)) {
      const b=getRomanPartBounds(leg);
      expect(b.max[1]).toBeGreaterThanOrEqual(bounds.min[1]);
      expect(b.min[0]).toBeGreaterThan(bounds.min[0]);expect(b.max[0]).toBeLessThan(bounds.max[0]);
      expect(b.min[2]).toBeGreaterThan(bounds.min[2]);expect(b.max[2]).toBeLessThan(bounds.max[2]);
    }
    const material=new MeshBasicMaterial({side:DoubleSide});
    const skins=recipe.parts.filter(part=>part.shape==="indigenous-roof").map(part=>
      new Mesh(createRomanPartGeometry(part,detailed),material));
    try {for(const part of bench) {
      const b=getRomanPartBounds(part);
      for(const axis of [0,1,2] as const)for(const a of [0,1])for(const c of [0,1]) {
        const other=[0,1,2].filter(value=>value!==axis),start=new Vector3(...b.min),end=new Vector3(...b.min);
        start.setComponent(other[0]!,a?b.max[other[0]!]!:b.min[other[0]!]!);
        start.setComponent(other[1]!,c?b.max[other[1]!]!:b.min[other[1]!]!);
        end.copy(start);end.setComponent(axis,b.max[axis]);
        const direction=end.clone().sub(start),distance=direction.length();direction.normalize();
        expect(new Raycaster(start,direction,0,distance).intersectObjects(skins),"table/leg crosses actual textile").toEqual([]);
      }
    }}finally {skins.forEach(mesh=>mesh.geometry.dispose());material.dispose();}
    const {recipe:reference}=getBuildingStockLayout(8,{nation:"indigenous",level});
    const model=createRomanBuilding(definition,materials,detailed,recipe,"indigenous",reference);
    try {
      model.update(0,{construction:1,door:0,working:false,inputStock:{},outputStock:{leather:6}});
      model.root.updateMatrixWorld(true);
      const table=new Box3(new Vector3(...bounds.min),new Vector3(...bounds.max));
      for(let slot=0;slot<6;slot++) {
        const resident=model.root.getObjectByName(`stock_output_${slot}_leather`)!;
        expect(resident).toBeDefined();expect(resident.visible).toBe(true);
        const box=new Box3().setFromObject(resident);
        expect(box.min.x).toBeGreaterThanOrEqual(table.min.x-.002);
        expect(box.max.x).toBeLessThanOrEqual(table.max.x+.002);
        expect(box.min.z).toBeGreaterThanOrEqual(table.min.z-.002);
        expect(box.max.z).toBeLessThanOrEqual(table.max.z+.002);
        expect(box.min.y).toBeGreaterThanOrEqual(table.max.y-.01);
      }
    }finally {model.dispose();}
  }}finally {Object.values(materials).forEach(material=>material.dispose());}
});
