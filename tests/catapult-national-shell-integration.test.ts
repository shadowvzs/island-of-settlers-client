import { DoubleSide,Mesh,MeshBasicMaterial,Raycaster,Vector3 } from "three";
import { expect,it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";
import { createRomanBuilding,createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { meshTriangleCount } from "./helpers/visible-mesh-bounds";

const nations:WorkerNation[]=["roman","japanese","chinese","persian","nubian","indigenous","viking","maya"];
it.each([true,false])("renders actual distinct national shells without changing machinery contracts (%s)",detailed=>{
  const materials=createPlainBuildingMaterials(),definition=getBuildingDefinition(16);
  const baseline=createCatapultTowerRecipe("maya",detailed);
  try {for(const nation of nations) {
    const recipe=createCatapultTowerRecipe(nation,detailed);
    expect(recipe.door).toEqual(baseline.door);
    expect(recipe.workPoint).toEqual(baseline.workPoint);
    expect(recipe.workerExit).toEqual(baseline.workerExit);
    expect(recipe.parts.filter(part=>part.catapultPart||part.stock))
      .toEqual(baseline.parts.filter(part=>part.catapultPart||part.stock));
    expect(recipe.parts.filter(part=>part.shape==="catapult-national-shell")).toHaveLength(nation==="maya"?0:1);
    expect(recipe.parts.filter(part=>part.windowShadow)).toHaveLength(nation==="chinese"?3:2);
    const model=createNationBuilding(definition,materials,nation,detailed,1);
    try {
      // Granite-bundle and marble-sphere overlays are hidden alternatives attached per stone
      // (da86c8b45, a3a0b3448); count the triangles actually drawn for this model instead.
      expect.soft(meshTriangleCount(model.root),nation).toBeLessThanOrEqual(detailed?15000:3450);
      let panes=0;
      model.root.traverse(object=>{
        if(!(object instanceof Mesh))return;
        if(object.userData.buildingSurface==="wood")for(const material of
          Array.isArray(object.material)?object.material:[object.material]){
          expect(material.opacity,"actual national timber frame remains opaque").toBe(1);
          expect(material.transparent).toBe(false);
        }
        if(!object.userData.windowShadow)return;
        panes++;
        for(const material of Array.isArray(object.material)?object.material:[object.material]) {
          expect(material.opacity).toBe(.5);expect(material.transparent).toBe(true);
        }
      });
      expect(panes,`${nation}: actual transparent window batch`).toBeGreaterThan(0);
      if(nation==="persian") {
        let glass=0;
        model.root.traverse(object=>{
          if(!(object instanceof Mesh)||!object.userData.windowGlass)return;
          glass++;
          for(const material of Array.isArray(object.material)?object.material:[object.material]) {
            expect(material.transparent).toBe(true);expect(material.opacity).toBe(.5);
            expect(material.depthWrite).toBe(false);
          }
        });
        expect(glass,"separate coloured glass batch, opaque wood remains in the normal material batch").toBe(1);
      }
    } finally {model.dispose();}
  }} finally {Object.values(materials).forEach(material=>material.dispose());}
});

it.each([true,false])("keeps national tower upgrades within the same caps (%s)",detailed=>{
  const materials=createPlainBuildingMaterials(),definition=getBuildingDefinition(16);
  try {for(const nation of nations)for(const level of [1,2,3,4,5] as const) {
    const recipe=leveledBuildingRecipe(definition,nation,detailed,level);
    const model=createRomanBuilding(definition,materials,detailed,recipe,nation);
    try {expect.soft(meshTriangleCount(model.root),`${nation}/${level}`).toBeLessThanOrEqual(detailed?15000:3450);}
    finally {model.dispose();}
  }}finally {Object.values(materials).forEach(material=>material.dispose());}
},10000);

it.each([true,false])("keeps actual upgraded window openings clear of opaque accessory and wall geometry (%s)",detailed=>{
  const material=new MeshBasicMaterial({side:DoubleSide}),definition=getBuildingDefinition(16);
  try {for(const nation of nations)for(const level of [1,5] as const) {
    const recipe=leveledBuildingRecipe(definition,nation,detailed,level);
    const opaque=recipe.parts.filter(part=>!part.stock&&!part.windowShadow&&part.shape!=="catapult-window-glass").map(part=>{
      const mesh=new Mesh(createRomanPartGeometry(part,detailed),material);mesh.userData.shape=part.shape;return mesh;
    });
    try {for(const pane of recipe.parts.filter(part=>part.windowShadow)) {
      const angle=pane.rotation?.[1]??0;
      const normal=pane.size[0]<pane.size[2]?new Vector3(Math.sign(pane.position[0]),0,0):
        new Vector3(Math.sin(angle),0,Math.cos(angle));
      const tangent=new Vector3(normal.z,0,-normal.x);
      // Original rectangular holes retain the original full ray grid. Fitted arches/lattices
      // deliberately occupy some of those old points: probe actual open cells instead.
      let acrossSamples=[-.10,0,.10],upSamples=[-.12,0,.12];
      if(pane.catapultWindowStyle==="roman-arch") {acrossSamples=[-.065,.065];upSamples=[-.09,.015,.055];}
      if(pane.catapultWindowStyle==="persian-pointed") {acrossSamples=[-.06,.06];upSamples=[-.07,-.02,.10];}
      if(pane.catapultWindowStyle==="japanese-shoji") {acrossSamples=[-.031,.031];upSamples=[-.039,.039];}
      if(pane.catapultWindowStyle==="chinese-round") {acrossSamples=[-.12,.12];upSamples=[-.05,.05];}
      for(const across of acrossSamples)for(const up of upSamples) {
        const start=new Vector3(...pane.position).addScaledVector(normal,.23).addScaledVector(tangent,across);
        start.y+=up;
        const hits=new Raycaster(start,normal.clone().negate(),0,.47).intersectObjects(opaque);
        expect(hits.map(hit=>hit.object.userData.shape),`${nation}/${level}/${across}/${up}`).toEqual([]);
      }
    }}finally {opaque.forEach(mesh=>mesh.geometry.dispose());}
  }}finally {material.dispose();}
});

it.each([true,false])("recesses each actual fitted window backing behind the full opaque frame thickness (%s)",detailed=>{
  for(const nation of ["chinese","persian","roman","japanese"] as const){
    const recipe=leveledBuildingRecipe(getBuildingDefinition(16),nation,detailed,1);
    for(const pane of recipe.parts.filter(part=>part.windowShadow&&part.catapultWindowStyle)){
      const frames=recipe.parts.filter(part=>part.shape==="catapult-window-frame"&&
        part.catapultWindowStyle===pane.catapultWindowStyle);
      const distance=(part:typeof pane)=>Math.hypot(...part.position.map((value,axis)=>value-pane.position[axis]!));
      const frame=frames.reduce((nearest,part)=>distance(part)<distance(nearest)?part:nearest);
      const glass=createRomanPartGeometry(pane,detailed),timber=createRomanPartGeometry(frame,detailed);
      const angle=pane.rotation?.[1]??0,normal=new Vector3(Math.sin(angle),0,Math.cos(angle));
      const extent=(geometry:typeof glass)=>{
        const positions=geometry.getAttribute("position"),values:number[]=[];
        for(let vertex=0;vertex<positions.count;vertex++)
          values.push(positions.getX(vertex)*normal.x+positions.getZ(vertex)*normal.z);
        return {min:Math.min(...values),max:Math.max(...values)};
      };
      try{
        expect(extent(timber).min-extent(glass).max,`${nation}: actual alpha pane behind back of timber rim`)
          .toBeGreaterThan(.005);
      }finally{glass.dispose();timber.dispose();}
    }
  }
});

it.each([true,false])("shows a shaded far interior through the Chinese circle without darkening its exterior (%s)",detailed=>{
  const recipe=leveledBuildingRecipe(getBuildingDefinition(16),"chinese",detailed,1);
  const shell=recipe.parts.find(part=>part.shape==="catapult-national-shell")!;
  const geometry=createRomanPartGeometry(shell,detailed),material=new MeshBasicMaterial({side:DoubleSide});
  try{
    const hits=new Raycaster(new Vector3(0,1.49,-1.2),new Vector3(0,0,1),0,3)
      .intersectObject(new Mesh(geometry,material));
    expect(hits[0]!.point.z,"the visible brick is the opposite interior, never an opaque disk in the aperture")
      .toBeGreaterThan(.50);
    const p=geometry.getAttribute("position"),n=geometry.getAttribute("normal"),colour=geometry.getAttribute("color");
    let inside=0,outside=0;
    for(let vertex=0;vertex<p.count;vertex++){
      const facing=p.getX(vertex)*n.getX(vertex)+p.getZ(vertex)*n.getZ(vertex);
      if(facing<-.20){expect(colour.getX(vertex)).toBeLessThan(.4);expect(colour.getX(vertex)).toBeGreaterThan(0);inside++;}
      if(facing>.20){expect(colour.getX(vertex)).toBeCloseTo(1,5);outside++;}
    }
    expect(inside).toBeGreaterThan(20);expect(outside).toBeGreaterThan(20);
  }finally{geometry.dispose();material.dispose();}
});
