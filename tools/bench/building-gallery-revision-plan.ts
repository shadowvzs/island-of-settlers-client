import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type GalleryCase,galleryCaseKey, galleryCoverage } from "./building-gallery-plan";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

export interface RevisionScope {
  baseRun: string; run: string; revision?: string; beforeRecipes: string; afterRecipes: string; recipeSources: string[];
  rendererChanges: { paths: string[]; justification: string }[];
  force: { nations: string[]; ids: number[]; justification: string }[];
}
export const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
export const fileDigest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
export const galleryRunPath = (run: string) => {
  assert(/^[a-z0-9-]+$/.test(run), "Unsafe gallery run ID");
  return resourcesPath("project-reviews", "building-integrated-gallery-2026-11-04", run);
};

/** A revision may update the same review index while every earlier native attempt remains immutable. */
export const galleryRevisionFiles = (revision = "owner-r2") => {
  assert(/^[a-z0-9-]+$/.test(revision), "Unsafe gallery revision ID");
  const directory = `revisions/${revision}`;
  return { revision, directory, certificate: `${directory}/certificate.json`,
    baseline: `${directory}/source-snapshot.json`, baseReport: `${directory}/base-report.json`,
    baseManifest: `${directory}/base-source-manifest.json`, baseIndex: `${revision}-previous-index.html` };
};

export const galleryRevisionTargets = (cases: readonly GalleryCase[], before: Record<string, string>,
  after: Record<string, string>, forced: RevisionScope["force"]) => {
  const changedRecipes = cases.filter(entry => {
    const key = galleryCaseKey(entry); assert(before[key] && after[key], `Missing recipe ${key}`);
    return before[key] !== after[key];
  });
  const familyKey = (entry: GalleryCase) => `${entry.nation}-${entry.id}-${entry.quality}`;
  const families = new Set(changedRecipes.map(familyKey));
  for (const scope of forced) {
    assert(scope.justification.trim());
    const selected = cases.filter(entry => scope.nations.includes(entry.nation) && scope.ids.includes(entry.id));
    assert(selected.length, "Forced renderer scope matches no canonical cases");
    selected.forEach(entry => families.add(familyKey(entry)));
  }
  return { changedRecipes, targeted: cases.filter(entry => families.has(familyKey(entry))) };
};

export const prepareGalleryRevision = (scopePath: string) => {
  const scope: RevisionScope = readJson(scopePath), base = galleryRunPath(scope.baseRun), output = galleryRunPath(scope.run);
  const files = galleryRevisionFiles(scope.revision);
  if (scope.baseRun !== scope.run)
    files.baseIndex = `../${scope.baseRun}/${scope.run}-${files.baseIndex}`;
  assert(scope.baseRun === scope.run || !existsSync(output), "Preserve every previous gallery run");
  assert(!existsSync(resolve(output, files.directory)), "Preserve every previous revision certificate");
  const plan = galleryCoverage("full", ["front", "rear"]), baseReport = readJson(resolve(base, "report.json"));
  assert.equal(baseReport.capturedFrames, plan.frames);
  assert.equal(baseReport.capturedVariants, plan.variants);
  assert.equal(Object.keys(baseReport.packs).length, 16);
  for (const pack of Object.values(baseReport.packs) as any[])
    assert(readJson(resolve(base, pack.report)).passed, "Only original passing native packs can be reused");
  const before = readJson(scope.beforeRecipes).hashes as Record<string, string>;
  const after = readJson(scope.afterRecipes).hashes as Record<string, string>;
  assert.equal(Object.keys(before).length, plan.variants); assert.equal(Object.keys(after).length, plan.variants);
  const { changedRecipes, targeted } = galleryRevisionTargets(plan.cases, before, after, scope.force);
  // A change to any level can alter shared level-5 framing; refresh all five levels of that family.
  const oldFiles = readJson(resolve(base, "source-manifest.json")).files as Record<string, { sha256: string; bytes: number }>;
  const allowed = new Set([...scope.recipeSources, ...scope.rendererChanges.flatMap(change => change.paths)]);
  for (const change of scope.rendererChanges) assert(change.justification.trim(), "Renderer changes need reviewed scope");
  const changedFiles: { path: string; before: string; after: string }[] = [];
  const currentDependencyFiles: Record<string, { sha256: string; bytes: number }> = {};
  for (const [path, record] of Object.entries(oldFiles)) {
    const digest = fileDigest(path);
    if (digest !== record.sha256) {
      assert(allowed.has(path), `Unclassified dependency changed: ${path}`);
      changedFiles.push({ path, before: record.sha256, after: digest });
    }
    currentDependencyFiles[path] = { sha256: digest, bytes: statSync(path).size };
  }
  for (const path of allowed) if (!currentDependencyFiles[path])
    currentDependencyFiles[path] = { sha256: fileDigest(path), bytes: statSync(path).size };
  // Preserve the exact rendering/camera/canvas implementation used by the original pixels.
  for (const path of ["tools/bench/building-gallery-render.ts", "src/building-showcase/main.ts",
    "src/building-showcase/ground.ts", "src/building-showcase/style.css", "building-showcase.html"])
    assert(!changedFiles.some(file => file.path === path), `Capture presentation changed; full recapture required: ${path}`);
  const certificate = { scope, revisionFiles: files, changedFiles, changedRecipeCases: changedRecipes.map(galleryCaseKey),
    targetedCases: targeted.map(galleryCaseKey), targetedVariants: targeted.length, refreshedFrames: targeted.length * 2,
    reusedVariants: plan.variants - targeted.length, reusedFrames: (plan.variants - targeted.length) * 2,
    currentDependencyFiles, beforeRecipes: before, afterRecipes: after,
    policy: targeted.length === plan.variants
      ? "Every canonical nation/type/level/LOD variant requires fresh capture. No earlier pixels are reused. Original per-pack images and source versions remain preserved; capture completion does not grant visual or owner approval."
      : "Fresh Full-B pixels are reused only for unchanged canonical recipes outside explicitly reviewed renderer scopes. All five levels refresh when any family changes, preserving shared framing. Original per-pack source versions remain available; this certificate does not claim every pixel was recaptured." };
  mkdirSync(resolve(output, files.directory), { recursive: true });
  if (!existsSync(resolve(output, "plan.json"))) writeFileSync(resolve(output, "plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(resolve(output, files.baseReport), JSON.stringify(baseReport, null, 2));
  writeFileSync(resolve(output, files.baseManifest), readFileSync(resolve(base, "source-manifest.json")));
  // Same-root placement preserves the original HTML bytes and every relative image link.
  writeFileSync(resolve(output, files.baseIndex), readFileSync(resolve(base, "index.html")), { flag: "wx" });
  writeFileSync(resolve(output, files.certificate), JSON.stringify(certificate, null, 2));
  writeFileSync(resolve(output, files.baseline), JSON.stringify(gallerySourceGuard().prepared(), null, 2));
  writeFileSync(resolve(output, "current-revision.json"), JSON.stringify(files, null, 2));
  return { output, plan, certificate };
};
