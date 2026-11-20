import { DoubleSide,Mesh,MeshBasicMaterial,Raycaster,Vector3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding,createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true,false])("keeps every Japanese4/9 upgraded window truly open and single black50 (%s)",detailed=>{
  const materials=createPlainBuildingMaterials(),opaque=new MeshBasicMaterial({side:DoubleSide});
  try {for(const id of [4,9])for(const level of [1,2,3,4,5] as const) {
    const definition=getBuildingDefinition(id),recipe=leveledBuildingRecipe(definition,"japanese",detailed,level);
    const panes=recipe.parts.filter(part=>part.windowShadow&&!part.doorwayShadow);
    expect(panes.length).toBeGreaterThan(0);
    const obstructions=recipe.parts.filter(part=>!part.windowShadow&&!part.stock).map(part=>{
      const mesh=new Mesh(createRomanPartGeometry(part,detailed),opaque);
      mesh.userData.part={shape:part.shape,position:part.position,size:part.size};return mesh;
    });
    try {for(const pane of panes) {
      const p=pane.windowOpeningPosition!,size=pane.windowOpeningSize!,axis=size[0]<size[2]?0:2;
      const body=recipe.parts.filter(part=>part.shape==="yagura-wall").sort((a,b)=>
        Math.hypot(a.position[0]-p[0],a.position[2]-p[2])-Math.hypot(b.position[0]-p[0],b.position[2]-p[2]))[0]!;
      const sign=Math.sign(p[axis]-body.position[axis]);
      const start=new Vector3(...p);start.setComponent(axis,start.getComponent(axis)+sign*.15);
      const direction=new Vector3();direction.setComponent(axis,-sign);
      const hits=new Raycaster(start,direction,0,.25).intersectObjects(obstructions).map(hit=>hit.object.userData.part);
      expect(hits,`${id}/${level}: opaque beam/backing in window`).toEqual([]);
    }} finally {obstructions.forEach(mesh=>mesh.geometry.dispose());}
    const model=createRomanBuilding(definition,materials,detailed,recipe,"japanese");
    try {model.root.traverse(object=>{
      if(!(object instanceof Mesh)||!object.userData.windowShadow)return;
      const material=Array.isArray(object.material)?object.material[0]!:object.material;
      expect(material.opacity).toBe(.5);expect(material.transparent).toBe(true);
    });} finally {model.dispose();}
  }} finally {opaque.dispose();Object.values(materials).forEach(material=>material.dispose());}
});
