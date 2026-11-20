import type { Page } from "playwright-core";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { triangleBudgetFails } from "./triangle-budget";

/** Upgrade levels audited beside the exported level 1 libraries. */
const UPGRADE_LEVELS = [2, 3, 4, 5] as const;

/**
 * Counts every building of the open showcase at levels 2-5 against its level 1 budget (15 % over
 * warns, beyond fails) and returns the failures. The showcase is left at level 1 for the export.
 */
export const auditLevelBudgets = async (page: Page, label: string, budgetOf: (id: number) => number, ids?: ReadonlySet<number>) => {
  const failures: string[] = [];
  const definitions = ids ? BUILDING_CATALOG.filter(definition => ids.has(definition.id)) : BUILDING_CATALOG;
  for (const level of UPGRADE_LEVELS) for (const definition of definitions) {
    const triangles = await page.evaluate(async ([id, next]) => {
      const preview = (window as any).__buildingPreview;
      preview.selectBuilding(id, next);
      await (window as any).__buildingResidentReady;
      return preview.model().triangles(false) as number;
    }, [definition.id, level] as const);
    const name = `${label}/${definition.id}/level ${level}`, budget = budgetOf(definition.id);
    if (triangleBudgetFails(name, triangles, budget)) failures.push(`${name}: ${triangles}/${budget}`);
  }
  await page.evaluate(id => (window as any).__buildingPreview.selectBuilding(id, 1), BUILDING_CATALOG[0]!.id);
  if (!failures.length) console.log(`${label}: levels 2-5 of ${definitions.length} models inside the triangle budget tolerance`);
  return failures;
};
