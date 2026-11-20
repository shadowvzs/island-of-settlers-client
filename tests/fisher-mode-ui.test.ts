import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { getFisherModeView } from "../src/app/settlement-ui/building-details/fisher-mode-helpers";
import { FisherModeSection } from "../src/app/settlement-ui/building-details/fisher-mode-section";
import { getCompletedSections } from "../src/app/settlement-ui/building-details/helpers";
import {
  getShipyardModeChoices, selectModeChoice
} from "../src/app/settlement-ui/building-details/production-mode-helpers";
import { getSettlementIconSource } from "../src/app/settlement-ui/icons";
import { getWareIconSource } from "../src/app/settlement-ui/inventory";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../src/app/settlement-ui/types";
import type { FisherBoatStatus } from "../src/shared/settlement/settlement-fisher-boat-mode";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

const render = (status: FisherBoatStatus, locale: "en" | "hu" = "en") =>
  renderWithI18n(createElement(FisherModeSection, { buildingId: "7", onChange: () => true, status }), locale);

describe("fisher mode toggle", () => {
  it("offers rod and boat with icons, pressed state and help", () => {
    const view = getFisherModeView({ mode: "rod" });
    expect(view.choices.map(choice => [choice.value, choice.pressed, choice.disabled])).toEqual([
      ["rod", true, undefined], ["boat", false, undefined]
    ]);
    expect(view.choices[0]!.iconSource).toBe(getWareIconSource("fishingRod"));
    expect(view.choices[1]!.iconSource).toBe(getWareIconSource("boat"));
    expect(view.description).toContain("one fish per cast");
    expect(view.blockReason).toBeUndefined();
    expect(view.place).toBeUndefined();
  });

  it("disables the boat with its reason as tooltip and note", () => {
    const noShore = getFisherModeView({ block: "noShore", mode: "rod" });
    expect(noShore.choices[1]).toMatchObject({ disabled: true, pressed: false });
    expect(noShore.choices[1]!.description).toContain("River banks cannot be used");
    expect(noShore.blockReason).toBe(noShore.choices[1]!.description);
    const noBoat = getFisherModeView({ block: "noBoat", mode: "rod" });
    expect(noBoat.blockReason).toContain("no spare boat");
    const markup = render({ block: "noBoat", mode: "rod" });
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain(" disabled=");
    expect(markup).toContain('aria-label="Fish with: boat"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('role="note"');
  });

  it("never sends a command for an unavailable choice", () => {
    const view = getFisherModeView({ block: "noShore", mode: "rod" });
    const onChange = vi.fn(() => true);
    expect(selectModeChoice(view.choices, "boat", onChange)).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(selectModeChoice(view.choices, "rod", onChange)).toBe(true);
    expect(onChange).toHaveBeenCalledWith("rod");
  });

  it("shows where the boat is in English and Hungarian", () => {
    expect(getFisherModeView({ mode: "boat", place: "waiting" }).place).toBe("Boat: waiting for a carrier.");
    expect(getFisherModeView({ mode: "boat", place: "yard" }).description).toContain("4 fish per trip");
    const hungarian = getFisherModeView({ mode: "boat", place: "yard" }, createTestI18n("hu"));
    expect(hungarian.place).toBe("Csónak: az udvarban.");
    expect(render({ block: "noShore", mode: "rod" }, "hu")).toContain("Folyópart nem használható");
  });

  it("appears only for a completed Fishery with a status and the command", () => {
    const options = { onFisherMode: () => true } as unknown as SettlementUiOptions;
    const fishery = { fisherBoat: { mode: "rod" }, id: "7", type: 18 } as SettlementBuildingSummary;
    expect(getCompletedSections(fishery, {} as never, options).fisherMode).toBe(true);
    expect(getCompletedSections({ ...fishery, fisherBoat: undefined }, {} as never, options).fisherMode)
      .toBe(false);
    expect(getCompletedSections(fishery, {} as never, {} as SettlementUiOptions).fisherMode).toBe(false);
  });
});

describe("shipyard mode toggle", () => {
  it("keeps its products, labels and icons on the shared choices", () => {
    expect(getShipyardModeChoices("ships").map(choice => ({ ...choice, description: undefined }))).toEqual([
      { ariaLabel: "Produce boats", description: undefined, iconSource: getSettlementIconSource("boat"),
        label: "Boats", pressed: false, value: "boats" },
      { ariaLabel: "Produce ships", description: undefined, iconSource: getSettlementIconSource("ship"),
        label: "Ships", pressed: true, value: "ships" }
    ]);
  });
});
