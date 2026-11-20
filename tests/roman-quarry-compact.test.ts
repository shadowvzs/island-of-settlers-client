import {Box3,MeshStandardMaterial} from 'three';
import {expect,it} from 'vitest';

import {getBuildingDefinition} from '../src/render-common/buildings/building-catalog';
import {type BuildingSurface,createRomanBuildingRecipe} from '../src/render-common/buildings/building-recipe';
import {getRomanPartBounds} from '../src/render-common/buildings/building-recipe-fit';
import {createRomanBuilding} from '../src/renderers/three/buildings/roman-building';
it.each([true,false])('keeps the original quarry body/door and six reachable stones within4×4 at every rotation (%s)',detailed=>{
 const definition=getBuildingDefinition(19),recipe=createRomanBuildingRecipe(definition,detailed);
 expect(definition.gridFootprint).toEqual([4,4]);expect(recipe.doorDimensions?.width).toBe(.46);
 const output=recipe.parts.filter(part=>part.stock?.ware==='stone');expect(output).toHaveLength(6);
 expect(new Set(output.map(part=>part.stock!.slot)).size).toBe(6);
 for(const part of output){const box=getRomanPartBounds(part);expect(box.min[2]).toBeGreaterThan(.65);expect(box.max[0]).toBeLessThan(.07);}
 const material=new MeshStandardMaterial(),materials=Object.fromEntries(recipe.parts.map(part=>[part.surface,material])) as Record<BuildingSurface,MeshStandardMaterial>;
 const model=createRomanBuilding(definition,materials,detailed);model.fitToGrid();expect(model.triangles()).toBeLessThan(detailed?10000:1800);
 for(const rotation of [0,1,2,3]){model.root.rotation.y=rotation*Math.PI/2;model.update(1,{construction:1,door:1,working:true,outputStock:{stone:6}});model.root.updateMatrixWorld(true);
  const box=new Box3().setFromObject(model.root);expect(box.min.x).toBeGreaterThan(-2.001);expect(box.min.z).toBeGreaterThan(-2.001);expect(box.max.x).toBeLessThan(2.001);expect(box.max.z).toBeLessThan(2.001);}
 model.dispose();material.dispose();
});
