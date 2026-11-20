import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import type { GalleryCard } from "./building-gallery-index";
import { galleryCaseKey, galleryCoverage, galleryOptions } from "./building-gallery-plan";
import { renderGalleryCase, renderGallerySheet } from "./building-gallery-render";
import { fileDigest, galleryRunPath, prepareGalleryRevision, readJson } from "./building-gallery-revision-plan";
import { refreshRevisionProgress } from "./building-gallery-revision-progress";
import { gallerySourceGuard,type GallerySourceSnapshot } from "./building-gallery-source";
import { preserveGallerySourceVersions } from "./building-gallery-source-versions";

const args = process.argv.slice(2), scopePath = args.find(arg => arg.startsWith("--scope="))?.slice(8);
const options = galleryOptions(args.filter(arg => !arg.startsWith("--scope=")));
const output = galleryRunPath(options.run);
if (options.prepare) {
  assert(scopePath, "Revision preparation requires reviewed --scope JSON");
  assert.equal(readJson(scopePath).run, options.run, "Scope and command run IDs must agree before writing");
  const prepared = prepareGalleryRevision(scopePath);
  assert.equal(prepared.output, output);
  console.log(JSON.stringify({ output, freshVariants: prepared.certificate.targetedVariants,
    freshFrames: prepared.certificate.refreshedFrames, reusedFrames: prepared.certificate.reusedFrames }));
  console.log(JSON.stringify(refreshRevisionProgress(output)));
} else {
  const revisionFiles = readJson(resolve(output, "current-revision.json"));
  const certificate = readJson(resolve(output, revisionFiles.certificate));
  const plan = galleryCoverage("full", ["front", "rear"]), base = galleryRunPath(certificate.scope.baseRun);
  const baseReport = readJson(resolve(output, revisionFiles.baseReport));
  const basePack = readJson(resolve(base, baseReport.packs[options.pack].report));
  const targetKeys = new Set<string>(certificate.targetedCases);
  const [nation, quality] = options.pack.split("-");
  const cases = plan.cases.filter(entry => entry.nation === nation && entry.quality === quality && targetKeys.has(galleryCaseKey(entry)));
  const attempt = `${revisionFiles.revision}-${options.attempt}`;
  const packRelative = `packs/${options.pack}/${attempt}`, packOutput = resolve(output, packRelative);
  assert(!existsSync(packOutput), "Preserve every native attempt; choose a fresh attempt ID");
  mkdirSync(resolve(packOutput, "images"), { recursive: true });
  mkdirSync(resolve(packOutput, "sheets"), { recursive: true });
  const inherited = certificate.scope.baseRun === options.run ? "" : `../${certificate.scope.baseRun}/`;
  const cards: GalleryCard[] = basePack.images.map((card: GalleryCard) => ({ ...card, file: inherited + card.file }));
  const resultMap = new Map<string, any>(basePack.results.map((row: any) => [galleryCaseKey(row), { ...row, reused: true }]));
  const sheets: string[] = [], errors: string[] = [], failures: unknown[] = [];
  const startedAt = new Date().toISOString(), start = performance.now();
  const baseline: GallerySourceSnapshot = readJson(resolve(output, revisionFiles.baseline));
  const guard = gallerySourceGuard(baseline), { server, url } = await startDevServer();
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 768, height: 640 }, deviceScaleFactor: 1 });
    page.on("request", request => guard.request(request.url()));
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}building-showcase.html?sample=1&nation=${nation}&quality=${quality}`, { timeout: 120_000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120_000 });
    for (const entry of cases) {
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        assert(performance.now() - start < 300_000, "Five-minute bounded revision deadline");
        const { images, ...result } = await Promise.race([
          page.evaluate(renderGalleryCase, { entry, views: plan.views }),
          new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error("Case native deadline")), 30_000); })
        ]);
        for (const image of images) {
          const file = `${packRelative}/images/${galleryCaseKey(entry)}-${image.view}.jpg`;
          writeFileSync(resolve(output, file), Buffer.from(image.encoded, "base64"));
          const index = cards.findIndex(card => galleryCaseKey(card) === galleryCaseKey(entry) && card.view === image.view);
          assert(index >= 0); cards[index] = { ...entry, file, triangles: result.triangles,
            withinBudget: result.withinBudget, view: image.view };
        }
        resultMap.set(galleryCaseKey(entry), { ...entry, ...result, reused: false });
      } catch (error) { failures.push({ ...entry, error: String(error) }); break; }
      finally { clearTimeout(watchdog); }
    }
    if (!failures.length) for (const level of [1, 2, 3, 4, 5]) for (const view of plan.views) {
      const selected = cards.filter(card => card.level === level && card.view === view);
      for (let first = 0; first < selected.length; first += 12) {
        const group = selected.slice(first, first + 12), name = `${nation}-${quality}-l${level}-${view}-${first / 12 + 1}.jpg`;
        if (!group.some(card => targetKeys.has(galleryCaseKey(card)))) {
          const original = basePack.contactSheets.find((file: string) => file.endsWith(`/${name}`));
          assert(original); sheets.push(inherited + original); continue;
        }
        const tiles = group.map(card => ({ encoded: readFileSync(resolve(output, card.file)).toString("base64"),
          label: `${card.id} ${card.name} · L${card.level} ${quality} ${view}` }));
        const encoded = await page.evaluate(renderGallerySheet, tiles), file = `${packRelative}/sheets/${name}`;
        writeFileSync(resolve(output, file), Buffer.from(encoded, "base64")); sheets.push(file);
      }
    }
    const nativeManifest = guard.finish();
    const hasInheritedPixels = cases.length < basePack.results.length;
    const files = { ...(hasInheritedPixels ? certificate.currentDependencyFiles : {}), ...nativeManifest.files };
    for (const [path, value] of Object.entries(files) as [string, { sha256: string }][]) {
      if (fileDigest(path) !== value.sha256) nativeManifest.errors.push(`Inherited/fresh dependency changed: ${path}`);
    }
    const stable = nativeManifest.errors.length === 0;
    const sourceVersions = stable ? preserveGallerySourceVersions(output, revisionFiles.directory, files) : {};
    const sourceManifest = `${packRelative}/source-manifest.json`;
    writeFileSync(resolve(output, sourceManifest), JSON.stringify({ ...nativeManifest, files, stable, sourceVersions,
      freshlyRequestedFiles: nativeManifest.files, reuseCertificate: revisionFiles.certificate,
      inheritedFrom: baseReport.packs[options.pack].sourceManifest }, null, 2));
    const results = [...resultMap.values()], passed = !failures.length && !errors.length && stable &&
      cases.every(entry => resultMap.get(galleryCaseKey(entry))?.reused === false);
    const imageBytes = [...cards.map(card => card.file), ...sheets].reduce((sum, file) => sum + statSync(resolve(output, file)).size, 0);
    writeFileSync(resolve(packOutput, "report.json"), JSON.stringify({ pack: options.pack, attempt,
      startedAt, finishedAt: new Date().toISOString(), passed, errors, failures, results, images: cards,
      sourceManifest, contactSheets: sheets, imageBytes, elapsedSeconds: (performance.now() - start) / 1000,
      freshVariants: cases.length, reusedVariants: results.length - cases.length,
      basePackReport: inherited + baseReport.packs[options.pack].report, reuseCertificate: revisionFiles.certificate,
      visualAcceptance: hasInheritedPixels
        ? "Targeted fresh canonical capture plus explicitly certified unchanged Full-B pixels; owner approval remains pending."
        : "Every canonical case in this pack captured fresh; no earlier pixels reused. Image inspection and owner approval remain pending."
    }, null, 2));
    console.log(JSON.stringify(refreshRevisionProgress(output)));
    assert(passed, "Revision guards failed; preserve this attempt");
  } finally { await browser?.close(); await server.close(); }
  console.log(`Gallery revision CLOSED: ${options.pack}, ${cases.length} fresh variants; all original pixels preserved`);
}
