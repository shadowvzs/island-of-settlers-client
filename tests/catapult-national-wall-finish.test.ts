import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { catapultShellInnerRadius, catapultShellOuterRadius, catapultShellVoid } from "../src/render-common/buildings/catapult-national-shell-profile";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it("uses the same actual wall surfaces as ordinary national buildings", () => {
  for (const nation of ["nubian", "persian", "chinese", "japanese", "viking"] as const) {
    const tower = leveledBuildingRecipe(getBuildingDefinition(16), nation, false, 1);
    const ordinary = leveledBuildingRecipe(getBuildingDefinition(9), nation, false, 1);
    const wall = tower.parts.find(part => part.shape === "catapult-national-shell")!;
    if(nation==="chinese") {
      expect(wall.surface).toBe("chinese-red-brick");
      expect(ordinary.parts.some(part=>part.surface==="chinese-red-brick")).toBe(false);
    }else if(nation==="japanese") {
      expect(wall.surface).toBe("japanese-catapult-stone");
      expect(ordinary.parts.some(part=>part.surface==="japanese-white-stone")).toBe(true);
      expect(ordinary.parts.some(part=>part.surface==="japanese-catapult-stone")).toBe(false);
    }else expect(ordinary.parts.some(part => part.surface === wall.surface), nation).toBe(true);
    if (nation === "chinese" || nation === "japanese") {
      const poles = tower.parts.filter(part => part.shape === "architectural-bamboo");
      if(nation==="chinese")expect(poles).toHaveLength(2);
      else expect(poles.length, nation).toBeGreaterThanOrEqual(12);
      expect(poles.every(part => part.surface === "japanese-bamboo")).toBe(true);
    }
    if (nation === "persian") expect(tower.parts.filter(part => part.shape === "catapult-shell-band" &&
      part.surface === "paint")).toHaveLength(2);
  }
});

it.each([true,false])("gives the Persian floral roundel real breathing room and a bonded curved backing (%s)",detailed=>{
  for(const level of [1,5] as const) {
    const recipe=leveledBuildingRecipe(getBuildingDefinition(16),"persian",detailed,level);
    const ornament=recipe.parts.filter(part=>part.catapultWallOrnament);
    expect(ornament.length).toBeGreaterThan(25);
    const bounds=ornament.map(part=>getRomanPartBounds(part)),bottom=Math.min(...bounds.map(bound=>bound.min[1]));
    const top=Math.max(...bounds.map(bound=>bound.max[1]));
    expect(bottom-1.168).toBeGreaterThan(.085);expect(1.70-top).toBeGreaterThan(.085);
    expect(bottom-1.105).toBeGreaterThan(.12);
    const plaque=ornament.find(part=>part.shape==="cylinder"&&part.size[0]>.3)!;
    const geometry=createRomanPartGeometry(plaque,detailed),p=geometry.getAttribute("position"),n=geometry.getAttribute("normal");
    let bonded=0;
    try {for(let vertex=0;vertex<p.count;vertex++)if(n.getZ(vertex)<-.6) {
      const wall=Math.sqrt(.82**2-p.getX(vertex)**2);
      expect(Math.abs(p.getZ(vertex)-wall)).toBeLessThan(.001);
      bonded++;
    }
    expect(bonded).toBeGreaterThan(5);
    }finally {geometry.dispose();}
  }
});

