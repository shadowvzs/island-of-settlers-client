import { describe, expect, it } from "vitest";

import { demolishSettlementBuilding } from "../src/shared/settlement/settlement-demolition";
import {
  isDemolitionProtected, isFoundingAnchor, isHomeBuilding
} from "../src/shared/settlement/settlement-home";
import {
  hasPlayerBuildingOnLandmass, isFirstSettlementOnLandmass, sameLandmass
} from "../src/shared/settlement/settlement-landmass";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { validateSavedBuildings } from "../src/shared/settlement/settlement-save-buildings";
import type {
  SettlementBuilding, SettlementContext, SettlementPoint
} from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const size = 24;
const world = {
  seed: 1, cellsX: size, cellsZ: size, seaLevel: 0,
  heights: new Float32Array((size + 1) ** 2),
  blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
  buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
    scale: new Float32Array() }
} as unknown as WorldData;
for (let z = 0; z <= size; z++)
  for (let x = 0; x <= size; x++)
    world.heights[z * (size + 1) + x] = x > 8 && x < 15 ? -2 : 1;
const point = (x: number, z: number): SettlementPoint => ({ x, z });
const context = (buildings: SettlementBuilding[] = []) => ({
  options: { world, roads: { route: () => ({ points: [], cost: 1, length: 1 }) } },
  buildings, nextBuilding: 1
}) as unknown as SettlementContext;
const harbour = (x: number, z: number) => {
  const context = { options: { world }, buildings: [], nextBuilding: 1 } as unknown as SettlementContext;
  const building = makeBuilding(context, 39, x, z, 0);
  building.construction = 1; building.required = {}; building.foundedByExpedition = true;
  return building;
};

describe("permanent founding-harbour protection", () => {
  it("uses dry landmass identity, not roads or water straits", () => {
    expect(sameLandmass(world, point(4, 4), point(7, 7))).toBe(true);
    expect(sameLandmass(world, point(4, 4), point(18, 4))).toBe(false);
    expect(hasPlayerBuildingOnLandmass(context([harbour(4, 4)]), point(18, 4))).toBe(false);
    expect(hasPlayerBuildingOnLandmass(context([harbour(4, 4)]), point(6, 6))).toBe(true);
  });
  it("does not count another player's or a neutral building as the player's settlement", () => {
    const enemy = harbour(18, 4); enemy.militaryFaction = 1;
    expect(isFirstSettlementOnLandmass(context([enemy]), harbour(18, 4))).toBe(true);
  });
  it("gives the first harbour on an empty landmass an anchor, but not an HQ island harbour", () => {
    const candidate = harbour(20, 4);
    expect(isFirstSettlementOnLandmass(context(), candidate)).toBe(true);
    const headquarters = makeBuilding(context(), 0, 16, 4, 0);
    headquarters.uid = 2;
    headquarters.construction = 1;
    expect(isFirstSettlementOnLandmass(context([headquarters]), candidate)).toBe(false);
    expect(isFoundingAnchor({ ...candidate, foundingAnchor: true })).toBe(true);
    expect(isFoundingAnchor(candidate)).toBe(false);
  });
  it("refuses demolition permanently, even beside another harbour, while ordinary harbours stay demolishable", () => {
    const anchor = harbour(4, 4); anchor.foundingAnchor = true;
    const second = harbour(18, 4); second.foundingAnchor = true;
    const ordinary = harbour(18, 18);
    expect(isDemolitionProtected(anchor)).toBe(true);
    expect(isDemolitionProtected(ordinary)).toBe(false);
    expect(isHomeBuilding({ typeId: 0 })).toBe(true);
    const live = context([anchor, second, ordinary]);
    expect(demolishSettlementBuilding(live, anchor.uid)).toMatchObject({
      ok: false, reason: "This founding harbour is essential to the settlement and cannot be demolished"
    });
    expect(live.buildings).toContain(anchor);
  });
  it("validates and preserves the anchor identity in saves", () => {
    const anchor = harbour(4, 4); anchor.foundingAnchor = true;
    expect(validateSavedBuildings([anchor], world, new Set(), 0)).toBeNull();
    const reloaded = JSON.parse(JSON.stringify(anchor)) as SettlementBuilding;
    expect(reloaded.foundedByExpedition).toBe(true);
    expect(reloaded.foundingAnchor).toBe(true);
    expect(demolishSettlementBuilding(context([reloaded]), reloaded.uid).ok).toBe(false);
    const unfinished = harbour(4, 4); unfinished.construction = 0; unfinished.foundingAnchor = true;
    expect(validateSavedBuildings([unfinished], world, new Set(), 0)).toBe("Invalid founding harbour protection");
    const ordinaryFirst = harbour(4, 4); ordinaryFirst.foundingAnchor = true;
    ordinaryFirst.foundedByExpedition = undefined;
    expect(validateSavedBuildings([ordinaryFirst], world, new Set(), 0)).toBeNull();
  });
});
