import { DataTexture } from "three";
import { describe, expect, it } from "vitest";

import { withPaletteField } from "../src/app/map-editor/ground-palette-editor";
import {
  createGroundPaletteMatrices, fillGroundPaletteMatrices, resolveThemePalettes, ROCK_TINTS, SAND_TINTS
} from "../src/render-common/ground-palette";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";
import { ISLAND_THEMES } from "../src/shared/world/generation/island-themes";
import { validGroundPalette } from "../src/shared/world/ground-palette";

const texture = new DataTexture(new Uint8Array(4), 1, 1);
const slot = (theme: (typeof ISLAND_THEMES)[number]) => ISLAND_THEMES.indexOf(theme);

describe("ground palette (GROUND-PALETTE)", () => {
  it("chooses the palette by theme and nation, and the island's choice overrides every theme", () => {
    const viking = resolveThemePalettes(undefined, { nation: "viking" });
    expect(viking[slot("meadow")]).toMatchObject({ sand: "grey", soil: "darkBrown" });
    expect(viking[slot("desert")]).toMatchObject({ sand: "golden", soil: "terraRossa" });
    expect(resolveThemePalettes(undefined, { nation: "nubian" })[slot("desert")]!.sand).toBe("red");
    expect(resolveThemePalettes(undefined, {})[slot("meadow")]).toMatchObject({ sand: "tan", soil: "brown" });
    expect(resolveThemePalettes(undefined, { expeditionTheme: "tropical", nation: "viking" })[slot("meadow")]!.sand)
      .toBe("white");
    const chosen = resolveThemePalettes({ sand: "black" }, { nation: "maya" });
    expect(chosen.every(palette => palette.sand === "black")).toBe(true);
    expect(chosen[slot("meadow")]!.soil).toBe("laterite");
    expect(resolveThemePalettes(undefined, { expeditionTheme: "swamp" })[slot("meadow")]!.swamp).toBe(1);
  });

  it("chooses the rock and the climate shares (step 5): sandstone deserts, basalt and heather in the north", () => {
    expect(resolveThemePalettes(undefined, { nation: "nubian" })[slot("desert")]!.rock).toBe("redSandstone");
    expect(resolveThemePalettes(undefined, { nation: "roman" })[slot("desert")]!.rock).toBe("golden");
    expect(resolveThemePalettes(undefined, { nation: "roman" })[slot("meadow")]!.rock).toBe("limestone");
    const viking = resolveThemePalettes(undefined, { nation: "viking" })[slot("meadow")]!;
    expect(viking).toMatchObject({ heather: 1, rock: "basalt" });
    expect(resolveThemePalettes({ rock: "grey" }, { nation: "viking" })[slot("meadow")]!.rock).toBe("grey");
  });

  it("packs one matrix column per theme: sand rgb + wet, soil rgb + swamp, rock rgb + lava, climate", () => {
    const matrices = createGroundPaletteMatrices();
    fillGroundPaletteMatrices(resolveThemePalettes({ rock: "basalt", sand: "white" }, { nation: "viking" }), matrices);
    expect(matrices.sand).toHaveLength(16);
    expect(matrices.sand.slice(0, 4)).toEqual([...SAND_TINTS.white.rgb, SAND_TINTS.white.wet]);
    expect(matrices.soil.slice(12, 16)).toEqual([0.76, 0.74, 0.8, 0]);
    expect(matrices.rock.slice(0, 4)).toEqual([...ROCK_TINTS.basalt.rgb, 1]);
    expect(matrices.climate.slice(0, 4)).toEqual([1, 0, 0, 0]);
  });

  it("validates saved palettes and edits one field at a time", () => {
    expect(validGroundPalette({ sand: "white", soil: "loess" })).toBe(true);
    expect(validGroundPalette({ sand: "pinkish" })).toBe(false);
    expect(validGroundPalette({ colour: "red" })).toBe(false);
    expect(validGroundPalette({ rock: "limestone", soil: "chalk" })).toBe(true);
    expect(validGroundPalette({ toString: "grey" })).toBe(false);
    expect(withPaletteField({ sand: "golden" }, "rock", "basalt")).toEqual({ rock: "basalt", sand: "golden" });
    expect(withPaletteField(undefined, "sand", "golden")).toEqual({ sand: "golden" });
    expect(withPaletteField({ sand: "golden", soil: "loess" }, "sand", "auto")).toEqual({ soil: "loess" });
    expect(withPaletteField({ sand: "golden" }, "sand", "auto")).toBeUndefined();
  });

  it("feeds the theme weights and the context into both ground variants", () => {
    for (const variant of ["full", "lite"] as const) {
      const material = createTerrainMaterial({}, texture, texture, variant);
      expect(material.vertexShader).toContain("vTheme = theme;");
      expect(material.fragmentShader).toContain("getGroundDryness(vTheme, vSurface)");
      expect(material.fragmentShader).toContain("applyGroundPalette(ground, groundContext);");
      expect(material.fragmentShader).toContain("applyGroundVariants(ground, detail");
      expect(material.uniforms.uSandPalette).toBeDefined();
    }
  });
});
