import {Group} from "three";
import {describe,expect,it} from "vitest";

import {withoutRefractionForeground} from "../src/renderers/three/three-refraction-pass";

describe("seabed-only refraction",()=>{
  it("excludes foreground ship and plot geometry while preserving prior visibility",()=>{
    const ship=new Group(),hidden=new Group(),bed=new Group();hidden.visible=false;
    expect(withoutRefractionForeground([ship,hidden],()=>{
      expect(ship.visible).toBe(false);expect(hidden.visible).toBe(false);expect(bed.visible).toBe(true);return 3;
    })).toBe(3);
    expect(ship.visible).toBe(true);expect(hidden.visible).toBe(false);
  });
  it("restores foreground geometry even if offscreen rendering throws",()=>{
    const ship=new Group();expect(()=>withoutRefractionForeground([ship],()=>{throw new Error("GPU context lost");})).toThrow("GPU context lost");
    expect(ship.visible).toBe(true);
  });
});
