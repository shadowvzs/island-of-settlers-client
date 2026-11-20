import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const runId = process.argv[2];
assert(runId && /^[a-z0-9-]+$/.test(runId), "Choose a new explicit Tannery review run ID");
const bodyArgument = process.argv.find(argument => argument.startsWith("--bodies="));
const variants = bodyArgument?.slice("--bodies=".length).split(",") ?? ["chinese-male-1", "chinese-female-3"];
assert(variants.length && variants.every(variant => /^chinese-(male|female)-[123]$/.test(variant)),
  "Tannery review bodies must be existing Chinese civilian variants");
const output = resourcesPath("project-reviews", "tannery-tabletop-pickup-2026-11-04", runId);
await mkdir(output);
const assetRoot = resolve("../island-of-settlers-worker-generation/game_ready");
const sourceFiles = ["src/renderers/three/worker-transfer-pose.ts", "src/renderers/three/three-worker.ts",
  "src/renderers/three/three-worker-prop.ts", "src/renderers/three/worker-ware-transfer.ts",
  "src/render-common/buildings/building-stock-anchors.ts", "src/render-common/buildings/roman-ware-stock.ts",
  "src/render-common/buildings/tannery-table-contact.ts", "src/render-common/buildings/roman-craft-designs.ts",
  "src/renderers/three/worker-hide-transfer.ts", "src/renderers/three/worker-soft-carry.ts",
  "src/renderers/three/worker-soft-load-contacts.ts", "src/renderers/three/worker-prop-surface.ts",
  "src/renderers/three/worker-cradle-carry.ts", "src/renderers/three/worker-tabletop-grips.ts",
  "src/renderers/three/worker-tabletop-reach.ts", "src/renderers/three/worker-loaded-locomotion.ts", "tools/bench/tannery-transfer-fixture.ts"];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
const sourceHashes = await hashes();
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], records: unknown[] = [];
try {
  browser = await launchBrowser();
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    try {
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket("**/*", () => {});
      await page.addInitScript("window.__name=value=>value;");
      await page.goto(`${url}building-showcase.html?nation=chinese&quality=${quality}&sample=1&building=8`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      await page.evaluate(async ({ assetRoot, minimal }) => {
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null); await (window as any).__buildingResidentReady;
        preview.model().fitToGrid(); preview.renderer.setSize(800, 800);
        preview.camera.aspect = 1; preview.camera.updateProjectionMatrix();
        const { createTanneryTransferFixture } = await import(
          /* @vite-ignore */ String("/tools/bench/tannery-transfer-fixture.ts"));
        (window as any).__tanneryTransfer = createTanneryTransferFixture(preview, assetRoot, minimal);
      }, { assetRoot, minimal: quality === "minimal" });
      for (const variant of variants) {
        const result = await page.evaluate(async variant => (window as any).__tanneryTransfer.capture(variant), variant);
        for (const image of result.images)
          await writeFile(resolve(output, `${variant}-${quality}-${image.name}.png`), Buffer.from(image.png, "base64"));
        records.push({ variant, quality, phases: result.records });
        console.log(`${variant}/${quality}: ${result.records.length} actual transfer poses`);
        await writeFile(resolve(output, "progress.json"), JSON.stringify({ records, errors }, null, 2));
      }
      await page.evaluate(() => (window as any).__tanneryTransfer.dispose());
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await hashes(), sourceHashes, "Tannery runtime source changed during native capture");
  await writeFile(resolve(output, "report.json"), JSON.stringify({ records, errors,
    sourceHashes, sourceUnchanged: true, visualAndContactAcceptancePending: true }, null, 2));
} finally { await browser?.close(); await server.close(); }
console.log(JSON.stringify({ output, variants: records.length, errors, sourceUnchanged: true }));
