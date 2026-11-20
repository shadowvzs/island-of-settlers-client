import { describe, expect, it } from "vitest";

import {
  adventureCampDecorations, CAMP_ASSEMBLY_RADIUS, campDecorationClearsAssemblies
} from "../src/render-common/adventure/adventure-camp";
import { createAdventureCampDecoration } from "../src/renderers/three/settlement/adventure-camp-model";
import { createThreeAdventureCamps } from "../src/renderers/three/settlement/three-adventure-camps";
import { acceptedAdventureCampLayout } from "../src/shared/settlement/adventure-camp-layout";
import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { validateAdventureSave } from "../src/shared/settlement/settlement-colony-validation";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const world = () => ({ cellsX: 40, cellsZ: 40, seaLevel: -1, terrainRevision: 0,
  heights: new Float32Array(41 ** 2), walkCost: new Uint8Array(40 ** 2).fill(10),
  blocking: new Uint8Array(40 ** 2), fog: new Uint8Array(40 ** 2).fill(FOG.visible), props: { count: 0 }
} as unknown as WorldData);

describe("presentation-only adventure field camps", () => {
  it("places one tent per camp and prevents decoration overlap between neighbouring groups", () => {
    const camps = [{ id: 0, x: 15, z: 17 }, { id: 1, x: 24, z: 17 },
      { id: 2, x: 19.5, z: 25 }];
    const layout = acceptedAdventureCampLayout(world(), camps);
    const pieces = camps.flatMap(camp => {
      const decorations = layout.camps.get(camp.id)!;
      expect(decorations.filter(piece => piece.kind === "tent")).toHaveLength(1);
      return decorations.map(piece => ({ ...piece, x: camp.x + piece.x, z: camp.z + piece.z }));
    });
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const first = pieces[i]!, second = pieces[j]!;
      expect(Math.hypot(first.x - second.x, first.z - second.z))
        .toBeGreaterThan(first.radius + second.radius + .25);
    }
    expect(adventureCampDecorations().filter(piece => piece.kind === "tent")).toHaveLength(1);
  });
  it("keeps decorative tents and barricades clear of actual adventure defence plots", () => {
    const ground = world(), camp = { id: 0, x: 20, z: 20 };
    const original = acceptedAdventureCampLayout(ground, [camp]);
    const first = original.camps.get(0)![0]!;
    const plot = { x: camp.x + first.x, z: camp.z + first.z, width: 2, depth: 2 };
    const next = acceptedAdventureCampLayout(ground, [{ ...camp, defencePlots: [plot] }]);
    expect(next).not.toBe(original);
    for (const piece of next.camps.get(0)!) {
      expect(Math.abs(camp.x + piece.x - plot.x) >= plot.width / 2 + piece.radius + .3 ||
        Math.abs(camp.z + piece.z - plot.z) >= plot.depth / 2 + piece.radius + .3).toBe(true);
    }
  });
  it("keeps decoration footprints outside the entire enemy spawn ring and other camp assemblies", () => {
    const camp = { id: 0, x: 20, z: 20 };
    for (const decoration of adventureCampDecorations()) {
      expect(Math.hypot(decoration.x, decoration.z) - decoration.radius).toBeGreaterThan(CAMP_ASSEMBLY_RADIUS);
      expect(campDecorationClearsAssemblies(camp, decoration, [camp])).toBe(true);
    }
    const tent = adventureCampDecorations()[0]!;
    expect(campDecorationClearsAssemblies(camp, tent, [camp, { id: 1, x: 14, z: 16 }])).toBe(false);
  });
  it.each([false, true])("authors finite original models within the camp triangle budget (detailed=%s)", detailed => {
    let triangles = 0;
    for (const decoration of adventureCampDecorations()) {
      const geometry = createAdventureCampDecoration(decoration.kind, detailed, "bandit", decoration.variant);
      const position = geometry.getAttribute("position");
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      expect(geometry.getAttribute("color").count).toBe(position.count);
      const fabric = geometry.getAttribute("campFabric");
      expect(fabric.count).toBe(position.count);
      expect(Array.from(fabric.array).every(value => value === 0 || value === 1)).toBe(true);
      triangles += geometry.index!.count / 3;
      geometry.dispose();
    }
    expect(triangles).toBeLessThan(detailed ? 12000 : 4000);
  });
  it("keeps cloth texture off structural poles and crates without another draw", () => {
    const tent = createAdventureCampDecoration("tent", true, "swamp", "command");
    const values = new Set(Array.from(tent.getAttribute("campFabric").array));
    expect(values).toEqual(new Set([0, 1]));
    tent.dispose();
  });
  it("uses the smaller geometry tier when High camps are viewed from far away", () => {
    const camps = createThreeAdventureCamps(world(), true), frame = { id: 0, x: 20, z: 20 };
    camps.update([frame], 1);
    const close = (camps.root.children[0] as any).geometry.index.count;
    camps.update([frame], .2);
    expect((camps.root.children[0] as any).geometry.index.count).toBeLessThan(close);
    camps.dispose();
  });
  it("retains legacy saves and rejects malformed, excessive and out-of-world camp metadata", () => {
    const save = { enemies: 10, island: adventureOffers(123)[0]!, status: "contested" as const, version: 1 as const };
    expect(validateAdventureSave(save, world())).toBeNull();
    expect(validateAdventureSave({ ...save, campSites: [{ x: 20, z: 20 }] }, world())).toBeNull();
    for (const sites of [[{ x: NaN, z: 2 }], [{ x: 40, z: 2 }], [{ x: -1, z: 2 }],
      Array.from({ length: 7 }, () => ({ x: 2, z: 2 }))])
      expect(validateAdventureSave({ ...save, campSites: sites }, world())).toBe("Invalid adventure camp sites");
  });
  it("batches one draw, respects whole-camp fog, preserves world state and refits only on terrain revision", () => {
    const data = world(), heights = data.heights.slice(), blocking = data.blocking.slice();
    const camps = createThreeAdventureCamps(data, false);
    const frame = { fogEnabled: true, id: 0, x: 20, z: 20 };
    camps.update([frame]);
    expect(camps.root.children).toHaveLength(1);
    const mesh = camps.root.children[0] as any, original = mesh.geometry;
    camps.update([frame]);
    expect((camps.root.children[0] as any).geometry).toBe(original);
    data.fog[20 * 40 + 20] = FOG.hidden;
    camps.update([frame]); expect(mesh.visible).toBe(false);
    camps.update([{ ...frame, fogEnabled: false }]); expect(mesh.visible).toBe(true);
    expect(data.heights).toEqual(heights); expect(data.blocking).toEqual(blocking);
    data.heights.fill(.2); data.terrainRevision = (data.terrainRevision ?? 0) + 1;
    camps.update([frame]);
    expect((camps.root.children[0] as any).geometry).not.toBe(original);
    camps.dispose(); expect(camps.root.children).toHaveLength(0);
  });
});
