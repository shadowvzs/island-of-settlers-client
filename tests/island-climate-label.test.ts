import { expect, it } from "vitest";

import { islandClimateLabel, islandClimateTooltip } from "../src/app/settlement-ui/island-climate-label";
import { discoverIslandClimate } from "../src/shared/settlement/island-discovery-policy";

it("explains the saved off-season route and debug override without consulting the current date", () => {
  const discovery = { ...discoverIslandClimate(13, 120, { month: 7, timeZone: "Europe/Bucharest" },
    { theme: "winter" }), voyageSeconds: 150 };
  expect(islandClimateLabel(discovery)).toBe("Winter");
  expect(islandClimateTooltip(discovery)).toContain("+25%");
  expect(islandClimateTooltip(discovery)).toContain("Debug discovery override");
  expect(islandClimateTooltip({ voyageSeconds: 120 })).toBe("");
  const seasonal = discoverIslandClimate(13, 120, { month: 7, timeZone: "UTC" }, { theme: "desert" });
  expect(islandClimateTooltip(seasonal)).not.toContain("+25%");
});
