import { expect, it } from "vitest";

import { listBuildingSurfacePaints, nationSurfaceResolution, surfacePaintKey }
  from "../src/renderers/three/buildings/building-surface-paint";
import { createNationBuildingMaterials } from "../src/renderers/three/buildings/nation-building-materials";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("uses the same Minimal fine-fibre resolution in worker paint keys and native material upload",()=>{
  for(const nation of ["indigenous","maya"] as const) {
    const paints=listBuildingSurfacePaints(nation,false).filter(paint=>paint.nation===nation);
    const prepainted=new Map(paints.map(paint=>[surfacePaintKey(paint),
      [new Uint8ClampedArray(paint.resolution*paint.resolution*4)]]));
    const base=createPlainBuildingMaterials();
    const pack=createNationBuildingMaterials(base,nation,false,prepainted);
    const surface=nation==="indigenous"?"palm-thatch":"straw",expected=nation==="indigenous"?512:256;
    expect(paints.find(paint=>paint.surface===surface)!.resolution).toBe(expected);
    const image=pack.materials[surface].map!.image as {width:number;height:number};
    expect(image.width).toBe(expected);
    expect(image.height).toBe(expected);
    expect(pack.materials[surface].normalMap).toBeNull();
    pack.dispose();Object.values(base).forEach(material=>material.dispose());
  }
});

it("keeps High and all unrelated material resolutions unchanged",()=>{
  expect(nationSurfaceResolution("indigenous","palm-thatch",true)).toBe(1024);
  expect(nationSurfaceResolution("maya","straw",true)).toBe(1024);
  expect(nationSurfaceResolution("indigenous","palm-trunk",false)).toBe(128);
  expect(nationSurfaceResolution("japanese","leaf",false)).toBe(128);
});
