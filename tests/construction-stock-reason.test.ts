import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { createPlacementCheck } from "../src/app/settlement/placement-check";
import { announcePlacementRefusal } from "../src/app/settlement/placement-refusal";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { displayWareName, translateDomainText } from "../src/shared/i18n/domain";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { NO_ISLAND_STORAGE_REASON } from "../src/shared/settlement/constants";
import { notEnoughOnIslandReason } from "../src/shared/settlement/construction-stock-reason";
import { constructionCost } from "../src/shared/settlement/settlement-placement";
import { wareDisplayName } from "../src/shared/settlement/ware-names";
import { createAngledBridgeSettlement } from "./helpers/bridge-settlement";

type Fixture = ReturnType<typeof createAngledBridgeSettlement>;
interface Plot { x: number; z: number }

/** Planks a (Roman) Woodcutter site needs: read from the catalog, so a balance change keeps the tests honest. */
const WOODCUTTER_PLANKS = constructionCost(BuildingType.Woodcutter, "roman").planks!;
const STOREHOUSE_STONE = constructionCost(BuildingType.Storehouse, "roman").stone!;

const draftPath = fileURLToPath(new URL("../../docs/localization-drafts/i18n-domain-sim.json", import.meta.url));
const draft = JSON.parse(readFileSync(draftPath, "utf8")) as { id: string; hu: string }[];
const hungarian = setupI18n({ locale: "hu", messages: {
  hu: Object.fromEntries(draft.map(entry => [entry.id, entry.hu]))
} });

/** The first plot in the column range whose plot rules (territory, ground, roads) accept the building. */
const findPlot = ({ simulation }: Fixture, typeId: number, fromX: number, toX: number): Plot => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  for (let x = fromX; x < toX; x += 1) for (let z = 4; z < 28; z += 1) {
    const plot = { x: x + (width % 2) / 2, z: z + (depth % 2) / 2 };
    if (simulation.validatePlacement(typeId, plot.x, plot.z, 0) === null) return plot;
  }
  throw new Error(`No free plot for building ${typeId}`);
};
const westPlot = (fixture: Fixture, typeId: number) => findPlot(fixture, typeId, 1, 9);
const eastPlot = (fixture: Fixture, typeId: number) => findPlot(fixture, typeId, 21, 29);

/** Preview and command must give the same verdict for the same plot (preview first: it is read-only). */
const previewThenPlace = ({ simulation }: Fixture, typeId: number, plot: Plot) => {
  const preview = simulation.placementStockReason(typeId, plot.x, plot.z, 0);
  const placed = simulation.placeBuilding(typeId, plot.x, plot.z, 0);
  return { placed, preview };
};

