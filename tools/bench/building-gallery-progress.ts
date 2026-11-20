import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type GalleryCard, writeGalleryIndex } from "./building-gallery-index";
import { GALLERY_NATIONS, GALLERY_QUALITIES,type galleryCoverage } from "./building-gallery-plan";
import { validateGallerySourceFiles } from "./building-gallery-source";

export interface GalleryPackReport {
  pack: string; attempt: string; passed: boolean; images: GalleryCard[]; results: unknown[];
  finishedAt: string; sourceManifest: string; contactSheets: string[]; elapsedSeconds: number; imageBytes: number;
}
export interface GalleryProgressFiles {
  attemptPrefix?: string; indexFile?: string; reportFile?: string; sourceManifestFile?: string;
}

/** Rebuild only the aggregate navigation/progress files; each native attempt remains immutable. */
export const refreshGalleryProgress = (output: string, plan: ReturnType<typeof galleryCoverage>, files: GalleryProgressFiles = {}) => {
  const cards: GalleryCard[] = [], sheets: string[] = [], packs: Record<string, unknown> = {};
  const sourceFiles: Record<string, { sha256: string; bytes: number }> = {}, missing: string[] = [], conflicts: string[] = [];
  let variants = 0, elapsedSeconds = 0, imageBytes = 0;
  for (const nation of GALLERY_NATIONS) for (const quality of GALLERY_QUALITIES) {
    const pack = `${nation}-${quality}`, folder = resolve(output, "packs", pack);
    const reports = (existsSync(folder) ? readdirSync(folder) : []).flatMap(attempt => {
      const path = resolve(folder, attempt, "report.json");
      return existsSync(path) ? [JSON.parse(readFileSync(path, "utf8")) as GalleryPackReport] : [];
    }).filter(report => report.passed && (!files.attemptPrefix || report.attempt.startsWith(files.attemptPrefix)))
      .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
    const latest = reports.at(-1);
    if (!latest) { missing.push(pack); continue; }
    cards.push(...latest.images); sheets.push(...latest.contactSheets);
    variants += latest.results.length; elapsedSeconds += latest.elapsedSeconds; imageBytes += latest.imageBytes;
    const manifest = JSON.parse(readFileSync(resolve(output, latest.sourceManifest), "utf8"));
    for (const [path, value] of Object.entries(manifest.files) as [string, { sha256: string; bytes: number }][]) {
      if (sourceFiles[path] && sourceFiles[path]!.sha256 !== value.sha256) conflicts.push(path);
      sourceFiles[path] = value;
    }
    packs[pack] = { attempt: latest.attempt, report: `packs/${pack}/${latest.attempt}/report.json`,
      sourceManifest: latest.sourceManifest, variants: latest.results.length, frames: latest.images.length };
  }
  const changed = validateGallerySourceFiles(sourceFiles), stable = !changed.length && !conflicts.length;
  const passed = !missing.length && cards.length === plan.frames && stable;
  const completeAllLevels = passed && plan.completeAllLevels;
  writeFileSync(resolve(output, files.sourceManifestFile ?? "source-manifest.json"), JSON.stringify({ files: sourceFiles, packs, missing,
    stable, changed, conflicts, baseline: "preparation-source-snapshot.json" }, null, 2));
  writeFileSync(resolve(output, files.reportFile ?? "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), passed,
    completeAllLevels, plannedVariants: plan.variants, capturedVariants: variants, plannedFrames: plan.frames,
    capturedFrames: cards.length, missingPacks: missing, packs, imageBytes, elapsedSeconds,
    sourceStable: stable, images: cards, contactSheets: sheets,
    visualAcceptance: "Pending actual image inspection and explicit owner approval. Partial packs never approve the full gallery."
  }, null, 2));
  writeGalleryIndex(output, cards, { capturedVariants: variants, complete: completeAllLevels,
    frames: plan.frames, mode: plan.mode, native: cards.length > 0, omitted: plan.omitted.length,
    passed, sheets, variants: plan.variants, indexFile: files.indexFile, reportFile: files.reportFile,
    sourceManifestFile: files.sourceManifestFile });
  return { completeAllLevels, capturedVariants: variants, capturedFrames: cards.length, missingPacks: missing, stable };
};
