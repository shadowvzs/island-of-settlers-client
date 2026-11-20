import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuildingIcon } from "../src/app/components/building-icon";
import { getCommandStatus } from "../src/app/components/helpers";
import { Inventory } from "../src/app/components/inventory";
import { WareIcon } from "../src/app/components/ware-icon";
import { getNationBuildingIconSource, getSettlementBuildingIconSource } from "../src/app/settlement-ui/building-icons";
import {
  getInventoryCells, getInventoryEmptyText, getWareIconSource, hasRenderedWareIcon
} from "../src/app/settlement-ui/inventory";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { renderWithI18n } from "./helpers/render-with-i18n";

describe("ware icon", () => {
  it("renders the ware's rendered 3D icon as one image titled with its name", () => {
    expect(renderToStaticMarkup(createElement(WareIcon, { ware: "logs" }))).toContain(
      `<img alt="" aria-hidden="true" decoding="sync" draggable="false" src="${getWareIconSource("logs")}" title="Softwood logs"/>`);
    expect(renderToStaticMarkup(createElement(WareIcon, { title: "12 Fish", ware: "fish" })))
      .toContain('title="12 Fish"');
  });

  it("gives every catalogue ware its own rendered icon (no drawn fallback exists)", () => {
    expect(WARE_IDS.filter(ware => !hasRenderedWareIcon(ware))).toEqual([]);
  });

  it("shows the generic warehouse render for an unknown ware id", () => {
    expect(getWareIconSource("unknownWare")).toContain("warehouse");
    expect(renderToStaticMarkup(createElement(WareIcon, { ware: "unknownWare" }))).toMatch(/<img [^>]*title="/);
  });
});

describe("inventory grid", () => {
  it("prepares ordered cells and the empty texts shared with the DOM grid", () => {
    expect(getInventoryCells({ stone: 2, logs: 5 })).toEqual([
      { count: "5", label: "Softwood logs: 5", name: "Softwood logs", ware: "logs" },
      { count: "2", label: "Stone: 2", name: "Stone", ware: "stone" }
    ]);
    expect(getInventoryEmptyText({})).toBe("No wares stored here.");
    expect(getInventoryEmptyText()).toBe("Stock information is not available.");
  });

  it("renders data-ware / data-count cells inside the inventory section", () => {
    const markup = renderWithI18n(createElement(Inventory, { heading: "Stock", inventory: { logs: 5 } }));
    expect(markup).toContain('<section aria-label="Stock" class="settlement-ui__inventory"><h3>Stock</h3>');
    expect(markup).toContain('<div aria-label="Softwood logs: 5" data-count="5" data-ware="logs"><img');
    expect(markup).toContain("<small>Softwood logs</small><b>5</b>");
    expect(markup).not.toContain("settlement-ui__section-description");
  });

  it("explains an empty or unreported stock", () => {
    expect(renderWithI18n(createElement(Inventory, { heading: "Stock", inventory: {} })))
      .toContain('<p class="settlement-ui__section-description">No wares stored here.</p>');
    expect(renderWithI18n(createElement(Inventory, { heading: "Stock" })))
      .toContain("Stock information is not available.");
  });
});

describe("building icon", () => {
  it("renders the thumbnail with data-building-icon like the DOM helper", () => {
    const source = getSettlementBuildingIconSource(17)!;
    expect(renderToStaticMarkup(createElement(BuildingIcon, { type: 17 }))).toContain(
      `<img alt="" data-building-icon="17" decoding="sync" draggable="false" loading="lazy" src="${source}"/>`);
  });

  it("falls back to the build icon when a type has no thumbnail", () => {
    expect(renderToStaticMarkup(createElement(BuildingIcon, { type: 9999 }))).toContain('data-icon="build"');
  });

  it("uses each actual national mine model while keeping ore icons available as separate ware art", () => {
    for (const nation of ["roman", "viking", "nubian", "japanese"] as const)
      for (const type of [10, 11, 12, 13])
        expect(getNationBuildingIconSource(type, nation)).toContain(`${nation}-${type}.png`);
  });
});

describe("command status", () => {
  it("shows the success text for true and the refusal reason otherwise", () => {
    expect(getCommandStatus(true, "Delivered.")).toBe("Delivered.");
    expect(getCommandStatus("Needs 3 more gems", "Delivered.")).toBe("Needs 3 more gems");
  });
});
