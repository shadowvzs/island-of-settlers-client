import { expect, it } from "vitest";

import { INDIGENOUS_BUILDING_MOTIFS,indigenousBuildingMotif } from "../src/render-common/buildings/indigenous-building-motifs";
import { indigenousCaveMineral } from "../src/renderers/three/buildings/indigenous-cave-art-minerals";
import { indigenousCaveScene } from "../src/renderers/three/buildings/indigenous-cave-art-scenes";

it("identifies exact mine resources and requested occupations without colouring unrelated buildings", () => {
  expect([10,11,12,13,43,47,51,55].map(indigenousBuildingMotif)).toEqual([
    "granite","coal","iron","gold","marble","limestone","basalt","granite"]);
  expect([57,58,59].map(indigenousBuildingMotif)).toEqual(["people2","people3","people4"]);
  expect([6, 21, 40].map(indigenousBuildingMotif)).toEqual(["berry-drink", "pig-head", "eagle"]);
  expect([17,26,33,36].map(indigenousBuildingMotif)).toEqual([undefined,undefined,undefined,undefined]);
});
it("gives every hand-painted identity a substantial, distinct shape within its textile panel", () => {
  const masks = INDIGENOUS_BUILDING_MOTIFS.map(motif=> {
    let mask="", ink=0;
    for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
      const mark=indigenousCaveScene(motif,x/32-1,y/32-1)||indigenousCaveMineral(motif,x/32-1,y/32-1);
      if(mark) ink++; mask+=mark?"1":"0";
    }
    expect(ink,motif).toBeGreaterThan(100); expect(ink,motif).toBeLessThan(2400);
    return mask;
  });
  expect(new Set(masks).size).toBe(INDIGENOUS_BUILDING_MOTIFS.length);
});
