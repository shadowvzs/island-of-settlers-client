import { STARTER_STOCK } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { makeBuilding, startHeadquarters } from "../src/shared/settlement/settlement-placement";
import { assignSurveyJob, updateSurveyWorker } from "../src/shared/settlement/settlement-surveying";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { recruitWorkers, updateWorker } from "../src/shared/settlement/settlement-workers";
import { BUILD, ORE, type WorldData } from "../src/shared/world/world-data";
const fixture = () => {
  const size = 24,
    world = {
      seed: 9, seaLevel: -1, fog: new Uint8Array(size ** 2),
      cellsX: size,
      cellsZ: size,
      start: { x: 5.5, z: 5.5 },
      heights: new Float32Array((size + 1) ** 2),
      blocking: new Uint8Array(size ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10),
      buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      mineZone: new Uint16Array(size ** 2),
      oreAmount: new Uint8Array(size ** 2),
      mineZones: [],
      props: {
        count: 0,
        types: new Uint8Array(),
        x: new Float32Array(),
        z: new Float32Array(),
        scale: new Float32Array()
      }
    } as unknown as WorldData;
  const roads = createRoadNetwork(world);
  const context: SettlementContext = {
    options: { world, roads },
    buildings: [],
    actors: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set(),
    nextActor: 0,
    nextBuilding: 0,
    settlers: 20,
    resourceAmounts: new Map(),
    accumulator: 0,
    scheduling: 0,
    transfers: []
  };
  const hq = startHeadquarters(context)!;
  hq.inventory = { ...STARTER_STOCK };
  hq.idleSettlers = context.settlers;
  const endpoint = { x: 14, z: 12 };
  roads.addRoad(hq.access, endpoint);
  const cell = 12 * size + 15;
  world.mineZone[cell] = 1;
  world.oreAmount[cell] = 7;
  world.mineZones.push({
    id: 1,
    ore: ORE.iron,
    cellCount: 1,
    centreX: 15.5,
    centreZ: 12.5,
    richness: 1,
    surveyed: false
  });
  const advance = () => {
    for (let step = 0; step < 6000; step++)
      for (const actor of context.actors) {
        if (!updateSurveyWorker(context, actor, 0.05)) updateWorker(context, actor, 0.05);
        actor.animationTime += 0.05;
        expect(context.settlers + context.actors.filter((a) => a.phase !== "retired").length).toBe(
          20
        );
      }
  };
  return { world, context, hq, endpoint, advance, cell };
};
it("geologist travels from connected storage, surveys actual ore without mining it, and returns settler+hammer", () => {
  const { advance, cell, context, endpoint, hq, world } = fixture();
  const revision = world.buildRevision ?? 0;
  const assigned = assignSurveyJob(context, "Geologist", endpoint);
  expect(assigned.ok).toBe(true);
  expect(context.settlers).toBe(19);
  expect(hq.inventory.hammer).toBe(5);
  advance();
  expect(world.mineZones[0]!.surveyed).toBe(true);
  expect(world.oreAmount[cell]).toBe(7);
  expect(world.buildRevision).toBe(revision + 1);
  expect(context.settlers).toBe(20);
  expect(hq.inventory.hammer).toBe(6);
  expect(context.actors[0]!.phase).toBe("retired");
  expect(context.actors[0]!.tool).toBeUndefined();
});
it("scout performs a bounded reachable tour, then returns spyglass and population", () => {
  const { advance, context, endpoint, hq } = fixture();
  const assigned = assignSurveyJob(context, "Scout", endpoint);
  expect(assigned.ok).toBe(true);
  expect(context.actors[0]!.tool).toBe("spyglass");
  expect(hq.inventory.spyglass).toBe(2);
  advance();
  expect(context.settlers).toBe(20);
  expect(hq.inventory.spyglass).toBe(3);
  expect(context.actors[0]!.phase).toBe("retired");
});
it("disconnected targets, absent tools and exhausted population consume nothing", () => {
  const { context, endpoint, hq } = fixture();
  expect(assignSurveyJob(context, "Scout", { x: 30, z: 30 }).ok).toBe(false);
  hq.inventory.hammer = 0;
  expect(assignSurveyJob(context, "Geologist", endpoint).ok).toBe(false);
  context.settlers = 0;
  expect(assignSurveyJob(context, "Scout", endpoint).ok).toBe(false);
  expect(context.actors).toHaveLength(0);
  expect(hq.inventory.spyglass).toBe(3);
});
it("already surveyed deposits do not recruit phantom workers or consume a tool", () => {
  const { context, endpoint, hq, world } = fixture();
  world.mineZones[0]!.surveyed = true;
  expect(assignSurveyJob(context, "Geologist", endpoint).ok).toBe(false);
  expect(context.settlers).toBe(20);
  expect(hq.inventory.hammer).toBe(6);
});

