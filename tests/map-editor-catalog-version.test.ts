import { contentCatalogVersion } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { getCatalogVersionWarning } from "../src/app/map-editor/catalog-version/helpers";
import { toEditorMap } from "../src/app/map-editor/map-startup";
import type { LoadedMap } from "../src/shared/world/save/map-reader";

const loadedWith = (version?: string) => ({
  animals: [], meta: { contentCatalogVersion: version, name: "Island", savedAt: 1, source: "forest=2" },
  terrain: null, world: {}
}) as unknown as LoadedMap;

describe("map editor content catalog version", () => {
  it("warns only when a loaded map stored another version", () => {
    const game = contentCatalogVersion();
    expect(getCatalogVersionWarning(undefined, game)).toBeNull();
    expect(getCatalogVersionWarning(game, game)).toBeNull();
    expect(getCatalogVersionWarning("00000000", game)).toEqual({ gameVersion: game, mapVersion: "00000000" });
  });

  it("carries the loaded map's version into the editor map", () => {
    const start = { error: "", loaded: loadedWith("0a1b2c3d") };
    expect(toEditorMap(start, { forest: 2 } as never, 1).contentCatalogVersion).toBe("0a1b2c3d");
    expect(toEditorMap(null, { forest: 2 } as never, 1).contentCatalogVersion).toBeUndefined();
  });
});
