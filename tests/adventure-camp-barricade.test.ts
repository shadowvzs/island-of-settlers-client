import {describe,expect,it} from "vitest";

import {adventureCampDecorations} from "../src/render-common/adventure/adventure-camp";
import {ADVENTURE_CAMP_THEMES} from "../src/render-common/adventure/adventure-camp-style";
import {createAdventureCampDecoration} from "../src/renderers/three/settlement/adventure-camp-model";
import {campDecorationObstacle} from "../src/shared/settlement/adventure-camp-obstacles";

describe("open rope-lashed camp barricades",()=>{
  it.each([false,true])("fits the shared collision envelope and keeps structural wind disabled (High=%s)",detailed=>{
    for(const theme of ADVENTURE_CAMP_THEMES){
      const geometry=createAdventureCampDecoration("palisade",detailed,theme);
      geometry.computeBoundingBox();const box=geometry.boundingBox!;
      const collider=campDecorationObstacle({id:0,x:0,z:0,theme},{kind:"palisade",x:0,z:0,yaw:0,radius:1.4})!;
      expect(Math.max(-box.min.x,box.max.x)).toBeLessThanOrEqual(collider.halfX);
      expect(Math.max(-box.min.z,box.max.z)).toBeLessThanOrEqual(collider.halfZ);
      expect(box.min.y).toBeGreaterThanOrEqual(0);expect(box.max.y).toBeLessThan(1.5);
      expect(new Set(Array.from(geometry.getAttribute("campFabric").array))).toEqual(new Set([0]));
      expect(new Set(Array.from(geometry.getAttribute("campWind").array))).toEqual(new Set([0]));
      expect(geometry.index!.count/3).toBeLessThan(detailed?500:450);geometry.dispose();
    }
  });
  it.each([false,true])("replaces existing sections inside all whole-camp budgets (High=%s)",detailed=>{
    for(const theme of ADVENTURE_CAMP_THEMES){
      const designs=adventureCampDecorations();
      expect(designs.filter(design=>design.kind==="palisade")).toHaveLength(2);
      let triangles=0;
      for(const design of designs){const geometry=createAdventureCampDecoration(design.kind,detailed,theme,design.variant);
        triangles+=geometry.index!.count/3;geometry.dispose();}
      expect(triangles).toBeLessThan(detailed?14000:4000);
    }
  });
});
