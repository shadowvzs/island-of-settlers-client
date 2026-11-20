import { Box3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointConnected } from "../src/render-common/buildings/building-courtyard";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../src/render-common/buildings/building-stock-layout";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true,false])("renders all2+2 TeaHouse inputs separately and delivers to their actual places (%s)",detailed=>{
  const materials=createPlainBuildingMaterials();
  try {for(const level of [1,5] as const) {
    const style={nation:"chinese" as const,level},definition=getBuildingDefinition(6);
    const {recipe:reference}=getBuildingStockLayout(6,style);
    const model=createRomanBuilding(definition,materials,detailed,
      leveledBuildingRecipe(definition,"chinese",detailed,level),"chinese",reference);
    model.fitToGrid();
    try {
      model.update(0,{construction:1,door:0,working:false,inputStock:{water:2,teaLeaves:2},outputStock:{}});
      model.root.updateMatrixWorld(true);
      const boxes:Box3[]=[];
      for(const ware of ["water","teaLeaves"])for(const slot of [0,1]) {
        const object=model.root.getObjectByName(`stock_input_${slot}_${ware}`)!;
        expect(object,`${ware}${slot} exists`).toBeDefined();expect(object.visible).toBe(true);
        const box=new Box3().setFromObject(object);boxes.push(box);
        const inventory={water:2,teaLeaves:2};
        const contact=getBuildingStockContact(6,"input",ware,slot,0,0,0,0,inventory,{},style)!;
        expect(contact,`${ware}${slot} contact`).not.toBeNull();expect(contact.slot).toBe(slot);
        expect(contact.stock[0]).toBeCloseTo((box.min.x+box.max.x)/2,5);
        expect(contact.stock[2]).toBeCloseTo((box.min.z+box.max.z)/2,5);
        expect(isBuildingCourtyardPointConnected(6,0,0,0,
          {x:contact.approach[0],z:contact.approach[2]}, {},inventory,style)).toBe(true);
      }
      for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)
        expect(boxes[a]!.intersectsBox(boxes[b]!)).toBe(false);
      for(const ware of ["water","teaLeaves"] as const) {
        const first=getBuildingStockContact(6,"input",ware,0,0,0,0,0,{water:1,teaLeaves:1},{},style)!;
        const next=getBuildingStockContact(6,"input",ware,1,0,0,0,0,{water:1,teaLeaves:1},{},style)!;
        expect(first.warePosition).not.toEqual(next.warePosition);
      }
    } finally {model.dispose();}
  }} finally {Object.values(materials).forEach(material=>material.dispose());}
});
