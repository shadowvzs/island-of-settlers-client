import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { buildingPartNavigationVolumes } from "../src/render-common/buildings/building-navigation-profile";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createChineseBuildingRecipe } from "../src/render-common/buildings/chinese-building-recipe";
import { chineseRoofSoffit } from "../src/render-common/buildings/chinese-roof-bearings";
import { chineseRoofBeddingHeight } from "../src/render-common/buildings/chinese-roof-bedding";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createLevelPlanRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { getRomanWareStockInventoryParts } from "../src/render-common/buildings/roman-ware-stock";
import { createChinesePanCoverRoof } from "../src/renderers/three/buildings/chinese-pan-cover-roof";
import { createChineseRoofBearingGeometry } from "../src/renderers/three/buildings/chinese-roof-bearing-geometry";

const control = vi.hoisted(() => ({ disableFarmRepair: false }));
vi.mock("../src/render-common/buildings/chinese-roof-bearings", async importOriginal => {
  const original = await importOriginal<typeof import("../src/render-common/buildings/chinese-roof-bearings")>();
  return { ...original, fitChineseFarmWingBearings: (...args: Parameters<typeof original.fitChineseFarmWingBearings>) =>
    control.disableFarmRepair ? args[0] : original.fitChineseFarmWingBearings(...args) };
});

