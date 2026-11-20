import { STARTER_STOCK } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { getBuildingDefinition } from "../../../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../../../src/render-common/buildings/building-grid-metrics";
import { constructNaturally, observeProduction } from "./natural-cases";
import {
  observePreludePlanting, pausePreludeProducer, readPrelude, recruitPreludeInfantry, waitForConstructionStock
} from "./natural-prelude-helpers";
import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
export interface NaturalPreludeResult {
  freshStarter: boolean;
  economyComplete: boolean;
  firstRecruit: boolean;
  completedBuildings: number[];
  troopIds: number[];
  blockedBy?: string;
  scope: string;
}
export const CHAIN = [
  { type: 17, ware: "logs" }, { type: 33, ware: "planks" }, { type: 19, ware: "stone" },
  { type: 20, ware: "plant" }, { type: 35, ware: "water" }, { type: 37, ware: "grain" },
  { type: 28, ware: "pig" }, { type: 3, ware: "hides" }, { type: 8, ware: "leather" },
  { type: 15, ware: "armor" }, { type: 23, ware: "beer" }, { type: 40, ware: null }
] as const;

const choosePreludePlot = async (page: Page, type: number) => {
  const rotation = await page.evaluate(() => (window as any).__settlement.controls.rotation());
  const offset = getPlacedBuildingLogistics(type, 0, 0, rotation).road;
  const footprint = getBuildingDefinition(type).gridFootprint;
  return page.evaluate(({ footprint, offset, rotation, type }) => {
    const live = (window as any).__settlement, sim = live.simulation, world = (window as any).__fullE2E.world;
    const home = sim.home(), buildings = sim.buildings();
    const width = footprint[rotation % 2 ? 1 : 0], depth = footprint[rotation % 2 ? 0 : 1];
    const targets: { x: number; z: number }[] = [];
    if ([17, 19].includes(type)) for (let index = 0; index < world.props.count; index++) {
      const kind = world.props.types[index];
      const suitable = type === 17 ? [0, 1, 2, 18].includes(kind) && world.props.scale[index] >= .7 : kind === 5;
      if (suitable) targets.push({ x: world.props.x[index], z: world.props.z[index] });
    }
    for (let radius = 9; radius <= 25; radius += 2) for (let step = 0; step < 48; step++) {
      const angle = step * Math.PI / 24;
      const x = Math.round(home.x + Math.cos(angle) * radius) + width % 2 / 2;
      const z = Math.round(home.z + Math.sin(angle) * radius) + depth % 2 / 2;
      if (sim.validatePlacement(type, x, z, rotation)) continue;
      const screen = live.projectGround(x, z);
      if (screen.x < 130 || screen.x > innerWidth - 130 || screen.y < 160 || screen.y > innerHeight - 160) continue;
      const access = { x: x + offset.x, z: z + offset.z };
      const plan = sim.planRoad(home.access, access, "dirt");
      if (!plan || plan.points.some((point: any) => Math.abs(point.x - x) < width / 2 + .4 &&
        Math.abs(point.z - z) < depth / 2 + .4)) continue;
      const availableTargets = targets.filter(point => Math.hypot(point.x - x, point.z - z) <= 24 &&
        !(Math.abs(point.x - x) < width / 2 + 2 && Math.abs(point.z - z) < depth / 2 + 2)).length;
      if ((type === 17 && availableTargets < 6) || (type === 19 && availableTargets < 1)) continue;
      if ([20, 37].includes(type)) {
        let free = 0;
        for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
          const cx = Math.floor(x) + dx, cz = Math.floor(z) + dz;
          if (cx < 0 || cz < 0 || cx >= world.cellsX || cz >= world.cellsZ) continue;
          const cell = cz * world.cellsX + cx;
          if (!world.walkCost[cell] || world.blocking[cell] !== 0 || world.buildClass[cell] < 2 ||
            world.buildClass[cell] > 4 || (Math.abs(cx + .5 - x) < width / 2 + .5 &&
              Math.abs(cz + .5 - z) < depth / 2 + .5)) continue;
          if (!buildings.some((building: any) => Math.abs(building.x - cx - .5) < building.width / 2 + 1 &&
            Math.abs(building.z - cz - .5) < building.depth / 2 + 1)) free++;
        }
        if (free < 24) continue;
      }
      return { x, z, rotation, preflight: { existingTargets: availableTargets, actualDoor: access } };
    }
    throw new Error(`No legal visible ${type} plot with reachable real door/resource work area; retain this fixture`);
  }, { type, footprint, offset, rotation });
};

