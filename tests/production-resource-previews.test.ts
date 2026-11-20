import { describe, expect, it } from "vitest";

import { getProductionResourceInput } from "../src/app/settlement-ui/building-details/production-resource-input";
import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";

describe("native production source previews", () => {
  it("resolves an exported image for every natural-source building and nation", () => {
    const specialists = MATERIAL_BUILDING_GROUPS.flatMap(({ forester, quarry, woodcutter }) =>
      [forester, quarry, woodcutter]);
    for (const type of [17, 18, 19, 20, 22, 35, 37, ...specialists]) {
      const input = getProductionResourceInput(type);
      expect(input, `building ${type}`).not.toBeNull();
      expect(input?.source).toMatch(/\.(png|webp)/);
    }
    for (const nation of ["roman", "viking", "nubian", "japanese"] as const)
      expect(getProductionResourceInput(5, nation)?.source, nation).toMatch(/\.(png|webp)/);
  });
});
