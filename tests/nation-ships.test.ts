import { Box3, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { layoutShipDeck, SHIP_DECK, SHIP_DECK_PERSON_WORLD } from "../src/render-common/ships/ship-deck-layout";
import {
  SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SCALE
} from "../src/render-common/ships/ship-dimensions";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { shipFigureheadKind } from "../src/renderers/three/settlement/ship-figureheads";
import { shipStyleFor } from "../src/renderers/three/settlement/ship-styles";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import { SHIPYARD_RECIPES } from "../src/shared/settlement/shipyard-recipes";
import { meshTriangleCount, visibleMeshBounds, visibleTriangles } from "./helpers/visible-mesh-bounds";

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"];
const QUALITIES = ["high", "minimal"] as const;
const ship: ShipFrame = { cargoCount: 0, id: 1, phase: "idle", x: 0, y: 0, yaw: 0, z: 0 };
/** Every nation's player ship and the raiders' galley (enemy livery). */
const HULLS = [...NATIONS.map(nation => ({ livery: undefined, nation, style: nation as string })),
  { livery: "enemy" as const, nation: "roman" as WorkerNation, style: "raider" }];
const CASES = HULLS.flatMap(hull => QUALITIES.map(quality => ({ ...hull, quality })));

const shipFor = (nation: WorkerNation, quality: (typeof QUALITIES)[number], frame: ShipFrame = ship) => {
  const layer = createThreeSettlementShips(quality);
  layer.update([frame], [], 0, { playerNation: nation });
  return layer;
};

describe("nation ships on the shared merchant footprint", () => {
  it.each(CASES)("keeps the $style ship ($quality) inside the shared navigation envelope", ({ livery, nation,
    quality }) => {
    const layer = shipFor(nation, quality, { ...ship, livery });
    const bounds = visibleMeshBounds(layer.group), size = bounds.getSize(new Vector3());
    expect(size.x).toBeLessThanOrEqual(SAILING_SHIP_OVERALL_BEAM);
    expect(size.z).toBeLessThanOrEqual(SAILING_SHIP_OVERALL_LENGTH);
    // The bow and stern stay where the merchant ship's do (the footprint is the same for all).
    expect(bounds.max.z / SAILING_SHIP_SCALE).toBeLessThan(1.35);
    expect(bounds.min.z / SAILING_SHIP_SCALE).toBeGreaterThan(-1.25);
    layer.dispose();
  });

  it.each(CASES)("keeps every shared deck slot free on the $style ship ($quality)", ({ livery, nation, quality }) => {
    const layer = shipFor(nation, quality, { ...ship, livery });
    const root = layer.group.getObjectByName("ship-1")!;
    root.scale.setScalar(1); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0);
    // Deck-level triangles (planking, hatch gratings) carry the bodies and crates.
    const triangles = visibleTriangles(root).filter(triangle =>
      Math.max(triangle.a.y, triangle.b.y, triangle.c.y) > SHIP_DECK.floorY + .018);
    const layouts = [layoutShipDeck({ depth: .5, height: 1.3, width: .54 }), layoutShipDeck({ depth: .5, height: 1.3,
      width: .54 }, 0, Infinity), layoutShipDeck({ depth: .56, height: 1.45, width: .62 }, 4, Infinity),
    // Riders' horses (owner 2026-10-15): the most an empty deck takes, with people and crates round them.
    layoutShipDeck(SHIP_DECK_PERSON_WORLD, 8, Infinity, undefined, Infinity)];
    const hits: string[] = [];
    for (const slot of layouts.flatMap(layout => layout.slots)) {
      const b = slot.bounds, box = new Box3(new Vector3(b.minX + .002, b.minY + .005, b.minZ + .002),
        new Vector3(b.maxX - .002, b.maxY - .002, b.maxZ - .002));
      if (triangles.some(triangle => box.intersectsTriangle(triangle))) hits.push(`${slot.kind} ${slot.x},${slot.z}`);
    }
    expect(hits).toEqual([]);
    layer.dispose();
  });

  it.each(CASES)("keeps the $style ship ($quality) inside its triangle budget", ({ livery, nation, quality }) => {
    const layer = shipFor(nation, quality, { ...ship, livery });
    const premiumLegacy = nation === "roman" || nation === "viking";
    const budget = premiumLegacy ? { high: 21000, minimal: 4000 } : { high: 19000, minimal: 3500 };
    expect(meshTriangleCount(layer.group)).toBeLessThan(budget[quality]);
    layer.dispose();
  });
});

describe("ship styles", () => {
  it("builds the player's ships in the nation's style; raiders sail their galley, neutral ships the merchant", () => {
    expect(NATIONS.map(nation => shipStyleFor(undefined, nation))).toEqual(NATIONS);
    expect(NATIONS.map(nation => shipStyleFor("enemy", nation))).toEqual(NATIONS.map(() => "raider"));
    expect(shipStyleFor("neutral", "viking")).toBe("roman");
  });

  it("keeps the raider galley's figurehead and hull rules in step", () => {
    for (const nation of NATIONS) {
      expect(shipStyleFor("enemy", nation)).toBe("raider");
      expect(shipFigureheadKind("enemy", nation)).toBe("serpent");
      expect(shipFigureheadKind("neutral", nation)).toBe("stem");
    }
  });

  it("rebuilds a craft when the player's nation changes and shares batches between crafts of a style", () => {
    const layer = createThreeSettlementShips("high");
    const hullOf = (id: number) => layer.group.getObjectByName(`ship-${id}`)!.getObjectByName("ship_hull")!;
    const batchIds = (id: number) => {
      const ids: string[] = [];
      hullOf(id).traverseVisible(child => { if (child instanceof Mesh) ids.push(child.geometry.uuid); });
      return ids;
    };
    layer.update([ship, { ...ship, id: 2, x: 20 }], [], 0, { playerNation: "japanese" });
    expect(batchIds(1)).toEqual(batchIds(2));
    const japanese = batchIds(1);
    layer.update([ship, { ...ship, id: 2, livery: "enemy", x: 20 }], [], 0, { playerNation: "nubian" });
    expect(batchIds(1)).not.toEqual(japanese);
    layer.update([ship, { ...ship, id: 2, livery: "neutral", x: 20 }], [], 1, { playerNation: "roman" });
    expect(batchIds(1)).toEqual(batchIds(2));
    layer.dispose();
  });
});

it.each(["chinese", "persian", "maya", "indigenous"] as const)(
  "%s uses shared whole-hull material batches after construction without changing plank consumption", nation => {
    const layer = shipFor(nation, "high");
    const root = layer.group.getObjectByName("ship-1")!;
    const complete = root.getObjectByName("ship_finished_hull")!;
    const construction = root.getObjectByName("ship_hull")!;
    expect(complete.visible).toBe(true);
    expect(complete.children.length).toBeLessThanOrEqual(10);
    expect(construction.visible).toBe(false);
    layer.update([], [{ id: 1, x: 0, y: 0, z: 0, yaw: 0, progress: .5 }], 0,
      { playerNation: nation });
    const site = layer.group.getObjectByName("site-1")!;
    expect(site.getObjectByName("ship_finished_hull")!.visible).toBe(false);
    const partial = site.getObjectByName("ship_hull")!;
    expect(partial.visible).toBe(true);
    expect(partial.children.filter(child => child.visible).length).toBe(Math.round(SHIPYARD_RECIPES.ships.planks * .5));
    layer.dispose();
  }
);
