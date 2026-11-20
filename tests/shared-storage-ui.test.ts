import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { getStorageAria, getStorageCapacityText, getStorageCells } from
  "../src/app/settlement-ui/building-details/storage-helpers";
import { StorageWares } from "../src/app/settlement-ui/building-details/storage-section";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../src/app/settlement-ui/types";
import { STORAGE_IDS } from "../src/shared/settlement/production-rules";
import type { StoragePoolSnapshot } from "../src/shared/settlement/shared-storage";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

const pool: StoragePoolSnapshot = Object.freeze({
  poolId: 0, available: Object.freeze({ logs: 12 }), held: Object.freeze({ logs: 3, cloth: 2 }),
  incoming: Object.freeze({ logs: 4, marble: 5 }), stored: Object.freeze({ logs: 15, cloth: 2 }), capacity: 500
});
const depot = (overrides: Partial<SettlementBuildingSummary> = {}): SettlementBuildingSummary => ({
  id: "0", type: 0, completed: true, storage: pool,
  inventory: { logs: 999, boat: 2, handcart: 1 },
  storageCollect: { visible: true, available: true, wares: [], unavailableWares: [] },
  storedHandcarts: 1, totalHandcarts: 3, ...overrides
});
const noop = () => undefined;
const options: SettlementUiOptions = {
  onMinimap: noop, onRoadMode: noop, onRotate: noop, onSelectBuilding: noop, onSettings: noop,
  onStorageCollect: () => true
};
const cells = (building: SettlementBuildingSummary) => getStorageCells(building, options, "roman", 1, undefined, "collect");

describe("shared storage UI projection", () => {
  it("uses the same available pool at HQ, storehouse and harbour without counting local copies", () => {
    const before = JSON.stringify(pool);
    for (const type of STORAGE_IDS) {
      const logs = cells(depot({ type, id: String(type) })).find(cell => cell.ware === "logs")!;
      expect(logs.count).toBe("12");
      expect(logs.label).toContain("Available 12 · Held 3 (reserved for outgoing loads) · Incoming 4 (on the way) · Stored 15 / 500");
      expect(logs).toMatchObject({ held: 3, incoming: 4 });
      expect(logs.poolTitle).toContain("Available 12 · Held 3 (reserved for outgoing loads) · Incoming 4 (on the way) · Stored 15 / 500");
    }
    expect(JSON.stringify(pool)).toBe(before);
  });

  it("keeps another landmass independent and ignores its pool's local asset fields", () => {
    const other = depot({ storage: { ...pool, poolId: 7, available: { logs: 1, boat: 90, handcart: 90 } } });
    const rows = cells(other);
    expect(rows.find(cell => cell.ware === "logs")?.count).toBe("1");
    for (const [ware, count] of [["boat", "2"], ["handcart", "1"]]) {
      const cell = rows.find(row => row.ware === ware)!;
      expect(cell.count).toBe(count); expect(cell.pool).toBeUndefined();
    }
    expect(rows.find(cell => cell.ware === "handcart")).toMatchObject({
      disabled: true, label: expect.stringContaining("2 in use")
    });
  });

  it("shows held and incoming future materials while keeping their available count zero", () => {
    const rows = cells(depot());
    expect(rows.find(cell => cell.ware === "cloth")).toMatchObject({ count: "0", held: 2 });
    expect(rows.find(cell => cell.ware === "cloth")?.incoming).toBeUndefined();
    expect(rows.find(cell => cell.ware === "marble")).toMatchObject({ count: "0", incoming: 5 });
  });

  it("replaces all labels from a fresh immutable projection after claim/reload", () => {
    const updated = depot({ storage: { ...pool, available: { logs: 8 }, held: { logs: 7 } } });
    const cell = cells(updated).find(row => row.ware === "logs")!;
    expect(cell.count).toBe("8"); expect(cell.label).toContain("Held 7 (reserved for outgoing loads) · Incoming 4 (on the way) · Stored 15");
    expect(cells(depot()).find(row => row.ware === "logs")?.count).toBe("12");
  });

  it("keeps receiving/export policies local and ignores ineligible depot projections", () => {
    const logs = cells(depot({ accepts: { logs: false }, exports: { logs: true } }))
      .find(cell => cell.ware === "logs")!;
    expect(logs).toMatchObject({ collecting: false, disabled: false });
    expect(logs.label).not.toContain("Receiving"); expect(logs.label).not.toContain("Sending");
    for (const override of [{ completed: false }, { hostile: true }]) {
      const cell = cells(depot(override)).find(row => row.ware === "logs")!;
      expect(cell.count).toBe("999"); expect(cell.disabled).toBe(true); expect(cell.pool).toBeUndefined();
    }
  });

  it.each(["en", "hu"] as const)("renders available/held/incoming in the existing accessible %s grid", locale => {
    const building = depot(), i18n = createTestI18n(locale);
    const prepared = getStorageCells(building, options, "roman", 1, i18n);
    const markup = renderWithI18n(createElement(StorageWares, {
      ariaLabel: getStorageAria(building, i18n), buildingId: building.id,
      capacityText: getStorageCapacityText(building, i18n),
      cells: prepared, onWare: () => undefined
    }), locale);
    expect(markup).toContain('data-count="12"');
    expect(markup).not.toContain('data-count="999"');
    expect(markup).toContain('class="settlement-ui__storage-pool settlement-ui__storage-pool--badges"');
    const label = "Available 12 · Held 3 · Incoming 4 · Stored 15 / 500";
    if (locale === "en") { expect(markup).toContain(label); expect(markup).toContain("Shared stock on this landmass");
      expect(markup).toContain('aria-label="Shared resources on this landmass"'); }
    else { expect(markup).toContain("Elérhető: 12 · Lefoglalva: 3 (kimenő rakományhoz) · Beérkező: 4 (úton) · Raktáron: 15 / 500");
      expect(markup).toContain("Közös raktárkészlet ezen a szigeten");
      expect(markup).toContain('aria-label="Közös árukészlet ezen a szigeten"'); }
  });
});
