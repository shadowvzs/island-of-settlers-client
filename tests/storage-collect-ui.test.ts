import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createSettlementCommandActions, guardCommandActions } from
  "../src/app/settlement/settlement-ui-actions";
import { getFooterActions } from "../src/app/settlement-ui/building-details/helpers";
import { applyStorageCollect, getStorageCells, getStorageCollectTool } from
  "../src/app/settlement-ui/building-details/storage-helpers";
import { StorageCollect, StorageWares } from "../src/app/settlement-ui/building-details/storage-section";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../src/app/settlement-ui/types";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const depot = (overrides: Partial<SettlementBuildingSummary> = {}): SettlementBuildingSummary => ({
  completed: true, id: "0", type: 29, inventory: { boat: 2, horse: 1 },
  storage: { poolId: 0, available: { logs: 8, stone: 2 }, held: {}, incoming: {}, stored: { logs: 8, stone: 2 }, capacity: 500 },
  storageCollect: { visible: true, available: true, wares: ["logs"], unavailableWares: [] }, ...overrides
});
const options = (onStorageCollect = vi.fn(() => true)): SettlementUiOptions => ({
  onMinimap: noop, onRoadMode: noop, onRotate: noop, onSelectBuilding: noop, onSettings: noop, onStorageCollect
});

describe("destination storage Collect control", () => {
  it("requires activation before toggling, then forwards several independent canonical ware requests", () => {
    const callback = vi.fn(() => true), commands = options(callback), building = depot();
    expect(getStorageCollectTool(building, commands, null)?.pressed).toBe(false);
    expect(getStorageCells(building, commands).find(cell => cell.ware === "stone")?.disabled).toBe(true);
    expect(applyStorageCollect(building, commands, null, "stone")).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    applyStorageCollect(building, commands, "collect", "stone");
    applyStorageCollect(building, commands, "collect", "logs");
    expect(callback.mock.calls).toEqual([[0, "stone", true], [0, "logs", false]]);
    expect(building.storageCollect!.wares).toEqual(["logs"]);
  });

  it("mirrors a destination pool's selected ware at multiple doors without a second local selection list", () => {
    const commands = options();
    for (const [id, type] of [[0, 0], [1, 29], [2, 39]]) {
      const building = depot({ id: String(id), type });
      const cell = getStorageCells(building, commands, "roman", 1).find(row => row.ware === "logs")!;
      expect(cell.collecting).toBe(true); expect(cell.label).toContain("Selected for collection");
      expect(cell.disabled).toBe(true);
    }
  });

  it("disables a ware already collected by another pool and refuses its stale click", () => {
    const callback = vi.fn(() => true), commands = options(callback);
    const building = depot({ storageCollect: { visible: true, available: true, wares: [], unavailableWares: ["stone"] } });
    const row = getStorageCells(building, commands, "roman", 1, undefined, "collect")
      .find(cell => cell.ware === "stone")!;
    expect(row.disabled).toBe(true); expect(row.title).toBe("Already collected by another harbour");
    expect(row.label).toContain(row.title);
    const hungarian = getStorageCells(building, commands, "roman", 1, createTestI18n("hu"), "collect")
      .find(cell => cell.ware === "stone")!;
    expect(hungarian.title).toBe("Ezt az árut már egy másik kikötő gyűjti.");
    expect(applyStorageCollect(building, commands, "collect", "stone")).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not hide cancellation of this pool's existing selection behind another-pool exclusion", () => {
    const callback = vi.fn(() => true), commands = options(callback);
    const building = depot({ storageCollect: { visible: true, available: true, wares: ["logs"], unavailableWares: ["logs"] } });
    expect(applyStorageCollect(building, commands, "collect", "logs")).toBe(true);
    expect(callback).toHaveBeenCalledWith(0, "logs", false);
  });

  it("uses the canonical distinct-friendly-pool visibility result rather than a local harbour count", () => {
    const building = depot({ storageCollect: { visible: false, available: false, wares: [], unavailableWares: [] } });
    expect(getStorageCollectTool(building, options(), null)).toBeUndefined();
    expect(getFooterActions(building, options(), "resources")?.storageTools).toBe(false);
    expect(renderWithI18n(createElement(StorageCollect, { building, options: options(), tool: null, onTool: noop })))
      .toBe("");
  });

  it("shows a disabled Collect tool with the translated no-destination-harbour explanation", () => {
    const building = depot({ storageCollect: { visible: true, available: false, wares: [], unavailableWares: [],
      reason: "Build a harbour on this island to collect wares" } });
    const view = getStorageCollectTool(building, options(), null, createTestI18n("hu"))!;
    expect(view.disabled).toBe(true); expect(view.title).toBe("Az áruk begyűjtéséhez építs kikötőt ezen a szigeten.");
    expect(applyStorageCollect(building, options(), "collect", "stone")).toBe(false);
  });

  it("never selects local boats, horses, hand carts, unknown wares or hostile/unfinished depots", () => {
    const callback = vi.fn(() => true), commands = options(callback);
    for (const ware of ["boat", "horse", "handcart", "invented"]) {
      expect(applyStorageCollect(depot(), commands, "collect", ware)).toBe(false);
    }
    for (const change of [{ hostile: true }, { completed: false }]) {
      expect(getStorageCollectTool(depot(change), commands, "collect")).toBeUndefined();
      expect(applyStorageCollect(depot(change), commands, "collect", "stone")).toBe(false);
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(["en", "hu"] as const)("renders one compact Collect action and selected ware states in %s", locale => {
    const commands = options(), building = depot(), i18n = createTestI18n(locale);
    const action = renderWithI18n(createElement(StorageCollect, { building, options: commands,
      tool: "collect", onTool: noop }), locale);
    expect(action).toContain('data-storage-tool="collect"');
    expect(action).toContain("settlement-ui__icon-button--compact");
    expect(action).toContain('aria-pressed="true"');
    expect(action).not.toContain('data-storage-tool="receive"'); expect(action).not.toContain('data-storage-tool="send"');
    const rows = getStorageCells(building, commands, "roman", 1, i18n, "collect");
    const grid = renderWithI18n(createElement(StorageWares, {
      buildingId: building.id, capacityText: null, cells: rows, onWare: noop
    }), locale);
    expect(grid).toContain('data-collecting="true"'); expect(grid).not.toContain("ware-policy-marks");
    expect(grid).not.toContain("data-receiving="); expect(grid).not.toContain("data-sending=");
    if (locale === "en") expect(action).toContain('aria-label="Collect"');
    else { expect(action).toContain('aria-label="Begyűjtés"'); expect(grid).toContain("Begyűjtésre kiválasztva"); }
  });

  it("routes the new callback through the active-session command guard and refreshes a refusal", () => {
    const setStorageCollect = vi.fn(() => false), updateUi = vi.fn();
    const actions = createSettlementCommandActions({ simulation: { setStorageCollect } as unknown as SettlementSimulation,
      message: noop, onBuildingDemolished: noop, updateUi });
    let running = false;
    const guarded = guardCommandActions(actions, () => running);
    expect(guarded.onStorageCollect!(0, "stone", true)).toBe(false); expect(setStorageCollect).not.toHaveBeenCalled();
    running = true; expect(guarded.onStorageCollect!(0, "stone", true)).toBe(false);
    expect(setStorageCollect).toHaveBeenCalledWith(0, "stone", true); expect(updateUi).toHaveBeenCalledOnce();
  });
});