/** A finite F0→minimum economy/first recruit prelude; it does not grant an expedition-ready army. */
export const runNaturalPreludeCases = async (page: Page, runCase: RunCase): Promise<NaturalPreludeResult> => {
  const result: NaturalPreludeResult = { freshStarter: false, economyComplete: false, firstRecruit: false,
    completedBuildings: [], troopIds: [], scope: "Ordinary starter stock, twelve real UI buildings, connected finite inputs, " +
      "three delivered cycles per chain ware, actual replanting and first finite infantry recruit. " +
      "Conquest-sized weapon production, mines, harbour/shipyard and launched expedition remain separate obligations." };
  const uids = new Map<number, number>();
  const step = async (id: string, title: string, action: () => Promise<unknown>) => {
    let passed = false;
    await runCase(id, title, async () => {
      if (result.blockedBy) throw new MissingPrerequisite(`Natural prelude stopped at ${result.blockedBy}; no hidden rescue or grant`);
      const evidence = await action(); passed = true; return evidence;
    });
    if (!passed && !result.blockedBy) result.blockedBy = id;
  };
  await step("E2E-04-prelude-fresh-start", "F0 contains only an ordinary HQ, finite starter stock and no army", async () => {
    const state = await readPrelude(page);
    if (state.buildings.length !== 1 || state.buildings[0].typeId !== 0 || state.buildings[0].construction !== 1 ||
      state.soldiers.length || state.actors.length) throw new MissingPrerequisite("F0 requires one completed HQ, no other actors/buildings and no soldiers");
    assert.deepEqual(state.buildings[0].inventory, STARTER_STOCK, "Fresh stock differs from ordinary starter quantities");
    assert.equal(state.settlersInside, 100, "F0 idle population differs from the ordinary starting supply");
    result.freshStarter = true;
    return { seed: state.seed, nation: state.nation, inventory: state.buildings[0].inventory,
      settlers: state.settlersInside, proof: "Current fresh state and ensuing UI provenance; no claim about unobserved earlier account history" };
  });
  for (const { type, ware } of CHAIN) {
    await step(`E2E-04-prelude-build-${type}`, `Natural ${getBuildingDefinition(type).name} with finite supplied construction`, async () => {
      const supply = await waitForConstructionStock(page, type);
      const construction = await constructNaturally(page, type, choosePreludePlot);
      uids.set(type, construction.uid); result.completedBuildings.push(type);
      return { supply, construction };
    });
    if (ware) await step(`E2E-06-prelude-produce-${ware}`, `Actual ${ware} production/replanting in the starter chain`, async () => {
      const uid = uids.get(type);
      if (uid === undefined) throw new MissingPrerequisite(`Natural producer ${type} is absent`);
      return ware === "plant" ? observePreludePlanting(page, uid) : observeProduction(page, uid, ware, 600);
    });
  }
  result.economyComplete = !result.blockedBy && CHAIN.every(({ type }) => uids.has(type));
  await step("E2E-08-prelude-recruit-shield", "First infantry uses real produced armour/beer and finite starter equipment", async () => {
    const armour = uids.get(15), brewery = uids.get(23), tavern = uids.get(40);
    if (armour === undefined || brewery === undefined || tavern === undefined)
      throw new MissingPrerequisite("Natural armour/beer/Tavern chain did not complete");
    const pauses = [await pausePreludeProducer(page, armour), await pausePreludeProducer(page, brewery)];
    const recruit = await recruitPreludeInfantry(page, tavern);
    result.firstRecruit = true; result.troopIds.push(recruit.actor);
    return { pauses, recruit, proof: "Finite starter sword/shield plus actually produced armour/beer; no free army" };
  });
  await runCase("E2E-16-prelude-summary", "Natural prelude result and explicit expedition-readiness boundary", async () => {
    if (!result.freshStarter || !result.economyComplete || !result.firstRecruit)
      throw new MissingPrerequisite(`Minimum F0 chain incomplete: ${result.blockedBy}`);
    return result;
  });
  return result;
};
