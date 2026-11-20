#!/usr/bin/env npx tsx
/**
 * Native in-page island handoff review.
 *
 * Usage:
 *   npx tsx tools/bench/island-handoff-review.ts --save path/to/save.json [--cycles 2] [--quality high]
 *
 * The save must be current-format. If it is already on a colony, the tool uses it unchanged. If it
 * is on the home island, the tool composes a schema-valid active-colony fixture from the save's own
 * island state: this exercises the real teardown/prepare/install path without claiming to be a
 * gameplay-produced colony. The departure record it files is a real save of that island.
 *
 * The run starts on the colony, then repeats colony -> home -> colony in one document and collects
 * the handoff receipts. It asserts one canvas and one receipt per leg, cleared startup fallbacks and
 * a later camera save surviving refresh. It runs as a standalone guest; it does not claim the full
 * ISLAND-LOAD-02 heap/listener/GPU-object acceptance.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";

import type { HandoffReceiptSnapshot } from "../../src/app/handoff-receipt";
import { launchEngine, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";
import { prepareColonyFixture } from "./island-handoff-fixture";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const savePath = option("save", "");
if (!savePath) throw new Error("--save is required");
const cycles = Math.max(1, Number(option("cycles", "2")) || 2);
const quality = option("quality", "high");
const output = option("out", "");

const main = async () => {
  const { colonyId, save } = prepareColonyFixture(JSON.parse(readFileSync(savePath, "utf8")) as Record<string, unknown>);
  const { server, url } = await startDevServer({ env: { VITE_API_URL: "", VITE_IDENTITY_URL: "" } });
  const browser = await launchEngine("chromium");
  try {
    const page: Page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await stageStartupSave(page, url, JSON.stringify(save));
    // The standalone guest path must read its saved slot after refresh, like a real browser launch.
    await page.goto(`${url}?quality=${quality}&login=1`);
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
    await page.waitForFunction(() => Boolean((window as { __islandReady?: boolean }).__islandReady), null,
      { timeout: 240_000 });

    const openTracker = async () => {
      await page.locator(".colony-tracker").waitFor({ state: "visible", timeout: 30_000 });
      if (await page.locator(".colony-tracker__body").isHidden())
        await page.locator(".colony-tracker__handle").click();
    };
    const state = () => page.evaluate(async () => {
      const root = window as unknown as {
        __settlement?: { simulation: { colony: () => unknown } };
        __handoffReceipts?: () => HandoffReceiptSnapshot[];
        __inPageMarker?: number;
      };
      const mod = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      const store = await mod.openLocalSaveStore();
      const current = await store.readSavedGame() as
        { archipelago?: { active?: number | null; colonies?: { save?: unknown }[] } } | null;
      return {
        active: current?.archipelago?.active ?? null,
        canvases: document.querySelectorAll("canvas#view").length,
        colony: Boolean(root.__settlement?.simulation.colony()),
        colonySaves: current?.archipelago?.colonies?.map(colony => Boolean(colony.save)) ?? [],
        marker: root.__inPageMarker,
        receipts: root.__handoffReceipts?.() ?? [],
        startupPending: (await store.readStartupGame()) !== null
      };
    });
    const mark = () => page.evaluate(() => {
      (window as { __inPageMarker?: number }).__inPageMarker = Math.random();
      return (window as { __inPageMarker?: number }).__inPageMarker;
    });
    const waitLoading = () => page.locator("#loading-screen").waitFor({ state: "visible", timeout: 30_000 });
    const waitIdle = () => page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
    const waitColony = () => page.waitForFunction(() => {
      const root = window as unknown as { __settlement?: { simulation: { colony: () => unknown } } };
      return Boolean((window as { __islandReady?: boolean }).__islandReady) &&
        Boolean(root.__settlement?.simulation.colony());
    }, null, { timeout: 240_000 });
    const waitHome = () => page.waitForFunction(() => {
      const root = window as unknown as { __settlement?: { simulation: { colony: () => unknown } } };
      return Boolean((window as { __islandReady?: boolean }).__islandReady) &&
        Boolean(root.__settlement) && !root.__settlement!.simulation.colony();
    }, null, { timeout: 240_000 });

    const start = await state();
    if (!start.colony) throw new Error("The fixture did not open on a colony");
    const activated = (receipt: HandoffReceiptSnapshot | undefined) =>
      Boolean(receipt?.phases.some(phase => phase.phase === "activate")) &&
      !receipt?.phases.some(phase => phase.phase === "resume-old" || phase.phase === "reload-required");
    let expected = 0;
    const legs: unknown[] = [];
    for (let cycle = 1; cycle <= cycles; cycle++) {
      await openTracker();
      const homeMarker = await mark();
      await page.getByRole("button", { name: "Return to the home island" }).click();
      await waitLoading();
      await waitHome();
      await waitIdle();
      const home = await state();
      expected++;
      legs.push({ direction: "home", cycle, active: home.active, receipts: home.receipts.length });
      if (home.marker !== homeMarker) throw new Error(`cycle ${cycle}: return home reloaded the document`);
      if (home.canvases !== 1) throw new Error(`cycle ${cycle}: expected one canvas at home`);
      if (home.receipts.length !== expected) throw new Error(`cycle ${cycle}: missing home receipt`);
      if (!activated(home.receipts.at(-1))) throw new Error(`cycle ${cycle}: home handoff did not activate in place`);
      if (home.active !== null) throw new Error(`cycle ${cycle}: saved game did not return home`);
      if (home.startupPending) throw new Error(`cycle ${cycle}: home retained a stale startup save`);

      await openTracker();
      const colonyMarker = await mark();
      await page.locator(`[data-colony-visit="${colonyId}"]`).click();
      await waitLoading();
      await waitColony();
      await waitIdle();
      const colony = await state();
      expected++;
      legs.push({ direction: "colony", cycle, active: colony.active, receipts: colony.receipts.length });
      if (colony.marker !== colonyMarker) throw new Error(`cycle ${cycle}: colony travel reloaded the document`);
      if (colony.canvases !== 1) throw new Error(`cycle ${cycle}: expected one canvas at colony`);
      if (colony.receipts.length !== expected) throw new Error(`cycle ${cycle}: missing colony receipt`);
      if (!activated(colony.receipts.at(-1))) throw new Error(`cycle ${cycle}: colony handoff did not activate in place`);
      if (colony.active !== colonyId) throw new Error(`cycle ${cycle}: saved game did not switch island`);
      if (colony.startupPending) throw new Error(`cycle ${cycle}: colony retained a stale startup save`);
    }

    await openTracker();
    const finalMarker = await mark();
    await page.getByRole("button", { name: "Return to the home island" }).click();
    await waitLoading();
    await waitHome();
    await waitIdle();
    const final = await state();
    expected++;
    if (final.marker !== finalMarker) throw new Error("final return home reloaded the document");
    if (final.receipts.length !== expected)
      throw new Error(`expected ${expected} receipts, got ${final.receipts.length}`);
    if (!activated(final.receipts.at(-1))) throw new Error("final home handoff did not activate in place");
    if (final.startupPending) throw new Error("final return retained a stale startup save");
    const savedCamera = await page.evaluate(async () => {
      const mod = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      const store = await mod.openLocalSaveStore();
      const current = await store.readSavedGame();
      const runtime = current?.runtime as { camera?: { centerX: number; centerZ: number } } | undefined;
      const root = window as unknown as { __settlement: {
        focusGround: (x: number, z: number, zoom: number) => void;
        saving: { flush: (reason: "manual") => Promise<boolean> };
      } };
      root.__settlement.focusGround((runtime?.camera?.centerX ?? 10) + 3,
        (runtime?.camera?.centerZ ?? 10) + 2, .85);
      if (!await root.__settlement.saving.flush("manual")) throw new Error("Post-handoff save failed");
      const saved = await store.readSavedGame();
      const savedRuntime = saved?.runtime as { camera?: unknown } | undefined;
      if (!savedRuntime?.camera) throw new Error("Post-handoff save has no camera");
      return savedRuntime.camera;
    });
    await page.reload();
    await waitHome();
    await waitIdle();
    const restoredCamera = await page.evaluate(() => {
      const root = window as unknown as { __islandBoot?: {
        restore: { restoredGame: { runtime?: { camera?: unknown } } };
      } };
      return root.__islandBoot?.restore.restoredGame.runtime?.camera;
    });
    if (JSON.stringify(restoredCamera) !== JSON.stringify(savedCamera))
      throw new Error("Refresh discarded the post-handoff camera save");
    if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
    const resourceSeries = final.receipts.map((receipt, leg) => ({
      end: receipt.samples.at(-1) ?? null,
      leg,
      start: receipt.samples[0] ?? null
    }));
    const report = {
      cycles, colonyId, errors, legs, quality,
      receipts: final.receipts,
      refreshPreservedSave: true,
      resourceSeries,
      state: { canvases: final.canvases, colonySaves: final.colonySaves }
    };
    console.log(JSON.stringify(report, null, 2));
    if (output) {
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await page.screenshot({ path: join(output, "home-after-handoff.png") });
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

void main();
