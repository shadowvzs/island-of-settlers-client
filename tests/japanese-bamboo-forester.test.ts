import { Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createJapaneseBambooForester } from "../src/render-common/buildings/japanese-bamboo-forester";
import { addBambooPole, addJapaneseBambooRoof, type ArchitecturalBambooPart } from "../src/render-common/buildings/japanese-bamboo-roof";
import { createArchitecturalBamboo } from "../src/renderers/three/buildings/architectural-bamboo-geometry";

it.each([true,false])("preserves the productive nursery, door and worker exit in the bamboo concept (%s)",detailed=>{
  const original=createRomanBuildingRecipe(getBuildingDefinition(20),detailed);
  const recipe=createJapaneseBambooForester(original,detailed);
  expect(recipe.door).toEqual(original.door);
  expect(recipe.workerExit).toEqual(original.workerExit);
  expect(recipe.parts.filter(part=>part.stock)).toEqual(original.parts.filter(part=>part.stock));
  expect(recipe.parts.filter(part=>part.workyardAssembly)).toEqual(original.parts.filter(part=>part.workyardAssembly&&
    !(part.shape==="box"&&part.surface==="roof")).map(part=>!part.stock&&part.position[2]>.77?
      {...part,position:[part.position[0],part.position[1]-.09,part.position[2]]}:part));
  expect(recipe.parts.filter(part=>part.shape==="window-shadow")).toHaveLength(1);
  for(const part of recipe.parts.filter(part=>part.bambooSection==="split"))
    expect(part.tint![0]).toBeLessThan(.65);
  for(const part of recipe.parts.filter(part=>part.bambooSection==="facing"))
    expect(part.tint?.[0]??1).toBeGreaterThan(.5);
  expect(recipe.parts.find(part=>part.shape==="window-shadow")?.windowShadow).toBe(true);
  expect(recipe.parts.filter(part=>part.shape==="forester-tree-sign")).toHaveLength(1);
});

it("aligns structural culm ends with the actual joined beam endpoints",()=>{
  const parts:ArchitecturalBambooPart[]=[];
  const from=new Vector3(-.8,.2,-.6),to=new Vector3(.1,1.2,.5);
  addBambooPole(part=>parts.push(part),from.toArray(),to.toArray(),.06);
  const part=parts[0]!;
  const end=(sign:number)=>recipeRotate(new Vector3(0,sign*part.size[1]/2,0),part.rotation!).add(new Vector3(...part.position));
  expect(end(-1).distanceTo(from)).toBeLessThan(1e-10);
  expect(end(1).distanceTo(to)).toBeLessThan(1e-10);
});

// Production deliberately calls geometry.rotateX, then rotateY, then rotateZ; this is not EulerXYZ.
const recipeRotate=(point:Vector3,rotation:readonly number[])=>point.applyAxisAngle(new Vector3(1,0,0),rotation[0]!)
  .applyAxisAngle(new Vector3(0,1,0),rotation[1]!).applyAxisAngle(new Vector3(0,0,1),rotation[2]!);

it("lays split culms down both roof slopes with the outer crown pointing above the weather mat",()=>{
  const parts:ArchitecturalBambooPart[]=[];
  addJapaneseBambooRoof(part=>parts.push(part),[0,1.2,0],1.8,1.6,.46,true);
  for(const part of parts.filter(part=>part.bambooSection==="split")) {
    const axis=recipeRotate(new Vector3(0,1,0),part.rotation!);
    const crown=recipeRotate(new Vector3(0,0,1),part.rotation!);
    expect(Math.abs(axis.z)).toBeLessThan(1e-9);
    expect(axis.y).toBeLessThan(0);
    expect(axis.x*part.position[0]).toBeGreaterThan(0);
    expect(crown.y).toBeGreaterThan(.8);
  }
});

it.each([true,false])("keeps split roofing truly hollow, bounded and nondegenerate (%s)",detailed=>{
  for(const concave of [false,true]) {
    const geometry=createArchitecturalBamboo("split",detailed,0,concave);
    try {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBe(-.5);
      expect(geometry.boundingBox!.max.y).toBe(.5);
      const p=geometry.getAttribute("position"),index=geometry.index!;
      for(let triangle=0;triangle<index.count;triangle+=3) {
        const a=new Vector3().fromBufferAttribute(p,index.getX(triangle));
        const b=new Vector3().fromBufferAttribute(p,index.getX(triangle+1));
        const c=new Vector3().fromBufferAttribute(p,index.getX(triangle+2));
        expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(1e-8);
      }
      const crown=new Vector3(0,0,concave?-.37:.37);
      // Two distinct skins with an open half-section, never a filled decorative cylinder.
      expect(Array.from({length:p.count},(_,i)=>Math.hypot(p.getX(i),p.getZ(i))))
        .toEqual(expect.arrayContaining([expect.closeTo(crown.length(),5)]));
    } finally { geometry.dispose(); }
  }
});
