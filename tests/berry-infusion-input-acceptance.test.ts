import { describe, expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockLayout, stockStyleFor } from "../src/render-common/buildings/building-stock-layout";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { getRomanWareStockInventoryParts } from "../src/render-common/buildings/roman-ware-stock";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = (level: BuildingLevel, rotation: number, count: number, ware: string) => {
  const scene = createTrafficWorld(48), context = scene.context;
  Object.assign(context, { nextBuilding: 0, playerNation: "indigenous", settlers: 0, transfers: [] });
  const home = makeBuilding(context, 0, 8, 8);
  const building = makeBuilding(context, 6, 26.5, 26.5, rotation);
  Object.assign(home, { construction: 1 });
  Object.assign(building, { construction: 1, input: { berries: count, water: count },
    workshopUpgrade: { level: level - 1 } });
  context.buildings.push(home, building);
  for (const plot of context.buildings)
    for (let z = Math.floor(plot.z - plot.depth / 2); z < plot.z + plot.depth / 2; z++)
      for (let x = Math.floor(plot.x - plot.width / 2); x < plot.x + plot.width / 2; x++)
        context.occupied[z * scene.size + x] = 1;
  context.options.stockContact = createIslandStockContacts(scene.world, undefined, () => "indigenous");
  context.options.canWorkerEnterPlot = (plot, point) => isBuildingCourtyardPointWalkable(
    plot.typeId, plot.x, plot.z, plot.rotation, point, plot.output, plot.input, stockStyleFor("indigenous", plot));
  context.options.roads.addRoad(home.access, building.access);
  const actor = addActor(scene, { building: building.uid, home: home.uid, job: "Carrier", phase: "deliver",
    uid: 1, ware, ...building.access });
  actor.delivery = { destination: building.uid, source: home.uid, ware };
  building.incoming[ware] = 1;
  return { actor, building, context };
};

const inputEnvelope = (level: BuildingLevel, input: Record<string, number>, ware: string) => {
  const { recipe, scale } = getBuildingStockLayout(6, { level, nation: "indigenous" });
  const bounds = getRomanWareStockInventoryParts(recipe, scale, input, {})
    .filter(part => part.stock?.kind === "input" && part.stock.ware === ware)
    .map(part => getRomanPartBounds(part));
  expect(bounds.length).toBeGreaterThan(0);
  return { min: [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)) * scale),
    max: [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)) * scale) };
};

describe("Indigenous berry infusion input custody and models", () => {
  it.each([1, 2, 3, 4, 5] as const)("keeps berry and water models separate at tier %i through input refill", level => {
    for (const rotation of [0, 1, 2, 3]) for (let count = 0; count < 6; count++)
      for (const ware of ["berries", "water"]) {
        const { actor, building, context } = fixture(level, rotation, count, ware);
        const label = `${level}/${rotation}/${count}/${ware}`;
        let transferred = false, sawPutdown = false;
        for (let tick = 0; tick < 1600 && !transferred; tick++) {
          beginPersonTrafficTick(context);
          updateCarrier(context, actor, .05);
          if (actor.wareTransfer?.direction === "putdown") {
            sawPutdown = true;
            expect(actor.ware, label).toBe(ware);
            expect(building.input[ware], label).toBe(count);
            expect(building.incoming[ware], label).toBe(1);
            const contact = context.options.stockContact!(building, "input", ware, count)!;
            expect(actor.wareTransfer.target, label).toEqual(contact.stock);
          }
          transferred = actor.ware === null;
        }
        expect(sawPutdown, label).toBe(true);
        expect(transferred, `${label}/${actor.phase}`).toBe(true);
        expect(building.input[ware], label).toBe(count + 1);
        expect(building.incoming[ware], label).toBe(0);
        if (!count) continue;
        const berries = inputEnvelope(level, building.input, "berries");
        const water = inputEnvelope(level, building.input, "water");
        const separated = [0, 1, 2].some(axis => berries.max[axis]! <= water.min[axis]! ||
          water.max[axis]! <= berries.min[axis]!);
        expect(separated, label).toBe(true);
      }
  });
});
