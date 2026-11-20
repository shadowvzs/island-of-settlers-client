import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isOwnStockCourtyard } from "../src/shared/settlement/settlement-entrance";
import { foundationTiles } from "../src/shared/settlement/settlement-foundation-worker";
import { isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { groundPath, moveActor, setActorPath } from "../src/shared/settlement/settlement-paths";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = (rotation = 3) => {
  const scene = createTrafficWorld(32), { context } = scene;
  context.nextBuilding = 0; context.playerNation = "chinese";
  const [width, depth] = getBuildingDefinition(16).gridFootprint;
  const site = makeBuilding(context, 16, 16 + width % 2 / 2, 16 + depth % 2 / 2, rotation);
  site.construction = 0; site.foundationProgress = 0;
  site.required = { planks: 4, stone: 4 };
  context.buildings.push(site);
  for (let z = site.z - site.depth / 2; z < site.z + site.depth / 2; z++)
    for (let x = site.x - site.width / 2; x < site.x + site.width / 2; x++) context.occupied[z * 32 + x] = 1;
  const actor = addActor(scene, { uid: 1096, job: "Leveler", phase: "levelWaiting",
    x: site.access.x, z: site.access.z, building: site.uid });
  actor.stockBuilding = site.uid;
  return { context, site, actor };
};

it.each([0, 1, 2, 3])("physically enters its empty foundation through the clearance band at rotation %i", rotation => {
  const { actor, context, site } = fixture(rotation);
  const tile = foundationTiles(site)[0]!, target = { x: tile.x + .5, z: tile.z + .5 };
  const path = groundPath(context, actor, target, site.uid);
  expect(path).not.toBeNull();
  setActorPath(actor, path!, "levelApproach");
  let arrived = false;
  for (let tick = 0; tick < 200 && !arrived; tick++) {
    const previous = { x: actor.x, z: actor.z };
    beginPersonTrafficTick(context);
    arrived = moveActor(context, actor, .05);
    expect(Math.hypot(actor.x - previous.x, actor.z - previous.z)).toBeLessThanOrEqual(.0450001);
  }
  expect(arrived).toBe(true);
  expect(Math.hypot(actor.x - target.x, actor.z - target.z)).toBeLessThan(.01);
  expect(site.foundationProgress).toBe(0);
  expect(site.construction).toBe(0);
  expect(site.required).toEqual({ planks: 4, stone: 4 });
});

it("does not grant the construction apron to another worker, another site or a completed wall", () => {
  const { actor, context, site } = fixture();
  const apron = { x: site.x - site.width / 2 - .125, z: site.z };
  expect(isNavigationClear(context, apron)).toBe(false);
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(true);
  expect(isOwnStockCourtyard(context, actor, { x: site.x - site.width / 2, z: site.z })).toBe(true);
  actor.building = site.uid + 1;
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(false);
  actor.building = site.uid; actor.job = "Carrier";
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(false);
  actor.job = "Leveler"; site.construction = .5;
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(false);
  site.construction = 1;
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(false);
});

it("retains every adjacent foundation and finished building as a physical obstacle", () => {
  const { actor, context, site } = fixture();
  const apron = { x: site.x - site.width / 2 - .125, z: site.z };
  const other = makeBuilding(context, 17, apron.x, apron.z, 0);
  context.buildings.push(other); context.navigationRevision = 1;
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(false);
  other.construction = 1; context.navigationRevision = 2;
  expect(isOwnStockCourtyard(context, actor, apron)).toBe(false);
});

it("retains impassable terrain inside the assigned construction site", () => {
  const { actor, context, site } = fixture();
  const tile = foundationTiles(site)[0]!, target = { x: tile.x + .5, z: tile.z + .5 };
  context.options.world.walkCost[tile.z * 32 + tile.x] = 0;
  expect(groundPath(context, actor, target, site.uid)).toBeNull();
  expect(site.construction).toBe(0);
  expect(site.foundationProgress).toBe(0);
});
