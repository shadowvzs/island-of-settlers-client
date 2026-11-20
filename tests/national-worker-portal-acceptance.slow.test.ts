import { MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { WORKER_HEIGHT, WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { updateDoorActivity } from "../src/shared/settlement/settlement-door-activity";
import { entrancePath, exitPath } from "../src/shared/settlement/settlement-entrance";
import { moveActor, setActorPath } from "../src/shared/settlement/settlement-paths";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

const NATIONS = ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"] as const;
const LEVELS: BuildingLevel[] = [1, 2, 3, 4, 5];
const portalsFor = (nation: string) => nation === "indigenous" ? [0, 14, 18, 32, 36, 61] : [0, 14, 18, 36];

describe("current national worker portals", () => {
  it.each(NATIONS)("moves the actual actor through %s HQ, scout, fishery and shipyard passages", nation => {
    for (const typeId of portalsFor(nation)) for (const level of LEVELS) for (const rotation of [0, 1, 2, 3]) {
      const scene = createTrafficWorld(48), context: SettlementContext = scene.context;
      context.nextBuilding = 0;
      context.playerNation = nation;
      const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
      const building = makeBuilding(context, typeId, 24 + (rotation % 2 ? depth : width) % 2 / 2,
        24 + (rotation % 2 ? width : depth) % 2 / 2, rotation);
      Object.assign(building, { construction: 1, workshopUpgrade: { level: level - 1 } });
      context.buildings.push(building);
      for (let z = Math.floor(building.z - building.depth / 2); z < building.z + building.depth / 2; z++)
        for (let x = Math.floor(building.x - building.width / 2); x < building.x + building.width / 2; x++)
          context.occupied[z * scene.size + x] = 1;
      const actor = addActor(scene, { building: building.uid, home: building.uid, job: "Carrier",
        phase: "enterDelivery", uid: 1, ...building.access });
      const label = `${nation}/${typeId}/${level}/${rotation}`;
      for (const [phase, path] of [["enterDelivery", entrancePath(building)], ["exitDelivery", exitPath(building)]] as const) {
        setActorPath(actor, path, phase);
        let arrived = false;
        for (let tick = 0; tick < 400 && !arrived; tick++) {
          const previous = { x: actor.x, z: actor.z };
          arrived = moveActor(context, actor, .05);
          updateDoorActivity(context, .05);
          expect(Math.hypot(actor.x - previous.x, actor.z - previous.z), label).toBeLessThan(.061);
        }
        expect(arrived, `${label}/${phase}`).toBe(true);
        expect(Math.hypot(actor.x - path.at(-1)!.x, actor.z - path.at(-1)!.z), label).toBeLessThan(.03);
      }
    }
  });

  it.each(NATIONS)("keeps the actual %s open mesh passage clear in High and Minimal", nation => {
    stubPaintCanvas();
    const materials = createPlainBuildingMaterials();
    try {
      for (const typeId of portalsFor(nation)) for (const level of LEVELS) for (const detailed of [true, false]) {
        const definition = getBuildingDefinition(typeId);
        const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
        if (!recipe.doorDimensions) continue;
        const { scale } = getRomanBuildingWorldSizing(definition);
        const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
        model.root.scale.setScalar(scale);
        model.update(0, { construction: 1, door: 1, working: false });
        model.root.updateMatrixWorld(true);
        const middle = (recipe.door[0] + recipe.doorDimensions.width / 2) * scale;
        const z = recipe.door[2] * scale;
        try {
          for (const lateral of [-WORKER_RADIUS, 0, WORKER_RADIUS])
            for (const height of [.08, WORKER_HEIGHT / 2, WORKER_HEIGHT + .0125]) {
              const ray = new Raycaster(new Vector3(middle + lateral, height, z + .15), new Vector3(0, 0, -1), 0, .3);
              const hits = ray.intersectObject(model.root, true);
              expect(hits, `${nation}/${typeId}/${level}/${detailed}/${lateral}/${height}`).toHaveLength(0);
            }
        } finally { model.dispose(); }
      }
    } finally { Object.values(materials).forEach((material: MeshStandardMaterial) => material.dispose()); }
  });
});
