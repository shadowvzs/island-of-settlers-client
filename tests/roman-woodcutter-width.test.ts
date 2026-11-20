import { Box3,MeshStandardMaterial,Vector3 } from 'three';
import { expect,it } from 'vitest';

import { getBuildingDefinition } from '../src/render-common/buildings/building-catalog';
import { type BuildingSurface,createRomanBuildingRecipe } from '../src/render-common/buildings/building-recipe';
import { getRomanPartBounds } from '../src/render-common/buildings/building-recipe-fit';
import { createRomanBuilding } from '../src/renderers/three/buildings/roman-building';
const bounds=(recipe:ReturnType<typeof createRomanBuildingRecipe>)=>{
  const box=new Box3();for(const part of recipe.parts.filter(part=>part.stage===1)){
    const partBounds=getRomanPartBounds(part);box.union(new Box3(new Vector3(...partBounds.min),new Vector3(...partBounds.max)));
  }return box.getSize(new Vector3());
};
it.each([true,false])('matches only forester wall width, retaining woodcutter depth/height/door and four-cell plot (%s)',detailed=>{
  const definition=getBuildingDefinition(17),recipe=createRomanBuildingRecipe(definition,detailed);
  const forester=createRomanBuildingRecipe(getBuildingDefinition(20),detailed);
  const body=bounds(recipe);expect(body.x).toBeCloseTo(bounds(forester).x,6);
  expect(body.x).toBeCloseTo(1.64,6);expect(body.y).toBeCloseTo(1.17,6);expect(body.z).toBeCloseTo(1.205,6);
  expect(recipe.doorDimensions).toEqual(forester.doorDimensions);expect(recipe.doorDimensions?.width).toBe(.46);
  expect(definition.gridFootprint).toEqual([4,4]);
  const wood=recipe.parts.filter(part=>part.stock?.ware==='logs' && part.surface==='bark');
  expect(wood).toHaveLength(6);expect(wood.every(part=>{const b=getRomanPartBounds(part);return b.min[2]>.63 && b.max[0]<-.23;})).toBe(true);
  const material=new MeshStandardMaterial(),materials=Object.fromEntries(recipe.parts.map(part=>[part.surface,material])) as Record<BuildingSurface,MeshStandardMaterial>;
  const model=createRomanBuilding(definition,materials,detailed);model.fitToGrid();
  expect(model.triangles()).toBeLessThan(detailed?10000:1800);
  for(const rotation of [0,1,2,3]){
    model.root.rotation.y=rotation*Math.PI/2;model.update(0,{construction:1,door:1,working:true});model.root.updateMatrixWorld(true);
    const box=new Box3().setFromObject(model.root);
    expect(box.min.x).toBeGreaterThanOrEqual(-2.001);expect(box.max.x).toBeLessThanOrEqual(2.001);
    expect(box.min.z).toBeGreaterThanOrEqual(-2.001);expect(box.max.z).toBeLessThanOrEqual(2.001);
  }
  model.dispose();material.dispose();
});
