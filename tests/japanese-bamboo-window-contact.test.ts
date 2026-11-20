import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true,false])("preserves a genuinely open, translucent, seated window at all five bamboo levels (%s)",detailed=>{
  const materials=createPlainBuildingMaterials(),material=new MeshBasicMaterial({side:DoubleSide});
  try {
    for(const level of [1,2,3,4,5] as const) {
      const recipe=leveledBuildingRecipe(getBuildingDefinition(20),"japanese",detailed,level);
      const window=recipe.parts.find(part=>part.windowShadow)!;
      expect(window.windowShadowDecorative).toBe(true);
      const model=createRomanBuilding(getBuildingDefinition(20),materials,detailed,recipe,"japanese");
      try {
        let shadows=0;
        model.root.traverse(object=>{
          if(!(object instanceof Mesh)||!object.userData.windowShadow)return;
          shadows++;const m=Array.isArray(object.material)?object.material[0]!:object.material;
          expect(m.transparent).toBe(true);expect(m.opacity).toBe(.5);
        });
        expect(shadows).toBe(1);
      } finally {model.dispose();}
      const walls=recipe.parts.filter(part=>part.stage===1&&!part.stock).map(part=>
        new Mesh(createRomanPartGeometry(part,detailed),material));
      try {
        for(const x of [.24,.35,.46])for(const y of [.53,.63,.73]) {
          const hits=new Raycaster(new Vector3(x,y,.90),new Vector3(0,0,-1),0,.50).intersectObjects(walls);
          expect(hits,`level${level}: no backing/cladding in opening`).toHaveLength(0);
        }
        for(const [x,y] of [[.20,.63],[.50,.63],[.35,.475],[.35,.785]]) {
          const hits=new Raycaster(new Vector3(x!,y!,.723),new Vector3(0,0,-1),0,.024).intersectObjects(walls);
          expect(hits.length,`level${level}: bamboo frame${x}/${y} seats on real wall`).toBeGreaterThan(0);
        }
      } finally {walls.forEach(wall=>wall.geometry.dispose());}
      const pots=recipe.parts.filter(part=>!part.stock&&part.workyardAssembly==="resource-20"&&
        part.shape==="cylinder"&&part.position[2]>.77);
      for(const pot of pots)expect(getRomanPartBounds(pot).max[1]).toBeLessThan(.44);
      const badge=recipe.parts.find(part=>part.shape==="forester-tree-sign")!;
      if(level>=4)expect(getRomanPartBounds(badge).min[1]).toBeGreaterThan(1.23);
      expect(recipe.parts.some(part=>part.surface==="plaster")).toBe(false);
    }
  } finally {material.dispose();Object.values(materials).forEach(m=>m.dispose());}
});

it("raises the bamboo body and joined roof through the existing level3 height upgrade",()=>{
  const recipe=(level:1|3)=>leveledBuildingRecipe(getBuildingDefinition(20),"japanese",true,level);
  const top=(level:1|3)=>Math.max(...recipe(level).parts.filter(part=>part.bambooSection==="split")
    .map(part=>getRomanPartBounds(part).max[1]));
  expect(top(3)).toBeGreaterThan(top(1)+.10);
});

it("keeps the upgraded image badge at the same supported height in both LODs",()=>{
  for(const level of [1,4,5] as const) {
    const sign=(detailed:boolean)=>leveledBuildingRecipe(getBuildingDefinition(20),"japanese",detailed,level)
      .parts.find(part=>part.shape==="forester-tree-sign")!;
    expect(sign(true).position,`level${level}: shared physical sign anchor`).toEqual(sign(false).position);
  }
});

it.each([true,false])("keeps the raised tree image in front of its real gable support (%s)",detailed=>{
  const material=new MeshBasicMaterial({side:DoubleSide});
  try {for(const level of [1,4,5] as const) {
    const recipe=leveledBuildingRecipe(getBuildingDefinition(20),"japanese",detailed,level);
    const sign=recipe.parts.find(part=>part.shape==="forester-tree-sign")!;
    const obstacles=recipe.parts.filter(part=>part!==sign&&!part.windowShadow).map(part=>{
      const mesh=new Mesh(createRomanPartGeometry(part,detailed),material);
      mesh.userData.part={shape:part.shape,position:part.position,size:part.size};return mesh;
    });
    try {
      const start=sign.position[2]+.5;
      const hits=new Raycaster(new Vector3(sign.position[0],sign.position[1],start),new Vector3(0,0,-1),0,.499)
        .intersectObjects(obstacles).map(hit=>hit.object.userData.part);
      expect(hits,`level${level}: actual badge front visibility`).toEqual([]);
    } finally {obstacles.forEach(object=>object.geometry.dispose());}
  }} finally {material.dispose();}
});
