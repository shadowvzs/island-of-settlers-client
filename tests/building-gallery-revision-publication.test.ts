import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { galleryCaseKey, galleryCoverage } from "../tools/bench/building-gallery-plan";
import { galleryRevisionFiles } from "../tools/bench/building-gallery-revision-plan";
import { refreshRevisionProgress } from "../tools/bench/building-gallery-revision-progress";

const createPublicationFixture = () => {
  const output = mkdtempSync(resolve(tmpdir(), "gallery-publication-"));
  const files = galleryRevisionFiles("owner-r2"), plan = galleryCoverage("full", ["front", "rear"]);
  const source = resolve(output, "fixture-source.ts"), originalSource = "export const original = true;\n";
  writeFileSync(source, originalSource);
  const sourceFiles = { [source]: { bytes: Buffer.byteLength(originalSource),
    sha256: createHash("sha256").update(originalSource).digest("hex") } };
  const originals = { "index.html": "Original owner gallery", "report.json": '{"original":true}',
    "source-manifest.json": '{"original":true}' };
  for (const [name, contents] of Object.entries(originals)) writeFileSync(resolve(output, name), contents);
  mkdirSync(resolve(output, files.directory), { recursive: true });
  writeFileSync(resolve(output, "current-revision.json"), JSON.stringify(files));
  writeFileSync(resolve(output, files.certificate), JSON.stringify({ scope: { baseRun: "fixture" },
    targetedVariants: plan.variants, refreshedFrames: plan.frames, reusedVariants: 0, reusedFrames: 0,
    policy: "All fixture packs must publish together." }));
  const packs = [...new Set(plan.cases.map(entry => `${entry.nation}-${entry.quality}`))];
  const addPack = (pack: string, attempt: string) => {
    const directory = `packs/${pack}/${attempt}`;
    const cases = plan.cases.filter(entry => `${entry.nation}-${entry.quality}` === pack);
    const manifest = `${directory}/source-manifest.json`;
    mkdirSync(resolve(output, directory), { recursive: true });
    writeFileSync(resolve(output, manifest), JSON.stringify({ files: sourceFiles }));
    writeFileSync(resolve(output, directory, "report.json"), JSON.stringify({ pack, attempt, passed: true,
      finishedAt: "2026-11-05T00:00:00Z", sourceManifest: manifest, results: cases,
      images: cases.flatMap(entry => plan.views.map(view => ({ ...entry, view,
        file: `${directory}/${galleryCaseKey(entry)}-${view}.jpg`, triangles: 100, withinBudget: true }))),
      contactSheets: [], elapsedSeconds: 1, imageBytes: 1 }));
  };
  const expectOriginals = () => {
    for (const [name, contents] of Object.entries(originals))
      expect(readFileSync(resolve(output, name), "utf8")).toBe(contents);
  };
  return { addPack, expectOriginals, files, originalSource, output, packs, plan, source };
};

it("keeps the published index and reports intact while separate fresh-only revision progress grows", () => {
  const fixture = createPublicationFixture();
  try {
    for (const pack of fixture.packs) fixture.addPack(pack, "a");
    const empty = refreshRevisionProgress(fixture.output);
    expect(empty.published).toBe(false);
    expect(empty.capturedFrames).toBe(0);
    fixture.expectOriginals();
    fixture.addPack(fixture.packs[0]!, "owner-r2-a");
    const partial = refreshRevisionProgress(fixture.output);
    expect(partial.published).toBe(false);
    expect(partial.capturedFrames).toBe(570);
    fixture.expectOriginals();
    const staged = readFileSync(resolve(fixture.output, "owner-r2-progress.html"), "utf8");
    expect(staged).toContain("1/16 packs complete");
    expect(staged).toContain('href="owner-r2-report.json"');
    expect(staged).toContain('href="owner-r2-source-manifest.json"');
  } finally { rmSync(fixture.output, { recursive: true, force: true }); }
});

it("publishes all16 coherent fresh packs together only after the current source hashes validate", () => {
  const fixture = createPublicationFixture();
  try {
    for (const pack of fixture.packs) fixture.addPack(pack, "owner-r2-a");
    writeFileSync(fixture.source, "changed after capture");
    const unstable = refreshRevisionProgress(fixture.output);
    expect(unstable.published).toBe(false);
    expect(unstable.stable).toBe(false);
    fixture.expectOriginals();
    writeFileSync(fixture.source, fixture.originalSource);
    const complete = refreshRevisionProgress(fixture.output);
    expect(complete.published).toBe(true);
    expect(complete.capturedFrames).toBe(fixture.plan.frames);
    const report = JSON.parse(readFileSync(resolve(fixture.output, "report.json"), "utf8"));
    expect(report.revision.completedPacks).toBe(16);
    expect(report.completeAllLevels).toBe(true);
    const published = readFileSync(resolve(fixture.output, "index.html"), "utf8");
    expect(published).toContain("16/16 packs complete");
    expect(published).toContain('href="report.json"');
    expect(published).toContain('href="owner-r2-previous-index.html"');
    expect(published).not.toContain('href="owner-r2-report.json"');
    expect(JSON.parse(readFileSync(resolve(fixture.output, "source-manifest.json"), "utf8")).stable).toBe(true);
  } finally { rmSync(fixture.output, { recursive: true, force: true }); }
});
