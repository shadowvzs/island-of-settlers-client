import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import type { GalleryCard } from "./building-gallery-index";
import { galleryCaseKey, galleryCoverage, galleryOptions } from "./building-gallery-plan";
import { refreshGalleryProgress } from "./building-gallery-progress";
import { renderGalleryCase, renderGallerySheet } from "./building-gallery-render";
import { gallerySourceGuard,type GallerySourceSnapshot } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

const options = galleryOptions(process.argv.slice(2)), plan = galleryCoverage(options.mode, options.views);
const output = resourcesPath("project-reviews", "building-integrated-gallery-2026-11-04", options.run);
mkdirSync(output, { recursive: true });
const planPath = resolve(output, "plan.json"), baselinePath = resolve(output, "preparation-source-snapshot.json");
if (existsSync(planPath)) {
  const previous = JSON.parse(readFileSync(planPath, "utf8"));
  assert.deepEqual(previous.cases, plan.cases, "Coverage changed: start a fresh gallery run");
  assert.deepEqual(previous.views, plan.views, "View coverage changed: start a fresh gallery run");
} else writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ output, mode: options.mode, variants: plan.variants, frames: plan.frames,
  fullRequestedVariants: plan.fullRequestedVariants, omitted: plan.omitted.length,
  contactSheets: plan.expectedContactSheets, estimatedImages: plan.estimatedImageBytes,
  estimatedSheets: plan.estimatedContactSheetBytes }));

if (options.prepare) {
  if (!existsSync(baselinePath)) writeFileSync(baselinePath, JSON.stringify(gallerySourceGuard().prepared(), null, 2));
  console.log(JSON.stringify(refreshGalleryProgress(output, plan)));
} else {
  assert(existsSync(baselinePath), "Run --prepare first to establish the whole-gallery source baseline");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as GallerySourceSnapshot;
  const guard = gallerySourceGuard(baseline), packRelative = `packs/${options.pack}/${options.attempt}`;
  const packOutput = resolve(output, packRelative);
  assert(!existsSync(packOutput), "Preserve every native attempt; choose a fresh --attempt ID");
  mkdirSync(resolve(packOutput, "images"), { recursive: true });
  mkdirSync(resolve(packOutput, "sheets"), { recursive: true });
  const cards: GalleryCard[] = [], sheets: string[] = [], results: unknown[] = [], failures: unknown[] = [];
  const errors: string[] = [], startedAt = new Date().toISOString(), start = performance.now();
  const [nation, quality] = options.pack.split("-");
  const cases = plan.cases.filter(entry => entry.nation === nation && entry.quality === quality);
  assert(cases.length > 0, "Empty pack");
  const { server, url } = await startDevServer();
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 768, height: 640 }, deviceScaleFactor: 1 });
    page.on("request", request => guard.request(request.url()));
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", request => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}building-showcase.html?sample=1&nation=${nation}&quality=${quality}`, { timeout: 120_000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120_000 });
    let fatal = false, consecutiveFailures = 0;
    for (const entry of cases) {
      if (performance.now() - start > 300_000) { failures.push({ error: "Five-minute bounded pack deadline" }); break; }
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        const { images, ...result } = await Promise.race([
          page.evaluate(renderGalleryCase, { entry, views: options.views }),
          new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error("Case native deadline")), 30_000); })
        ]);
        for (const image of images) {
          const file = `${packRelative}/images/${galleryCaseKey(entry)}-${image.view}.jpg`;
          writeFileSync(resolve(output, file), Buffer.from(image.encoded, "base64"));
          cards.push({ ...entry, file, triangles: result.triangles, view: image.view, withinBudget: result.withinBudget });
        }
        results.push({ ...entry, ...result });
        consecutiveFailures = 0;
        if (results.length % 25 === 0) console.log(`${options.pack}: ${results.length}/${cases.length} models captured`);
      } catch (error) {
        failures.push({ ...entry, error: String(error) }); consecutiveFailures++;
        if (String(error).includes("Case native deadline") || consecutiveFailures >= 3) { fatal = true; break; }
      } finally { clearTimeout(watchdog); }
    }
    for (const level of [1, 2, 3, 4, 5]) for (const view of options.views) {
      if (fatal) continue;
      const selected = cards.filter(card => card.level === level && card.view === view);
      for (let first = 0; first < selected.length; first += 12) {
        const tiles = selected.slice(first, first + 12).map(card => ({
          encoded: readFileSync(resolve(output, card.file)).toString("base64"),
          label: `${card.id} ${card.name} · L${card.level} ${quality} ${view}`
        }));
        const encoded = await page.evaluate(renderGallerySheet, tiles);
        const file = `${packRelative}/sheets/${nation}-${quality}-l${level}-${view}-${first / 12 + 1}.jpg`;
        writeFileSync(resolve(output, file), Buffer.from(encoded, "base64")); sheets.push(file);
      }
    }
    const sourceManifest = guard.finish(), manifestFile = `${packRelative}/source-manifest.json`;
    writeFileSync(resolve(output, manifestFile), JSON.stringify(sourceManifest, null, 2));
    const passed = !failures.length && !errors.length && sourceManifest.stable && cards.length === cases.length * options.views.length;
    const bytes = [...cards.map(card => card.file), ...sheets].reduce((sum, file) => sum + statSync(resolve(output, file)).size, 0);
    writeFileSync(resolve(packOutput, "report.json"), JSON.stringify({ pack: options.pack, attempt: options.attempt,
      startedAt, finishedAt: new Date().toISOString(), elapsedSeconds: (performance.now() - start) / 1000,
      passed, errors, failures, results, images: cards, imageBytes: bytes, contactSheets: sheets,
      sourceManifest: manifestFile, plannedFrames: cases.length * options.views.length, capturedFrames: cards.length,
      visualAcceptance: "One bounded pack only. Pending image inspection and explicit owner approval; no production assets published."
    }, null, 2));
    console.log(JSON.stringify(refreshGalleryProgress(output, plan)));
    assert(passed, "Pack native/source guards failed; preserve this attempt and inspect the receipt");
  } finally {
    await browser?.close();
    await server.close();
  }
  console.log(`Integrated gallery pack CLOSED: ${options.pack}/${options.attempt}, ${cards.length} images, ${sheets.length} sheets`);
}
