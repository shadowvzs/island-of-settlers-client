import assert from "node:assert/strict";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { BUILDING_LEVELS, type BuildingLevel } from "../../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../../src/render-common/buildings/levels/leveled-building-recipe";
import { isBuildingFirstNation, type WorkerNation } from "../../src/render-common/workers/worker-nation";

export const GALLERY_NATIONS: readonly WorkerNation[] = [
  "roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"
];
export const GALLERY_QUALITIES = ["high", "minimal"] as const;
export type GalleryQuality = typeof GALLERY_QUALITIES[number];
export type GalleryView = "front" | "rear" | "interior";
export type GalleryMode = "base" | "initial" | "full";
export interface GalleryCase {
  id: number; name: string; nation: WorkerNation; quality: GalleryQuality; level: BuildingLevel;
}

export const galleryOptions = (args: readonly string[]) => {
  const read = (key: string, fallback: string) => args.find(arg => arg.startsWith(`--${key}=`))?.split("=")[1] ?? fallback;
  const run = read("run", "integrated-a"), mode = read("mode", "full") as GalleryMode;
  const pack = read("pack", ""), attempt = read("attempt", "a");
  const views = read("views", "front,rear").split(",") as GalleryView[];
  assert(/^[a-z0-9-]+$/.test(run), "Use a fresh simple run ID");
  assert(/^[a-z0-9-]+$/.test(attempt), "Use a fresh simple attempt ID");
  assert(!pack || GALLERY_NATIONS.some(nation => GALLERY_QUALITIES.some(quality => pack === `${nation}-${quality}`)), "Unknown nation/LOD pack");
  assert(["base", "initial", "full"].includes(mode), "Unknown coverage mode");
  assert(views.length && new Set(views).size === views.length &&
    views.every(view => ["front", "rear", "interior"].includes(view)), "Unknown or repeated view");
  assert(args.every(arg => arg === "--prepare" || /^--(run|mode|views|pack|attempt)=/.test(arg)), "Unknown gallery argument");
  assert(args.includes("--prepare") || pack, "Native runs require one explicit --pack; release browser between packs");
  return { attempt, mode, pack, prepare: args.includes("--prepare"), run, views };
};

export const galleryCoverage = (mode: GalleryMode, views: readonly GalleryView[]) => {
  const cases: GalleryCase[] = [], omitted: GalleryCase[] = [];
  for (const nation of GALLERY_NATIONS) for (const quality of GALLERY_QUALITIES)
    for (const definition of BUILDING_CATALOG) {
      const detailed = quality === "high";
      const base = mode === "initial" ? JSON.stringify(leveledBuildingRecipe(definition, nation, detailed, 1)) : "";
      // Imported monuments deliberately ignore upgrade levels in createNationBuilding.
      const upgraded = mode === "initial" && !(definition.id === 7 && !isBuildingFirstNation(nation)) &&
        JSON.stringify(leveledBuildingRecipe(definition, nation, detailed, 5)) !== base;
      for (const level of BUILDING_LEVELS) {
        const entry = { id: definition.id, level, name: definition.name, nation, quality };
        const include = mode === "full" || level === 1 || mode === "initial" && level === 5 && upgraded;
        (include ? cases : omitted).push(entry);
      }
    }
  const baseVariants = cases.filter(entry => entry.level === 1).length;
  const sheetGroups = new Map<string, number>();
  for (const entry of cases) {
    const key = `${entry.nation}:${entry.quality}:${entry.level}`;
    sheetGroups.set(key, (sheetGroups.get(key) ?? 0) + 1);
  }
  const expectedContactSheets = [...sheetGroups.values()].reduce((sum, count) => sum + Math.ceil(count / 12), 0) * views.length;
  return {
    cases, omitted, mode, views, baseVariants, upgradedVariants: cases.length - baseVariants,
    buildingTypes: BUILDING_CATALOG.length, nations: GALLERY_NATIONS.length, qualities: GALLERY_QUALITIES,
    variants: cases.length, frames: cases.length * views.length, expectedContactSheets,
    fullRequestedVariants: BUILDING_CATALOG.length * GALLERY_NATIONS.length * GALLERY_QUALITIES.length * BUILDING_LEVELS.length,
    fullRequestedFrames: BUILDING_CATALOG.length * GALLERY_NATIONS.length * GALLERY_QUALITIES.length * BUILDING_LEVELS.length * views.length,
    completeAllLevels: mode === "full",
    coveragePolicy: "base: every L1; initial: every L1 plus visually changed canonical L5 recipes; full: every L1–L5, including intentional repeated imported-monument art.",
    imagePolicy: "768×640 JPEG quality90, intact opposing front/rear views; optional interior is explicitly labelled global horizontal-clipping diagnostic. No production asset export.",
    estimatedImageBytes: { low: cases.length * views.length * 70_000, high: cases.length * views.length * 180_000 },
    estimatedContactSheetBytes: { low: expectedContactSheets * 90_000, high: expectedContactSheets * 250_000 },
    estimateStatus: "Planning range only; elapsed time and actual bytes are measured by the native run. Initial 8–20min, full 20–50min projected before calibration."
  };
};

export const galleryCaseKey = (entry: GalleryCase) => `${entry.nation}-${entry.id}-${entry.quality}-l${entry.level}`;
