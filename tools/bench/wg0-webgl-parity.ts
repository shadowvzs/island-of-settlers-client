import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  aimPossessed, freezeIso, openFrozenPage, pinScene, readFrame, stageFrozenSave
} from "./frozen-frame-review";
import {
  createSeedSave, enterPossessed, OWNER_SAVE, PARITY_VIEWPORT, writeDiffPng
} from "./parity-helpers";

/**
 * WG-0 WebGL parity capture: the same frozen S1/S2 frames from the checkout that runs it. Run the
 * lane script through TOOL-4 (`ab-runner --base master`) so the base and lane images share the
 * same frames; `PARITY_BASE_DIR` then compares them with the shared x16 image diff.
 *
 *   <captures>/browser-slot.sh npx tsx tools/bench/wg0-webgl-parity.ts
 */
const CAPTURES = process.env.CAPTURES ??
  "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures";
const OUT = resolve(process.env.OUTPUT_DIR ?? join(CAPTURES, "wg-0", "parity"));
const SEED_SAVE = join(OUT, "seed-123-save.json");
const NO_POST = process.env.PARITY_NO_POST === "1";

const commit = () => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
};

const writeShot = (directory: string, name: string, dataUrl: string) => {
  writeFileSync(join(directory, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
};

/** Optional deterministic pass: no eye adaptation/bloom/AO/post (same draw path, simpler frame). */
const disablePost = async (page: Page) => {
  if (!NO_POST) return;
  await page.evaluate(() => (globalThis as any).__sceneTarget?.(false));
  await page.waitForTimeout(500);
};

const main = async () => {
  const side = join(OUT, commit());
  mkdirSync(side, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    const seedSave = existsSync(SEED_SAVE) ? readFileSync(SEED_SAVE, "utf8") :
      await createSeedSave(browser, url, { name: "WG-0 seed 123", path: SEED_SAVE });
    const ownerSave = stageFrozenSave(readFileSync(OWNER_SAVE, "utf8"));
    const s1 = await openFrozenPage(browser, url, { query: "&renderer=webgl",
      quality: "high", stagedSave: ownerSave, viewport: PARITY_VIEWPORT });
    await s1.page.evaluate(() => (globalThis as any).__settlement?.focusGround?.(170, 68, .75));
    await s1.page.waitForTimeout(1000);
    await pinScene(s1.page, "day", true);
    await disablePost(s1.page);
    await freezeIso(s1.page);
    writeShot(side, "s1", (await readFrame(s1.page)).dataUrl);
    await s1.page.close();
    const s2 = await openFrozenPage(browser, url, { query: "&renderer=webgl&view=100,52,2.2",
      quality: "high", stagedSave: stageFrozenSave(seedSave), viewport: PARITY_VIEWPORT });
    await pinScene(s2.page, "day", true);
    await disablePost(s2.page);
    await enterPossessed(s2.page);
    await aimPossessed(s2.page, { pitch: -0.12, x: 100, yaw: 0, z: 52 });
    writeShot(side, "s2", (await readFrame(s2.page)).dataUrl);
    await s2.page.close();
    const errors = [...s1.errors, ...s2.errors];
    writeFileSync(join(side, "errors.json"), JSON.stringify(errors, null, 2));
    assert.equal(errors.length, 0, "page errors");
    const baseDirectory = process.env.PARITY_BASE_DIR;
    if (baseDirectory !== undefined) {
      const diffs = [];
      for (const name of ["s1", "s2"] as const)
        diffs.push({ name, stats: await writeDiffPng(browser, join(baseDirectory, `${name}.png`),
          join(side, `${name}.png`), join(side, `diff-${name}.png`)) });
      writeFileSync(join(side, "diff.json"), JSON.stringify(diffs, null, 2));
    }
    console.log(`Parity captures: ${side}`);
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
