import {Vector3} from "three";
import {describe,expect,it} from "vitest";

import {getBuildingDefinition} from "../src/render-common/buildings/building-catalog";
import {createRomanBuildingRecipe} from "../src/render-common/buildings/building-recipe";
import {getRomanWareStockSlots} from "../src/render-common/buildings/roman-ware-stock";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { createImportedPig } from "../src/renderers/three/buildings/imported-pig";
import {createRomanPigResidents} from "../src/renderers/three/buildings/roman-pig-residents";

describe("pig paid feeding visuals",()=>{
  it.each([true, false])("wanders and pauses inside the shelter without entering output stock, detail=%s", detailed => {
    const marker = createRomanBuildingRecipe(getBuildingDefinition(28), detailed).parts
      .find(part => part.shape === "pig-residents")!;
    const pigs = createRomanPigResidents(marker, detailed)!;
    const sow = pigs.animals[0]!;
    const positions = new Set<string>();
    let walking = false, standing = false;
    for (let tick = 0; tick < 1200; tick++) {
      pigs.update(tick * .05, true, "idle", 0);
      positions.add(`${sow.pig.position.x.toFixed(2)}:${sow.pig.position.z.toFixed(2)}`);
      expect(sow.pig.position.x).toBeGreaterThanOrEqual(.6);
      expect(sow.pig.position.x).toBeLessThanOrEqual(1.08);
      expect(sow.pig.position.z).toBeLessThanOrEqual(-.3);
      expect(sow.pig.position.z).toBeGreaterThanOrEqual(-.5);
      walking ||= sow.feet.some(foot => Math.abs(foot.rotation.x) > .1);
      standing ||= tick > 20 && sow.feet.every(foot => foot.rotation.x === 0);
    }
    expect(positions.size).toBeGreaterThan(20);
    expect(walking && standing).toBe(true);
    pigs.dispose();
  });
  it.each([true,false])("keeps grain and water input separate from trough fills, detail=%s",detailed=>{
    const recipe=createRomanBuildingRecipe(getBuildingDefinition(28),detailed);
    const slots=getRomanWareStockSlots(recipe).filter(slot=>slot.stock.kind==="input");
    for(const ware of ["grain","water"])expect(slots.filter(slot=>slot.stock.ware===ware).map(slot=>slot.stock.slot)).toEqual([0,1,2]);
    expect(recipe.parts.filter(part=>part.shape.startsWith("pig-feeding-")).every(part=>!part.stock)).toBe(true);
  });
  it.each([true, false])("keeps the shelter opening clear while retaining front and side fences, detail=%s", detailed => {
    const recipe = createRomanBuildingRecipe(getBuildingDefinition(28), detailed);
    const rails = recipe.parts.filter(part => part.surface === "wood" && part.size[0] === .97 &&
      part.size[1] === .035 && part.size[2] === .04);
    expect(rails).toHaveLength(2);
    expect(rails.every(part => Math.abs(part.position[2] - .82) < .001)).toBe(true);
  });
  it.each([true, false])("reduces canonical pig ware dimensions by ten percent, detail=%s", detailed => {
    const recipe = createWareRecipe("pig", detailed);
    const body = recipe.parts.find(part => part.surface === "paint" && part.size[0] > .3)!;
    expect(body.size).toEqual([.37 * .9, .21 * .9, .23 * .9]);
    const feet = recipe.parts.filter(part => part.surface === "dark");
    expect(feet).toHaveLength(4);
    expect(feet.every(part => Math.abs(part.position[1] + .062 * .9) < 1e-10)).toBe(true);
  });
  it.each([true,false])("mouths contact both troughs throughout paid growth at every rotation, detail=%s",detailed=>{
    const recipe=createRomanBuildingRecipe(getBuildingDefinition(28),detailed);
    const source=recipe.parts.find(part=>part.shape==="pig-residents")!;
    const feedingHeight=recipe.parts.find(part=>part.shape==="pig-feeding-water")!.position[1];
    const pigs=createRomanPigResidents({...source,position:[source.position[0],.13,source.position[2]]},detailed)!;
    for(const rotation of [0,1,2,3])for(const time of [0,6,12,18,24]){
      pigs.root.rotation.y=rotation*Math.PI/2;pigs.update(time,true,"breeding",time);pigs.root.updateMatrixWorld(true);
      expect(pigs.animals[0]!.pig.scale.x).toBe(.9);
      expect(pigs.animals[1]!.pig.scale.x).toBeCloseTo(.9 * (.5 + .5 * time / 24));
      pigs.animals.forEach((animal,index)=>{
        const target=pigs.root.localToWorld(new Vector3(index?1:.65,feedingHeight,.68));
        expect(animal.muzzle.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(.001);
      });
    }
    pigs.update(0,true,"idle",0);expect(pigs.animals[1]!.pig.visible).toBe(false);
    pigs.update(0,true,"water",.5);
    const stream=pigs.root.getObjectByName("pig_farm_pour_stream")!;
    expect(stream.visible).toBe(true);
    expect(stream.position.y - .15 * stream.scale.y).toBeCloseTo(feedingHeight);
    pigs.update(0,true,"water",1);expect(pigs.root.getObjectByName("pig_farm_pour_stream")!.visible).toBe(false);
    pigs.dispose();
  });
});


describe("imported pig derivative ownership and anatomical contact", () => {
  it.each([true, false])("keeps shared geometry alive when one animal is removed, detail=%s", detailed => {
    const first = createImportedPig(detailed), second = createImportedPig(detailed);
    expect(first.mesh.geometry).toBe(second.mesh.geometry);
    expect(first.mesh.material).toBe(second.mesh.material);
    expect(first.mesh.skeleton).not.toBe(second.mesh.skeleton);
    let disposed = false;
    const observe = () => { disposed = true; };
    first.mesh.geometry.addEventListener("dispose", observe);
    first.dispose();
    expect(disposed).toBe(false);
    expect(second.mesh.geometry.index!.count / 3).toBe(detailed ? 2454 : 490);
    const weights = second.mesh.geometry.getAttribute("skinWeight");
    for(let i=0;i<weights.count;i++) {
      expect(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)).toBeCloseTo(1,6);
    }
    second.mesh.geometry.removeEventListener("dispose", observe);
    second.dispose();
  });
  it.each([true, false])("the actual skinned nose follows the contact marker through growth, detail=%s", detailed => {
    const source=createRomanBuildingRecipe(getBuildingDefinition(28),detailed).parts.find(part=>part.shape==="pig-residents")!;
    const pigs=createRomanPigResidents({...source,position:[source.position[0],.13,source.position[2]]},detailed)!;
    for(const time of [0,6,12,18,24]) {
      pigs.update(time,true,"breeding",time);pigs.root.updateMatrixWorld(true);
      for(const animal of pigs.animals) {
        const positions=animal.mesh.geometry.getAttribute("position");
        let tip=0;
        for(let i=1;i<positions.count;i++)if(positions.getZ(i)>positions.getZ(tip))tip=i;
        const point=new Vector3().fromBufferAttribute(positions,tip);
        animal.mesh.applyBoneTransform(tip,point);animal.mesh.localToWorld(point);
        const marker=animal.muzzle.getWorldPosition(new Vector3());
        expect(point.distanceTo(marker)).toBeLessThan(.014);
      }
    }
    pigs.dispose();
  });
});
