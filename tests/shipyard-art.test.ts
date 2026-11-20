import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createBuildingOccupationSymbolSvg } from "../src/render-common/buildings/building-occupation-symbol";

it("keeps the shipbuilding occupation symbol artwork", () => {
  const svg=createBuildingOccupationSymbolSvg(getBuildingDefinition(36));
  expect(svg).toContain("rgb(166,189,207)"); // the contrasting steel hammer head
  expect(svg).toContain("rgb(122,59,22)"); // wooden hull
});