it("surveys a reachable cell when the closest cell of the same deposit is blocked", () => {
  const { advance, context, endpoint, world } = fixture();
  world.walkCost[12 * world.cellsX + 15] = 0;
  const farther = 12 * world.cellsX + 16;
  world.mineZone[farther] = 1;
  world.oreAmount[farther] = 5;
  expect(assignSurveyJob(context, "Geologist", endpoint).ok).toBe(true);
  advance();
  expect(world.mineZones[0]!.surveyed).toBe(true);
  expect(world.oreAmount[farther]).toBe(5);
});
it("dispatches a geologist across open ground without roads and returns the settler and hammer", () => {
  const { advance, context, endpoint, hq, world } = fixture();
  context.options.roads = createRoadNetwork(world);
  expect(assignSurveyJob(context, "Geologist", endpoint).ok).toBe(true);
  expect(hq.inventory.hammer).toBe(5);
  advance();
  expect(world.mineZones[0]!.surveyed).toBe(true);
  expect(context.settlers).toBe(20);
  expect(hq.inventory.hammer).toBe(6);
  expect(context.actors[0]!.phase).toBe("retired");
});


it("does not recruit scouts with hunting bows when a spyglass is unavailable", () => {
  const { context, endpoint, hq } = fixture();
  hq.inventory.spyglass = 0;
  hq.inventory.bow = 3;
  const settlers = context.settlers;
  expect(assignSurveyJob(context, "Scout", endpoint)).toEqual({ ok: false, reason: "No spyglass available in storage" });
  expect(context.actors).toHaveLength(0);
  expect(context.settlers).toBe(settlers);
  expect(hq.inventory.bow).toBe(3);
});

it("a lookout recruits a spyglass-equipped Scout while leaving hunting bows untouched", () => {
  const { context, hq } = fixture();
  const lookout = makeBuilding(context, 14, 14, 12, 0);
  lookout.construction = 1;
  lookout.required = {};
  context.buildings.push(lookout);
  expect(context.options.roads.addRoad(hq.access, lookout.access)).toBe(true);
  hq.inventory.spyglass = 0;
  hq.inventory.bow = 3;
  recruitWorkers(context);
  expect(lookout.worker).toBeUndefined();
  expect(lookout.status).toBe("Waiting for spyglass");
  hq.inventory.spyglass = 1;
  recruitWorkers(context);
  expect(context.actors.find(actor => actor.uid === lookout.worker)).toMatchObject({ job: "Scout", tool: "spyglass" });
  expect(hq.inventory.spyglass).toBe(0);
  expect(hq.inventory.bow).toBe(3);
});


it("returns the Scout and its one spyglass to friendly storage if the headquarters is gone", () => {
  const { advance, context, endpoint, hq } = fixture();
  const assigned = assignSurveyJob(context, "Scout", endpoint);
  expect(assigned.ok).toBe(true);
  if (!assigned.ok) throw new Error("Scout assignment failed");
  for (let tick = 0; tick < 2000 && assigned.actor.phase === "assigned"; tick++) {
    updateSurveyWorker(context, assigned.actor, .05);
    assigned.actor.animationTime += .05;
  }
  expect(assigned.actor.phase).not.toBe("assigned");
  const storage = makeBuilding(context, 29, 18, 16, 0);
  storage.construction = 1; storage.required = {}; storage.inventory = {}; storage.idleSettlers = 0;
  context.buildings.push(storage);
  context.buildings.splice(context.buildings.indexOf(hq), 1);
  context.occupied.fill(0);
  advance();
  expect(assigned.ok && assigned.actor.phase).toBe("retired");
  expect(assigned.ok && assigned.actor.home).toBe(storage.uid);
  expect(storage.inventory.spyglass).toBe(1);
  advance();
  expect(storage.inventory.spyglass).toBe(1);
});


it("visits an unsurveyed barren field before revealing its absence of ore without extracting anything", () => {
  const { advance, cell, context, endpoint, hq, world } = fixture();
  world.oreAmount[cell] = 0;
  world.mineZones[0]!.ore = ORE.none;
  world.mineZones[0]!.richness = 0;
  expect(assignSurveyJob(context, "Geologist", endpoint).ok).toBe(true);
  expect(world.mineZones[0]!.surveyed).toBe(false);
  expect(hq.inventory.hammer).toBe(5);
  advance();
  expect(world.mineZones[0]!.surveyed).toBe(true);
  expect(world.oreAmount[cell]).toBe(0);
  expect(hq.inventory.hammer).toBe(6);
  expect(context.settlers).toBe(20);
});

it("abandons an editor-removed mine zone while walking and physically returns its hammer and settler", () => {
  const { advance, cell, context, endpoint, hq, world } = fixture();
  expect(assignSurveyJob(context, "Geologist", endpoint).ok).toBe(true);
  const actor = context.actors[0]!;
  for (let tick = 0; tick < 1000 && actor.phase !== "surveyWalk"; tick++) updateSurveyWorker(context, actor, .05);
  expect(actor.phase).toBe("surveyWalk");
  world.mineZone[cell] = 0; world.mineZones = []; world.oreAmount[cell] = 0;
  world.walkCost[cell] = 0; world.buildRevision = (world.buildRevision ?? 0) + 1;
  advance();
  expect(actor.phase).toBe("retired");
  expect(actor.tool).toBeUndefined();
  expect(hq.inventory.hammer).toBe(6);
  expect(context.settlers).toBe(20);
  expect(world.mineZones).toEqual([]);
  expect(world.oreAmount[cell]).toBe(0);
});
