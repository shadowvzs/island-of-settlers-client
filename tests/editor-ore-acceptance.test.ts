import { describe, expect, it } from "vitest";

import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { listOreQuantities, setOreZoneQuantity } from "../src/shared/world/editing/ore-quantity";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { ORE } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

describe("editor finite ore quantity lifecycle", () => {
  it.each([ORE.coal, ORE.iron, ORE.gold, ORE.granite])(
    "keeps zone/source boundaries and surveys while exact totals exhaust/refill type %s", async ore => {
      const world = cachedWorld(SMALL_EDITOR_WORLD), cells = [2000, 2001, 2096, 2097];
      world.mineZone.fill(0); world.oreAmount.fill(0);
      world.mineZones = [{ id: 1, ore, centreX: 80, centreZ: 20, cellCount: cells.length,
        richness: .5, surveyed: true }];
      for (const cell of cells) { world.mineZone[cell] = 1; world.oreAmount[cell] = 20; }
      const boundaries = world.mineZone.slice(), identity = structuredClone(world.mineZones[0]!);
      for (const [amount, mode] of [[37, "total"], [0, "total"], [255, "per-cell"]] as const) {
        const snapshot = createWorldSnapshot(world, null); snapshot.capture();
        const before = world.oreAmount.slice();
        expect(setOreZoneQuantity(world, 1, amount, mode)).not.toBeNull();
        const total = mode === "total" ? amount : amount * cells.length;
        expect(listOreQuantities(world)).toEqual([{ id: 1, ore, cells: cells.length, total,
          minimum: Math.floor(total / cells.length), maximum: Math.ceil(total / cells.length) }]);
        expect(world.mineZone).toEqual(boundaries);
        expect(world.mineZones[0]).toMatchObject({ ...identity, richness: world.mineZones[0]!.richness });
        const after = world.oreAmount.slice(), diff = snapshot.diff()!;
        applyWorldDiff(world, null, diff, "before"); expect(world.oreAmount).toEqual(before);
        applyWorldDiff(world, null, diff, "after"); expect(world.oreAmount).toEqual(after);
        const loaded = (await readMapFile(await writeMapFile(world,
          { name: "Finite ore lifecycle", source: "acceptance", savedAt: 1, animals: [] }))).world;
        expect(loaded.mineZone).toEqual(boundaries); expect(loaded.oreAmount).toEqual(after);
        expect(loaded.mineZones[0]).toMatchObject({ id: 1, ore, surveyed: false });
        // Map authoring intentionally resets gameplay surveys; runtime quantity edits do not.
        expect(world.mineZones[0]!.surveyed).toBe(true);
      }
      const before = structuredClone(world.mineZones), quantities = world.oreAmount.slice();
      expect(setOreZoneQuantity(world, 1, 1021, "total")).toBeNull();
      expect(world.mineZones).toEqual(before); expect(world.oreAmount).toEqual(quantities);
    });
});
