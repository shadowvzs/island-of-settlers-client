import { expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { stockStyleFor } from "../src/render-common/buildings/building-stock-layout";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

it.each([1, 5] as const)("works the restored Indigenous loom enclosure at tier%i in every rotation", level => {
  for (const rotation of [0, 1, 2, 3]) {
    const scene = createTrafficWorld(48), context = scene.context;
    Object.assign(context, { nextBuilding: 0, playerNation: "indigenous", settlers: 0, transfers: [] });
    const home = makeBuilding(context, 0, 8, 8);
    const [width, depth] = getBuildingDefinition(61).gridFootprint;
    const building = makeBuilding(context, 61, 26 + (rotation % 2 ? depth : width) % 2 / 2,
      26 + (rotation % 2 ? width : depth) % 2 / 2, rotation);
    Object.assign(home, { construction: 1 });
    Object.assign(building, { construction: 1, input: { flax: 6 }, workshopUpgrade: { level: level - 1 } });
    context.buildings.push(home, building);
    for (const plot of context.buildings)
      for (let z = Math.floor(plot.z - plot.depth / 2); z < plot.z + plot.depth / 2; z++)
        for (let x = Math.floor(plot.x - plot.width / 2); x < plot.x + plot.width / 2; x++)
          context.occupied[z * scene.size + x] = 1;
    context.options.stockContact = createIslandStockContacts(scene.world, undefined, () => "indigenous");
    context.options.canWorkerEnterPlot = (plot, point) => isBuildingCourtyardPointWalkable(
      plot.typeId, plot.x, plot.z, plot.rotation, point, plot.output, plot.input, stockStyleFor("indigenous", plot));
    context.options.roads.addRoad(home.access, building.access);
    const actor = addActor(scene, { building: building.uid, home: home.uid, job: "Weaver", phase: "inside",
      uid: 1, visible: false, ...building.doorThreshold });
    const phases = new Set<string>();
    for (let tick = 0; tick < 5000 && !building.output.cloth; tick++) {
      beginPersonTrafficTick(context);
      updateWorker(context, actor, .05);
      phases.add(actor.phase);
    }
    expect(building.output.cloth, `${level}/${rotation}/${actor.phase}/${[...phases].join(",")}`).toBe(1);
    expect(building.input.flax).toBe(4);
    expect(phases.has("inputPickup")).toBe(true);
    expect(phases.has("work")).toBe(true);
    expect(phases.has("outputPutdown")).toBe(true);
  }
});
