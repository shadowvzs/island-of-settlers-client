import { SPYGLASS_EYECUP } from "@workers/worker-spyglass";
import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { SPYGLASS_EYE_LENS_Y, SPYGLASS_TOOL_SCALE } from "../src/render-common/wares/spyglass-parts";
import { getJobAction, getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

it("uses the real spyglass scan during Scout work and keeps walking separate", () => {
  const action = getJobAction("Scout", "work");
  expect(action).toBe("spyglass_scan");
  expect(getJobAction("Scout", "walk")).toBe("walk");
  expect(getJobAction("Hunter", "work")).toBe("idle_breathe");
  expect(getWorkerHeldProp({ action, workerJob: "Scout" })).toEqual({
    id: "spyglass", source: "tool"
  });
});

it("keeps the exported eye contract aligned with the actual carried geometry", () => {
  expect(SPYGLASS_EYECUP).toBeCloseTo(SPYGLASS_EYE_LENS_Y * SPYGLASS_TOOL_SCALE, 8);
  const material = new MeshStandardMaterial();
  const materials = { gold: material, paint: material, steel: material } as
    Record<BuildingSurface, MeshStandardMaterial>;
  const held = createWareModel("spyglass", false, materials, "tool");
  const stock = createWareModel("spyglass", false, materials, "stock");
  expect(held.root.getObjectByName("ware_geometry")!.scale.x).toBe(SPYGLASS_TOOL_SCALE);
  expect(stock.root.getObjectByName("ware_geometry")!.scale.x).toBe(1);
  held.dispose(); stock.dispose(); material.dispose();
});
