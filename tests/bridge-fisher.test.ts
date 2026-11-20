import { describe, expect, it } from "vitest";

import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { BRIDGE_DECK_HALF_WIDTH, bridgeDecks, deckCoordinates } from "../src/shared/settlement/bridge-deck";
import { bridgeLatticeNodes, bridgeLatticeSpan } from "../src/shared/settlement/bridge-lattice";
import { isInBridgeFootprint } from "../src/shared/settlement/bridge-masonry";
import type { BridgeKind, RoadPoint, RoadSegment } from "../src/shared/settlement/road-types";
import { createActor } from "../src/shared/settlement/settlement-paths";
import { claimBuilding, makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import { BLOCKING, BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 32;
/** A river from row 22 to row 25 with a gentle beach on the near bank and a dry far bank. */
const RIVER_ROWS = [22, 25] as const;

const bridgeSegments = (kind: BridgeKind, start: RoadPoint, end: RoadPoint): RoadSegment[] => {
  const span = bridgeLatticeSpan(start, end)!;
  const nodes = bridgeLatticeNodes(start, span);
  return nodes.slice(1).map((to, tile) => ({
    bridge: { id: 1, kind, tile, tiles: span.tiles, width: 2.6 },
    end: to, start: nodes[tile]!, tier: kind === "wood" ? "dirt" : "stone"
  }));
};

/** The fishing fixture of `settlement-fishing.test.ts` with a river and a completed bridge over it. */
const riverFisher = (segments: RoadSegment[]) => {
  const stride = SIZE + 1;
  const world = { cellsX: SIZE, cellsZ: SIZE, seaLevel: 0, seed: 1,
    heights: Float32Array.from({ length: stride * stride }, (_, index) => {
      const z = Math.floor(index / stride);
      if (z > RIVER_ROWS[1] + 1) return .3;
      return [.3, .28, -.02, -.4][Math.max(0, Math.min(3, z - 21))]!;
    }),
    walkCost: new Uint8Array(SIZE ** 2).fill(10), blocking: new Uint8Array(SIZE ** 2),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large), props: { count: 0 }, mineZones: [],
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2),
    waterSurface: new Float32Array(stride * stride),
    waterDepth: new Float32Array(stride * stride).fill(.3) } as unknown as WorldData;
  for (let z = RIVER_ROWS[0]; z <= RIVER_ROWS[1]; z++) for (let x = 0; x < SIZE; x++) {
    world.blocking[z * SIZE + x] = BLOCKING.water; world.walkCost[z * SIZE + x] = 0;
  }
  const context = { options: { world,
    roads: { route: () => null, addRoad: () => true, upgradeRoad: () => true, revision: 1, segments: () => segments },
    resourceTargets: () => undefined,
    canWorkerEnterPlot: (building, point) => isBuildingCourtyardPointWalkable(building.typeId,
      building.x, building.z, building.rotation, point),
    stockContact: (building, kind, ware, slot) => {
      const contact = getBuildingStockContact(building.typeId, kind, ware, slot,
        building.x, building.z, building.rotation)!;
      return { slot, ware, stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
        approach: { x: contact.approach[0], y: contact.approach[1], z: contact.approach[2] } };
    } }, buildings: [], actors: [], occupied: new Uint8Array(SIZE ** 2), reservations: new Set(),
    nextActor: 0, nextBuilding: 0, settlers: 1, resourceAmounts: new Map(), transfers: [],
    accumulator: 0, scheduling: 0 } as SettlementContext;
  const building = makeBuilding(context, 18, 16, 15, 0);
  building.construction = 1; claimBuilding(context, building);
  const actor = createActor(context, "Fisher", building.uid);
  building.worker = actor.uid;
  return { actor, building, context };
};

/**
 * Bridge masonry: parapets, abutment wings and piers beside the clear deck lane. The lane itself (the
 * deck and its mouth over the abutment tops, where the road runs) is walkable.
 */
const inMasonry = (segments: RoadSegment[], point: RoadPoint) => bridgeDecks(segments).some(deck => {
  const { across, along } = deckCoordinates(deck, point);
  // Abutments reach 0.36 behind each anchor; parapets and abutment faces end at 1.6 across.
  const inStructure = along >= -0.36 && along <= deck.length + 0.36 && Math.abs(across) <= 1.6;
  const onDeck = Math.abs(across) <= BRIDGE_DECK_HALF_WIDTH;
  return inStructure && !onDeck;
});

const CROSSINGS = [
  ["straight", { x: 16.5, z: 21 }, { x: 16.5, z: 27 }],
  ["angled", { x: 15, z: 21 }, { x: 18, z: 27 }]
] as const;

describe("a Fisher beside a river bridge", () => {
  for (const kind of ["stone", "wood"] as const)
    for (const [label, start, end] of CROSSINGS)
      it(`fishes off the ${label} ${kind} bridge, walks there and back and never enters its masonry`, () => {
        const segments = bridgeSegments(kind, start, end);
        const { actor, building, context } = riverFisher(segments);
        let stances = 0;
        for (let tick = 0; tick < 12000 && (building.output.fish ?? 0) < 4; tick++) {
          actor.animationTime += .05;
          updateWorker(context, actor, .05);
          if (!actor.visible) continue;
          expect(inMasonry(segments, actor), `${actor.phase} at ${actor.x}/${actor.z}`).toBe(false);
          if (!["fishCast", "fishWait", "fishReel"].includes(actor.phase)) continue;
          stances += 1;
          expect(isInBridgeFootprint(context, actor)).toBe(false);
          expect(isInBridgeFootprint(context, actor.target!.approach!)).toBe(false);
        }
        expect(stances).toBeGreaterThan(0);
        // Four catches carried home: the Fisher never got stuck going out or coming back.
        expect(building.output.fish).toBe(4);
        expect(actor.ware).toBeNull();
      });
});
