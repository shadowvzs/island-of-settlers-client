import { Box3,Vector3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { refineBambooForesterDoorway } from "../src/render-common/buildings/japanese-bamboo-doorway";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanGroundDoor } from "../src/renderers/three/buildings/roman-door";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true,false])("seats one joined bamboo jamb per side clear of the actual door and hinge strap sweep (%s)",detailed=>{
  const materials=createPlainBuildingMaterials();
  try {for(const level of [1,4,5] as const) {
    const source=leveledBuildingRecipe(getBuildingDefinition(20),"japanese",detailed,level);
    expect(source.parts.filter(part=>part.bambooDoorJamb)).toHaveLength(2);
    const refined=refineBambooForesterDoorway(source,detailed);
    const posts=refined.parts.filter(part=>(part as BuildingPart&{bambooDoorJamb?:true}).bambooDoorJamb);
    const boxes=posts.map(part=>{const b=getRomanPartBounds(part);
      return new Box3(new Vector3(...b.min),new Vector3(...b.max));});
    const door=createRomanGroundDoor(materials,detailed,source.door,true,source.doorDimensions);
    try {for(let step=0;step<=90;step++) {
      door.rotation.y=-step*Math.PI/180;door.updateMatrixWorld(true);
      const leaf=new Box3().setFromObject(door);
      for(const post of boxes)expect(leaf.intersectsBox(post),`level${level} open${step}`).toBe(false);
    }} finally {door.traverse(object=>{if("geometry"in object)(object.geometry as{dispose():void}).dispose();});}
    expect(refined.parts.filter(part=>part.stock)).toEqual(source.parts.filter(part=>part.stock));
  }} finally {Object.values(materials).forEach(material=>material.dispose());}
});
