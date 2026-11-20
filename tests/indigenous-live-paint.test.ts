import { Mesh,MeshStandardMaterial,Raycaster,Vector3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { indigenousBuildingMotif } from "../src/render-common/buildings/indigenous-building-motifs";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding,createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const requested=[6,21,40,9,10,11,12,13,18,19,20,22,24,25,27,37,43,47,51,55,57,58,59,62];
it.each([true,false])("paints one actual textile per requested Indigenous building within original level/LOD caps (%s)",detailed=>{
  const materials=createPlainBuildingMaterials();
  try {for(const id of requested)for(const level of [1,2,3,4,5] as const) {
    const definition=getBuildingDefinition(id),recipe=leveledBuildingRecipe(definition,"indigenous",detailed,level);
    const paintings=recipe.parts.filter(part=>part.shape==="indigenous-pigment");
    expect(paintings,`${id}/${level}`).toHaveLength(1);
    expect(paintings[0]!.indigenousPigment).toBe(indigenousBuildingMotif(id));
    const geometry=createRomanPartGeometry(paintings[0]!,detailed);
    try {expect(geometry.getAttribute("position").count,`${id}/${level} real textile triangles`).toBeGreaterThan(0);}
    finally {geometry.dispose();}
    const model=createRomanBuilding(definition,materials,detailed,recipe,"indigenous");
    try {
      expect.soft(model.triangles(false),`${id}/${level}`).toBeLessThanOrEqual(nationTriangleBudget("indigenous",id)[detailed?0:1]);
      let overlays=0;model.root.traverse(object=>{
        if(!(object instanceof Mesh)||!object.userData.ownedMaterial||!(object.material instanceof MeshStandardMaterial))return;
        if(!object.material.transparent||object.material.alphaTest!==.025)return;
        overlays++;expect(object.castShadow).toBe(false);expect(object.material.map).toBeDefined();
      });expect(overlays).toBe(1);
    }finally {model.dispose();}
  }}finally {Object.values(materials).forEach(material=>material.dispose());}
},15000);

it("keeps the four reed-wall reuse occupations and all other nations unpainted",()=>{
  for(const nation of ["roman","chinese","japanese","persian","maya","nubian","viking"] as const)
    expect(leveledBuildingRecipe(getBuildingDefinition(22),nation,false,1).parts.some(part=>part.indigenousPigment)).toBe(false);
  for(const id of [17,26,33,36])expect(leveledBuildingRecipe(getBuildingDefinition(id),"indigenous",false,1)
    .parts.some(part=>part.indigenousPigment)).toBe(false);
});

it("hangs the Fisher painting below a rail seated on both actual canopy posts",()=>{
  for(const detailed of [true,false])for(const level of [1,5] as const) {
    const recipe=leveledBuildingRecipe(getBuildingDefinition(18),"indigenous",detailed,level);
    const cloth=recipe.parts.find(part=>part.shape==="cloth-panel"&&part.surface==="cloth")!;
    expect(cloth).toBeDefined();
    const rail=recipe.parts.find(part=>part.shape==="box"&&part.surface==="wood"&&
      part.size[0]>1&&part.size[1]===.025&&Math.abs(part.position[2]-cloth.position[2])<.03)!;
    expect(rail).toBeDefined();
    const posts=recipe.parts.filter(part=>part.shape==="cylinder"&&part.surface==="wood"&&
      Math.abs(part.position[2]-rail.position[2])<.001&&part.size[1]>.8);
    expect(posts).toHaveLength(2);
    for(const post of posts) {
      expect(Math.abs(post.position[0]-rail.position[0])).toBeLessThan(rail.size[0]/2);
      expect(post.position[1]+post.size[1]/2).toBeGreaterThan(rail.position[1]);
    }
    expect(cloth.position[1]+cloth.size[1]/2).toBeLessThan(rail.position[1]);
    expect(cloth.position[1]-cloth.size[1]/2).toBeGreaterThan(.5);
  }
});

it("keeps the complete axe, tools and wheat textile clear of opaque yard equipment",()=>{
  const materials=createPlainBuildingMaterials();
  try {for(const id of [24,25,37])for(const detailed of [true,false])for(const level of [1,5] as const) {
    const definition=getBuildingDefinition(id),recipe=leveledBuildingRecipe(definition,"indigenous",detailed,level);
    const model=createRomanBuilding(definition,materials,detailed,recipe,"indigenous");
    try {
      model.root.updateMatrixWorld(true);
      let painting:Mesh|undefined;
      const opaque:Mesh[]=[];
      model.root.traverse(object=>{
        if(!(object instanceof Mesh))return;
        if(object.userData.visualPigment)painting=object;
        const surface=Array.isArray(object.material)?object.material:[object.material];
        if(surface.every(material=>!material.transparent))opaque.push(object);
      });
      expect(painting).toBeDefined();
      const mesh=painting!,positions=mesh.geometry.getAttribute("position"),normals=mesh.geometry.getAttribute("normal");
      for(let at=0;at<positions.count;at+=3) {
        const centre=new Vector3(),normal=new Vector3();
        for(let corner=0;corner<3;corner++) {
          centre.add(new Vector3().fromBufferAttribute(positions,at+corner));
          normal.add(new Vector3().fromBufferAttribute(normals,at+corner));
        }
        centre.divideScalar(3).applyMatrix4(mesh.matrixWorld);
        normal.normalize().transformDirection(mesh.matrixWorld);
        const ray=new Raycaster(centre.clone().addScaledVector(normal,.5),normal.clone().negate(),0,.495);
        expect(ray.intersectObjects(opaque,false),
          `${id}/${detailed}/${level} pigment triangle ${at/3}`).toHaveLength(0);
      }
    }finally {model.dispose();}
  }}finally {Object.values(materials).forEach(material=>material.dispose());}
});