describe("construction stock reasons (NEW-ISLAND-FEEDBACK)", () => {
  it("names the missing ware and amount, and the command refuses with the same text", () => {
    const fixture = createAngledBridgeSettlement({ stock: { hammer: 2, logs: 24, planks: 0, stone: 24 } });
    const plot = westPlot(fixture, BuildingType.Woodcutter);
    const { placed, preview } = previewThenPlace(fixture, BuildingType.Woodcutter, plot);
    expect(preview).toBe(notEnoughOnIslandReason("planks", WOODCUTTER_PLANKS));
    expect(preview).toBe(`Not enough ${wareDisplayName("planks")} on this island (missing ${WOODCUTTER_PLANKS})`);
    expect(placed).toMatchObject({ ok: false, reason: preview });
  });

  it("checks every required ware, not only planks", () => {
    const fixture = createAngledBridgeSettlement({ stock: { hammer: 2, logs: 24, planks: 24, stone: 1 } });
    const plot = westPlot(fixture, BuildingType.Storehouse);
    const { placed, preview } = previewThenPlace(fixture, BuildingType.Storehouse, plot);
    expect(preview).toBe(notEnoughOnIslandReason("stone", STOREHOUSE_STONE - 1));
    expect(placed).toMatchObject({ ok: false, reason: preview });
  });

  it("asks for a storage on a landmass without one, in preview and command alike", () => {
    const fixture = createAngledBridgeSettlement({ stock: { hammer: 2, logs: 24, planks: 24, stone: 24 } });
    const plot = eastPlot(fixture, BuildingType.Woodcutter);
    const { placed, preview } = previewThenPlace(fixture, BuildingType.Woodcutter, plot);
    expect(preview).toBe(NO_ISLAND_STORAGE_REASON);
    expect(placed).toMatchObject({ ok: false, reason: NO_ISLAND_STORAGE_REASON });
  });

  it("keeps the connected home island unchanged and follows the stock a placement just promised", () => {
    const planks = WOODCUTTER_PLANKS + 1;
    const fixture = createAngledBridgeSettlement({ stock: { hammer: 2, logs: 24, planks, stone: 24 } });
    const first = westPlot(fixture, BuildingType.Woodcutter);
    const { placed, preview } = previewThenPlace(fixture, BuildingType.Woodcutter, first);
    expect(preview).toBeNull();
    expect(placed.ok).toBe(true);
    // Same tick: the cached preview must see the planks the first site now holds.
    const second = westPlot(fixture, BuildingType.Woodcutter);
    const next = previewThenPlace(fixture, BuildingType.Woodcutter, second);
    expect(next.preview).toBe(notEnoughOnIslandReason("planks", WOODCUTTER_PLANKS - 1));
    expect(next.placed).toMatchObject({ ok: false, reason: next.preview });
  });

  it("still accepts a free dirt road on a new landmass with no planks", () => {
    const stock = { hammer: 2, logs: 0, planks: 0, stone: 0 };
    const fixture = createAngledBridgeSettlement({ eastRoad: false, stock });
    expect(fixture.simulation.connectRoads({ x: 22, z: 12 }, { x: 26, z: 12 })).toBe(true);
  });

  it("shows the reason on the preview ghost before the click", () => {
    const fixture = createAngledBridgeSettlement({ stock: { hammer: 2, logs: 24, planks: 0, stone: 24 } });
    const plot = westPlot(fixture, BuildingType.Woodcutter);
    const check = createPlacementCheck(fixture.simulation, fixture.world, () => 0);
    const verdict = check(BuildingType.Woodcutter, plot, 0);
    expect(verdict.reason).toBe(notEnoughOnIslandReason("planks", WOODCUTTER_PLANKS));
    expect(verdict.ghost.valid).toBe(false);
    expect(verdict.ghost.road).toBeNull();
    const east = check(BuildingType.Woodcutter, eastPlot(fixture, BuildingType.Woodcutter), 0);
    expect(east.reason).toBe(NO_ISLAND_STORAGE_REASON);
  });
});

describe("construction stock reason text", () => {
  it("translates both reasons through named placeholders", () => {
    expect(translateDomainText(NO_ISLAND_STORAGE_REASON)).toBe(NO_ISLAND_STORAGE_REASON);
    const english = notEnoughOnIslandReason("planks", 4);
    expect(translateDomainText(english)).toBe(english);
    expect(translateDomainText(NO_ISLAND_STORAGE_REASON, hungarian)).not.toBe(NO_ISLAND_STORAGE_REASON);
    const localized = translateDomainText(notEnoughOnIslandReason("planks", 4), hungarian);
    expect(localized).toContain(displayWareName("planks", hungarian));
    expect(localized).toContain("4");
    expect(localized).not.toContain(wareDisplayName("planks"));
  });

  it("announces a refused placement as an on-screen warning", () => {
    const shown: { important?: boolean; text: string }[] = [];
    announcePlacementRefusal(NO_ISLAND_STORAGE_REASON, undefined, {
      warning: (text, options) => { shown.push({ important: options?.important, text }); return 1; }
    });
    expect(shown).toEqual([{ important: true, text: NO_ISLAND_STORAGE_REASON }]);
  });
});
