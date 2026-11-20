import { existsSync } from "node:fs";
import { catalogEntries, entriesOfKind, soldierEntries, wareEntries } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { getWareIconSource, hasRenderedWareIcon } from "../src/app/settlement-ui/inventory";
import { catalogAssetFile, catalogAssetFiles } from "../tools/assets/catalog-asset-files";

describe("content catalog assets", () => {
  it("resolves every icon reference to an existing file for every declared variant", () => {
    const missing = catalogEntries().filter(entry => entry.icon).flatMap(entry => catalogAssetFiles(entry, entry.icon!))
      .filter(file => !existsSync(file));
    expect(missing).toEqual([]);
  });

  it("resolves every authored model (GLB) reference to an existing file", () => {
    const models = catalogEntries().flatMap(entry =>
      entry.model?.kind === "glb" ? catalogAssetFiles(entry, entry.model.asset) : []);
    expect(models.length).toBeGreaterThan(0);
    expect(models.filter(file => !existsSync(file))).toEqual([]);
  });

  it("resolves every payload portrait (soldier portraits of their nations, ship portraits per nation)", () => {
    const soldierFiles = soldierEntries().flatMap(entry => {
      const { nations, path, ranked } = entry.soldier.portrait;
      const ranks = Array.from({ length: (entry.variants?.rank?.max ?? 0) + 1 }, (_, rank) => rank);
      return nations.flatMap(nation => [catalogAssetFile(path, { key: entry.key, nation }),
        ...ranked ? ranks.map(rank => catalogAssetFile(ranked, { key: entry.key, nation, rank })) : []]);
    });
    const shipFiles = [...entriesOfKind("ship"), ...entriesOfKind("boat")].flatMap(entry =>
      [...Object.values(entry.ship.nationIcons ?? {}), ...Object.values(entry.ship.neutralIcons ?? {})]
        .map(icon => catalogAssetFile(icon, { key: entry.key })));
    expect([...soldierFiles, ...shipFiles].filter(file => !existsSync(file))).toEqual([]);
  });

  it("bundles a rendered icon for every ware and falls back for unknown save ids", () => {
    for (const { key } of wareEntries()) expect(hasRenderedWareIcon(key), key).toBe(true);
    expect(getWareIconSource("logs")).toMatch(/ware-icons\/logs\.png$/);
    expect(hasRenderedWareIcon("unknownWare")).toBe(false);
  });
});
