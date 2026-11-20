import { expect, it } from "vitest";

import { CATAPULT_SHAFT_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { catapultShellInnerRadius, type CatapultShellNation,catapultShellOuterRadius }
  from "../src/render-common/buildings/catapult-national-shell-profile";

const nations:CatapultShellNation[]=["roman","japanese","chinese","persian","nubian","indigenous","viking"];
it.each(nations)("protects the complete existing stair envelope and bounded connected shaft: %s",nation=>{
  for(const y of [.1,1.25,CATAPULT_SHAFT_HEIGHT-.7,CATAPULT_SHAFT_HEIGHT])for(let sample=0;sample<720;sample++) {
    const angle=(sample+.5)/720*Math.PI*2;
    const inner=catapultShellInnerRadius(nation,angle,y),outer=catapultShellOuterRadius(nation,angle,y);
    const oldInterior=.52/Math.max(Math.abs(Math.sin(angle)),Math.abs(Math.cos(angle)));
    expect(inner).toBeGreaterThanOrEqual(oldInterior);
    expect(outer-inner).toBeGreaterThan(.025);
    expect(Math.abs(outer*Math.sin(angle))).toBeLessThan(.85);
    expect(Math.abs(outer*Math.cos(angle))).toBeLessThan(.85);
  }
});

it.each(nations)("retains the diagonal upper hatch/landing pocket without reducing the old throat: %s",nation=>{
  for(let sample=1;sample<90;sample++) {
    const angle=Math.PI+sample/90*Math.PI/2;
    const minimum=Math.min(.61/Math.abs(Math.sin(angle)),.61/Math.abs(Math.cos(angle)));
    expect(catapultShellInnerRadius(nation,angle,CATAPULT_SHAFT_HEIGHT-.2)).toBeGreaterThanOrEqual(minimum-1e-10);
  }
});
