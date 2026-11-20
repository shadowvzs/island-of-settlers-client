import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { doorGapOf } from "../src/render-common/buildings/nation-kit-parts";
import { createRomanBuilding,createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("reuses shipyard reed construction for four working buildings with clear real entries (%s)", detailed => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const id of [6, 17, 26, 33]) for (const level of [1, 5] as const) {
      const definition = getBuildingDefinition(id);
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const panels = recipe.parts.filter(part => part.shape === "bevel-box" && part.surface === "cloth-reeds");
      expect(panels.length, `${id}/${level} actual wall panels`).toBeGreaterThanOrEqual(5);
      expect(recipe.parts.some(part => part.indigenousPigment)).toBe(false);
      expect(recipe.parts.some(part => part.indigenousRoof === "tipi" || part.indigenousRoof === "earth")).toBe(false);
      const door = doorGapOf(recipe), centre = (door.left + door.right) / 2;
      for (const panel of panels) {
        const bounds = getRomanPartBounds(panel);
        const blocksCentre = bounds.min[0] < centre && bounds.max[0] > centre &&
          bounds.min[1] < door.top * .5 && bounds.max[1] > door.top * .5 &&
          bounds.min[2] < door.z + .04 && bounds.max[2] > door.z - .04;
        expect(blocksCentre, `${id}/${level} doorway clear`).toBe(false);
      }
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      try { expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget("indigenous", id)[detailed ? 0 : 1]); }
      finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("keeps full sawmill roof timber meshes below the weather cover",()=>{
  for(const detailed of [true,false]) {
    const recipe=leveledBuildingRecipe(getBuildingDefinition(33),"indigenous",detailed,1);
    const roofs=recipe.parts.filter(part=>part.shape==="indigenous-roof");
    for(const part of recipe.parts) {
      if(part.stock||!["wood","bark","planks"].includes(part.surface))continue;
      const geometry=createRomanPartGeometry(part,detailed),positions=geometry.getAttribute("position");
      try {for(let vertex=0;vertex<positions.count;vertex++) {
        const x=positions.getX(vertex),y=positions.getY(vertex),z=positions.getZ(vertex);
        const cover=roofTopAt(roofs,x,z,detailed);
        if(cover===null)continue;
        expect(y,JSON.stringify({detailed,part,point:[x,y,z],cover})).toBeLessThanOrEqual(cover+.01);
      }
      if(part.shape==="roof-infill") {
        const index=geometry.index,count=index?.count??positions.count;
        for(let at=0;at<count;at+=3) {
          for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[.5,0,.5],[0,.5,.5]]) {
            let x=0,y=0,z=0;
            for(let corner=0;corner<3;corner++) {
              const vertex=index?index.getX(at+corner):at+corner,weight=weights[corner]!;
              x+=positions.getX(vertex)*weight;y+=positions.getY(vertex)*weight;z+=positions.getZ(vertex)*weight;
            }
            const cover=roofTopAt(roofs,x,z,detailed);
            if(cover===null)continue;
            expect(y,`infill triangle ${at/3} below curved cloth`).toBeLessThanOrEqual(cover+.005);
          }
        }
      }}finally {geometry.dispose();}
    }
  }
});

it("keeps every sawmill truss below its replacement weather cover",()=>{
  for(const detailed of [true,false])for(const level of [1,5] as const) {
    const recipe=leveledBuildingRecipe(getBuildingDefinition(33),"indigenous",detailed,level);
    const roofs=recipe.parts.filter(part=>part.shape==="indigenous-roof"&&part.indigenousRoof==="awning"&&part.size[0]*part.size[2]>.3);
    expect(roofs.length).toBeGreaterThanOrEqual(1);
    const trusses=recipe.parts.filter(part=>part.shape==="box"&&["wood","bark"].includes(part.surface)&&
      part.size[0]<.05&&part.size[1]<.05&&part.size[2]>.1&&part.position[1]>1);
    expect(trusses.length).toBeGreaterThan(0);
    for(const part of trusses) {
      const top=roofTopAt(roofs,part.position[0],part.position[2],detailed);
      expect(top,`${detailed}/${level} truss has cover`).not.toBeNull();
      expect(part.position[1]+part.size[1]/2).toBeLessThan(top!+.015);
    }
    const posts=recipe.parts.filter(part=>part.shape==="cylinder"&&part.surface==="wood"&&
      part.size[0]===.045&&!part.rotation);
    expect(posts.length).toBeGreaterThan(0);
    for(const post of posts) {
      const top=roofTopAt(roofs,post.position[0],post.position[2],detailed);
      expect(top,`${detailed}/${level} post has cover`).not.toBeNull();
      expect(post.position[1]+post.size[1]/2).toBeLessThan(top!-.015);
    }
  }
});