it.each([true,false])("forms continuous bedded masonry without attached boulders, entry hood or wall ornament (%s)",detailed=>{
  const recipe=leveledBuildingRecipe(getBuildingDefinition(16),"indigenous",detailed,5);
  expect(recipe.parts.some(part=>part.shape==="structural-rock")).toBe(false);
  expect(recipe.parts.some(part=>part.shape==="lean-thatch-roof"&&part.position[1]<1.4)).toBe(false);
  expect(recipe.parts.some(part=>part.surface==="hide"&&part.size[1]>.2)).toBe(false);
  const masonry=recipe.parts.filter(part=>part.shape==="indigenous-rubble-masonry");
  expect(masonry).toHaveLength(1);
  const geometry=createRomanPartGeometry(masonry[0]!,detailed),positions=geometry.getAttribute("position");
  let front=0,recess=0;
  try{for(let vertex=0;vertex<positions.count;vertex++){
    const x=positions.getX(vertex),y=positions.getY(vertex),z=positions.getZ(vertex),radius=Math.hypot(x,z);
    const angle=Math.atan2(x,z),outer=catapultShellOuterRadius("indigenous",angle,y);
    expect(radius-catapultShellInnerRadius("indigenous",angle,y)).toBeGreaterThanOrEqual(-.003);
    if(radius>outer+.007)front++;
    if(radius<outer-.01)recess++;
    expect(radius-outer).toBeLessThan(.045);
  }
  expect(front).toBeGreaterThan(50);expect(recess).toBeGreaterThan(50);
  }finally{geometry.dispose();}
});

it.each([true,false])("covers the masonry body continuously with real exposed stones, leaving mortar only in joints (%s)",detailed=>{
  const recipe=leveledBuildingRecipe(getBuildingDefinition(16),"indigenous",detailed,1);
  const material=new MeshBasicMaterial({side:DoubleSide});
  const meshes=recipe.parts.filter(part=>part.catapultRubble).map(part=>
    new Mesh(createRomanPartGeometry(part,detailed),material)).filter(mesh=>mesh.geometry.getAttribute("position").count>0);
  let covered=0,samples=0;
  try {for(const y of [.12,.35,.60,.95,1.20,1.45,1.70,2.20,2.40])for(let sample=0;sample<48;sample++) {
    const angle=sample*Math.PI/24;
    if(catapultShellVoid(angle,y))continue;
    const direction=new Vector3(Math.sin(angle),0,Math.cos(angle));
    const radius=catapultShellOuterRadius("indigenous",angle,y);
    const origin=direction.clone().multiplyScalar(radius+.30);origin.y=y;
    const hits=new Raycaster(origin,direction.negate(),0,.6).intersectObjects(meshes);
    if(hits[0])covered++;
    samples++;
  }
  expect(covered/samples).toBeGreaterThan(.85);
  }finally {for(const mesh of meshes)mesh.geometry.dispose();material.dispose();}
});

it.each([true,false])("keeps finite unit normals with worn shoulders and retained fracture planes (%s)",detailed=>{
  const recipe=leveledBuildingRecipe(getBuildingDefinition(16),"indigenous",detailed,1);
  const part=recipe.parts.find(candidate=>candidate.shape==="indigenous-rubble-masonry")!;
  const geometry=createRomanPartGeometry(part,detailed),p=geometry.getAttribute("position"),n=geometry.getAttribute("normal");
  const index=geometry.index,count=index?.count??p.count,vertexAt=(at:number)=>index?index.getX(at):at;
  let worn=0,sharp=0;
  try {for(let at=0;at<count;at+=3){
    const ids=[vertexAt(at),vertexAt(at+1),vertexAt(at+2)];
    const [a,b,c]=ids.map(id=>new Vector3().fromBufferAttribute(p,id));
    const face=b!.sub(a!).cross(c!.sub(a!));if(face.length()<1e-10)continue;face.normalize();
    for(const id of ids){
      const normal=new Vector3().fromBufferAttribute(n,id);
      expect(Number.isFinite(normal.x)&&Number.isFinite(normal.y)&&Number.isFinite(normal.z)).toBe(true);
      expect(normal.length()).toBeCloseTo(1,4);
      if(normal.dot(face)<.995)worn++;else sharp++;
    }
  }
  expect(worn,"real geometry retains rounded shading instead of only a painted smooth texture").toBeGreaterThan(100);
  expect(sharp,"fracture and mortar bearing planes retain their edges").toBeGreaterThan(10);
  }finally{geometry.dispose();}
});
