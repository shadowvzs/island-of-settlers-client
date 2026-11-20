import { expect, it } from "vitest";

import { getJobAction } from "../src/render-common/workers/worker-job-actions";

it("uses the new plantation clips only during the matching harvest work", () => {
  expect(getJobAction("Beekeeper", "work", null, "harvest")).toBe("lift_honeycomb");
  expect(getJobAction("Winegrower", "work", null, "harvest")).toBe("pick_grapes");
  expect(getJobAction("Winegrower", "walk", null, "harvest")).toBe("walk");
  expect(getJobAction("Winegrower", "plant", null, "sow")).toBe("plant_seedling");
  expect(getJobAction("Winegrower", "work", null, "sow")).toBe("dig");
  expect(getJobAction("Farmer", "work", null, "harvest")).toBe("harvest_wheat");
  expect(getJobAction("Farmer", "work", null, "sow")).toBe("idle_breathe");
  expect(getJobAction("Rice farmer", "work", null, "harvest")).toBe("harvest_wheat");
  expect(getJobAction("Rice farmer", "work", null, "sow")).toBe("idle_breathe");
  expect(getJobAction("Palm grower", "work", null, "harvest", "shake")).toBe("push_trunk");
});