it.each([true, false])("supports the CURRENT farm's smaller rear roof using its actual rendered soffit (%s)", detailed => {
  for (const level of [1, 2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(getBuildingDefinition(37),"chinese",detailed,level);
    const roof = recipe.parts.find(part => part.shape === "occupation-roof" && part.position[0] > .2)!;
    const geometry = createChinesePanCoverRoof(roof,detailed),material = new MeshBasicMaterial({side:DoubleSide});
    const mesh = new Mesh(geometry,material);
    mesh.scale.set(...roof.size);mesh.position.set(...roof.position);
    if(roof.rotation)mesh.rotation.set(...roof.rotation);mesh.updateMatrixWorld(true);
    const bearings=recipe.parts.filter(part=>part.chineseRoofBearingProfile).map(part=>{
      const bearing=new Mesh(createChineseRoofBearingGeometry(part.chineseRoofBearingProfile!),material);
      bearing.scale.set(...part.size);bearing.position.set(...part.position);bearing.updateMatrixWorld(true);return bearing;
    });
    try {
      expect(bearings).toHaveLength(3);
      for(const x of [.42,.52,.62,.72,.82,.92,1.02]) {
        const z=-.845;
        const hit=new Raycaster(new Vector3(x,.8,z),new Vector3(0,1,0)).intersectObject(mesh)[0];
        expect(hit,`${level}/${x}`).toBeDefined();
        const bearingHit=new Raycaster(new Vector3(x,3,z),new Vector3(0,-1,0)).intersectObjects(bearings)[0];
        expect(bearingHit).toBeDefined();const head=bearingHit!.point.y;
        expect(head,`${level}/${x}: no open gap under rear roof`).toBeGreaterThanOrEqual(hit!.point.y-.002);
      }
    } finally {geometry.dispose();bearings.forEach(bearing=>bearing.geometry.dispose());material.dispose();}
  }
});

it("changes no roof transforms, navigation volumes, anchors, stock or outer envelope at any tier/LOD", () => {
  const definition=getBuildingDefinition(37);
  for(const detailed of [true,false])for(const level of [1,2,3,4,5] as const) {
    const original=createLevelPlanRecipe(definition,detailed,level).plan;
    control.disableFarmRepair=true;
    const before=createChineseBuildingRecipe(original,definition,detailed);
    control.disableFarmRepair=false;
    const after=createChineseBuildingRecipe(original,definition,detailed);
    const beforeBounds=getRomanRecipeBounds(definition,before),afterBounds=getRomanRecipeBounds(definition,after);
    expect(afterBounds).toEqual(beforeBounds);
    expect(after.parts.filter(part=>part.shape==="occupation-roof")).toEqual(before.parts.filter(part=>part.shape==="occupation-roof"));
    expect(buildingPartNavigationVolumes(after.parts,getRomanBuildingWorldSizing(definition).scale))
      .toEqual(buildingPartNavigationVolumes(before.parts,getRomanBuildingWorldSizing(definition).scale));
    for(const key of ["door","workerExit","workPoint","mechanism","doorDimensions"] as const)
      expect(after[key]).toEqual(before[key]);
    expect(after.parts.filter(part=>part.stock)).toEqual(before.parts.filter(part=>part.stock));
    expect(getRomanWareStockInventoryParts(after,getRomanBuildingWorldSizing(definition).scale,{}, {grain:6}).filter(part=>part.stock))
      .toEqual(getRomanWareStockInventoryParts(before,getRomanBuildingWorldSizing(definition).scale,{}, {grain:6}).filter(part=>part.stock));
    const roof=after.parts.find(part=>part.shape==="occupation-roof"&&part.position[0]>.2)!;
    for(const cap of after.parts.slice(before.parts.length)) {
      const material=new MeshBasicMaterial({side:DoubleSide});
      const geometry=createChineseRoofBearingGeometry(cap.chineseRoofBearingProfile!);
      const bearing=new Mesh(geometry,material);bearing.scale.set(...cap.size);bearing.position.set(...cap.position);
      bearing.updateMatrixWorld(true);
      try {for(const u of [-.999,-.5,0,.5,.999])for(const v of [-.999,-.5,0,.5,.999]) {
        const x=cap.position[0]+u*cap.size[0]/2,z=cap.position[2]+v*cap.size[2]/2;
        const hit=new Raycaster(new Vector3(x,3,z),new Vector3(0,-1,0)).intersectObject(bearing)[0];
        expect(hit).toBeDefined();const head=hit!.point.y;
        const roofY=chineseRoofSoffit(roof,x,z,detailed);
        const skin=chineseRoofBeddingHeight(roof,(x-roof.position[0])/roof.size[0],(z-roof.position[2])/roof.size[2],detailed);
        if(roofY!==null&&skin!==null) {
          expect(head).toBeGreaterThanOrEqual(roofY-.004);
          expect(head).toBeLessThanOrEqual(roof.position[1]+skin*roof.size[1]+.0001);
        }
      }} finally {geometry.dispose();material.dispose();}
    }
    expect(after.parts.length).toBeGreaterThan(before.parts.length); // Real supported bearing pieces exist.
  }
});

it.each([true,false])("keeps every current farm tier inside strict mesh budgets (%s)", async detailed => {
  const {createRomanBuilding}=await import("../src/renderers/three/buildings/roman-building");
  const {createPlainBuildingMaterials}=await import("./helpers/building-materials");
  const {nationTriangleBudget}=await import("../src/render-common/buildings/building-triangle-budgets");
  const materials=createPlainBuildingMaterials(),definition=getBuildingDefinition(37);
  try {
    for(const level of [1,2,3,4,5] as const) {
      const recipe=leveledBuildingRecipe(definition,"chinese",detailed,level);
      const model=createRomanBuilding(definition,materials,detailed,recipe,"chinese");
      try {expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget("chinese",37)[detailed?0:1]);}
      finally {model.dispose();}
    }
  } finally {Object.values(materials).forEach(material=>material.dispose());}
});

it("builds a closed continuous bearing in both wall orientations without interior end caps", () => {
  for(const axis of [0,2] as const) {
    const geometry=createChineseRoofBearingGeometry({axis,across:[-.5,0,.5],samples:[{share:0,heights:[-.2,-.19,-.18]},{share:.3,heights:[.1,.11,.12]},{share:.65,heights:[.3,.28,.26]},{share:1,heights:[.12,.11,.1]}]});
    try {
      const points=geometry.getAttribute("position"),edges=new Map<string,number>();
      const vertex=(i:number)=>[points.getX(i),points.getY(i),points.getZ(i)].map(value=>value.toFixed(7)).join(",");
      for(let i=0;i<points.count;i+=3)for(const [a,b] of [[i,i+1],[i+1,i+2],[i+2,i]]) {
        const edge=[vertex(a!),vertex(b!)].sort().join("/");edges.set(edge,(edges.get(edge)??0)+1);
      }
      expect([...edges.values()].every(count=>count===2)).toBe(true);
      expect(geometry.boundingBox!.min.y).toBe(-.5);
    } finally {geometry.dispose();}
  }
});
