import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { galleryCoverage } from "./building-gallery-plan";
import { refreshGalleryProgress } from "./building-gallery-progress";
import { readJson } from "./building-gallery-revision-plan";

export const refreshRevisionProgress = (output: string) => {
  const revisionFiles = readJson(resolve(output, "current-revision.json"));
  const plan = galleryCoverage("full", ["front", "rear"]), certificate = readJson(resolve(output, revisionFiles.certificate));
  const stagedFiles = { indexFile: `${revisionFiles.revision}-progress.html`,
    reportFile: `${revisionFiles.revision}-report.json`, sourceManifestFile: `${revisionFiles.revision}-source-manifest.json` };
  const progress = refreshGalleryProgress(output, plan, { ...stagedFiles, attemptPrefix: `${revisionFiles.revision}-` });
  const path = resolve(output, stagedFiles.reportFile), report = readJson(path);
  const completed = Object.values(report.packs).filter((pack: any) =>
    pack.attempt.startsWith(`${revisionFiles.revision}-`)).length;
  report.revision = { certificate: revisionFiles.certificate, baseRun: certificate.scope.baseRun,
    completedPacks: completed, requiredPacks: 16,
    refreshedVariants: certificate.targetedVariants, refreshedFrames: certificate.refreshedFrames,
    reusedVariants: certificate.reusedVariants, reusedFrames: certificate.reusedFrames,
    policy: certificate.policy };
  writeFileSync(path, JSON.stringify(report, null, 2));
  const indexPath = resolve(output, stagedFiles.indexFile);
  writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace("<nav>", `<p class="notice">Targeted revision ${revisionFiles.revision}: ${completed}/16 packs complete.
${certificate.refreshedFrames} frames require fresh capture; ${certificate.reusedFrames} are reused from the recent
${certificate.scope.baseRun} actual-model captures after unchanged recipe/scoped renderer verification.
Original images and source versions remain preserved. <a href="${revisionFiles.baseIndex}">Previous gallery</a> ·
<a href="${revisionFiles.baseReport}">Previous report</a> · <a href="${revisionFiles.baseManifest}">Previous sources</a> ·
<a href="${revisionFiles.certificate}">Revision certificate</a>.</p><nav>`));
  const published = completed === 16 && progress.completeAllLevels;
  if (published) {
    // Keep the owner's current gallery byte-for-byte intact until the entire revision is coherent.
    // Publish the index last; its referenced reports and source manifest already exist atomically.
    for (const [staged, target] of [[stagedFiles.sourceManifestFile, "source-manifest.json"],
      [stagedFiles.reportFile, "report.json"], [stagedFiles.indexFile, "index.html"]] as const) {
      const pending = resolve(output, `${target}.${revisionFiles.revision}.pending`);
      const content = readFileSync(resolve(output, staged), "utf8");
      const publishedContent = target === "index.html" ? content.replaceAll(stagedFiles.reportFile, "report.json")
        .replaceAll(stagedFiles.sourceManifestFile, "source-manifest.json") : content;
      writeFileSync(pending, publishedContent); renameSync(pending, resolve(output, target));
    }
  }
  return { ...progress, published };
};
