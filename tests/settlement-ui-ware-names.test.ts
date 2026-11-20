import { describe, expect, it } from "vitest";

import { describeWares, formatWareCount } from "../src/app/settlement-ui/helpers";
import { wareDisplayName, wareNameForCount } from "../src/shared/settlement/ware-names";

describe("ware names for counts", () => {
  it("keeps the inventory display names", () => {
    expect(wareDisplayName("ironOre")).toBe("Iron ore");
    expect(wareDisplayName("sword")).toBe("Sword");
    expect(wareDisplayName("coins")).toBe("Gold coins");
  });

  it("pluralises countable wares and keeps the singular for one", () => {
    expect(formatWareCount(10, "sword")).toBe("10 Swords");
    expect(formatWareCount(5, "horse")).toBe("5 Horses");
    expect(formatWareCount(1, "horse")).toBe("1 Horse");
    expect(formatWareCount(3, "fishingRod")).toBe("3 Fishing rods");
    expect(formatWareCount(2, "axe")).toBe("2 Axes");
  });

  it("counts armor in sets", () => {
    expect(formatWareCount(10, "armor")).toBe("10 Armor sets");
    expect(wareNameForCount("armor", 1)).toBe("Armor set");
  });

  it("leaves mass nouns and plural names unchanged", () => {
    for (const ware of ["beer", "flour", "stone", "coal", "fish", "logs", "planks"])
      expect(wareNameForCount(ware, 25)).toBe(wareDisplayName(ware));
    expect(formatWareCount(500, "coins")).toBe("500 Gold coins");
    expect(formatWareCount(1000, "logs")).toBe("1,000 Softwood logs");
  });

  it("describes a goods list", () => {
    expect(describeWares({ horse: 2, stone: 10 })).toBe("2 Horses, 10 Stone");
  });
});
