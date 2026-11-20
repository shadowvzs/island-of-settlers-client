import { Texture, TextureLoader } from "three";
import { describe, expect, it, vi } from "vitest";

import { getNationBuildingIconSource } from "../src/app/settlement-ui/building-icons";
import { getWareIconSource } from "../src/app/settlement-ui/inventory";
import { productionBuildingIconSource } from "../src/render-common/buildings/production-icon-sources";
import { createBuildingRoadMarkers } from "../src/renderers/three/buildings/building-road-marker";

describe("textile producer output art", () => {
  it("uses the tea leaf on the actual road post and the Chinese TeaHouse model in the menu",()=>{
    const leaf=getWareIconSource("teaLeaves"),sources:string[]=[];
    expect(productionBuildingIconSource(6,"chinese")).toBe(leaf);
    expect(getNationBuildingIconSource(6,"chinese")).toContain("chinese-6.png");
    for(const nation of ["roman","viking","nubian","japanese","maya","persian","indigenous"] as const)
      expect(productionBuildingIconSource(6,nation)).toBeUndefined();
    vi.stubGlobal("document",{});
    const load=vi.spyOn(TextureLoader.prototype,"load").mockImplementation(source=>{sources.push(source);return new Texture();});
    const view=createBuildingRoadMarkers();
    try {
      view.update(view.create(),{construction:1,door:0,id:"tea",nation:"chinese",rotation:0,type:6,
        working:false,x:20,y:0,z:20});
      expect(sources.at(-1)).toBe(leaf);
    } finally {view.dispose();load.mockRestore();vi.unstubAllGlobals();}
  });
  it.each([[60, "flax"], [61, "cloth"]] as const)(
    "building %s uses output artwork for signs and actual national models for menu buttons", (type, ware) => {
      const output = getWareIconSource(ware);
      expect(productionBuildingIconSource(type)).toBe(output);
      for (const nation of ["roman", "viking", "nubian", "japanese"] as const)
        expect(getNationBuildingIconSource(type, nation)).toContain(`${nation}-${type}.png`);
    }
  );

  it("keeps a national building render for the commander lodge, which has no output ware", () => {
    expect(productionBuildingIconSource(62)).toBeUndefined();
    expect(getNationBuildingIconSource(62, "viking")).toContain("viking-62");
  });

  it("loads the output PNG on actual road-marker materials for every nation", () => {
    const sources: string[] = [];
    vi.stubGlobal("document", {});
    const load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation(source => {
      sources.push(source);
      return new Texture();
    });
    const view = createBuildingRoadMarkers();
    try {
      for (const nation of ["roman", "viking", "nubian", "japanese"] as const)
        for (const type of [60, 61]) {
          const marker = view.create();
          view.update(marker, { construction: 1, door: 0, id: `building-${type}`, nation,
            rotation: 0, type, working: false, x: 20, y: 0, z: 20 });
          expect(sources.at(-1)).toBe(productionBuildingIconSource(type));
        }
    } finally {
      view.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
