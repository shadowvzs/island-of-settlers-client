import { levelForExperience } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import type { PlayerProgress } from "../../src/shared/progression/player-progress";
import {
  activeHomeQuestId, finishedHomeQuestIds, skippedHomeQuestIds
} from "../../src/shared/quests/home-quests";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const sourcePath = process.env.SOURCE;
assert(sourcePath, "SOURCE must identify an actual earned natural-progression GameSave");
const sourceText = readFileSync(sourcePath, "utf8"), source = JSON.parse(sourceText) as GameSaveV1;
assert.equal(source.format, "island-settlers-game");
assert.equal(source.version, 3);
assert(source.player && Number.isFinite(source.savedAt));
const run = process.env.RUN ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "verification-completion-2026-11-05", "progression-native", run);
assert(!existsSync(resolve(output, "report.json")), "Use a new RUN to preserve previous evidence");
mkdirSync(output, { recursive: true });
const progressIdentity = (player: PlayerProgress) => ({
  active: player.questBook ? activeHomeQuestId(player.questBook) : undefined,
  completed: finishedHomeQuestIds(player.questBook),
  experience: player.experience,
  level: levelForExperience(player.experience),
  skipped: skippedHomeQuestIds(player.questBook),
  talents: player.talents
});
const expected = progressIdentity(source.player);
const rows: unknown[] = [], errors: string[] = [];
const saveReport = (status: string, failure?: string) => writeFileSync(resolve(output, "report.json"),
  JSON.stringify({ status, failure, source: sourcePath,
    sourceSha256: createHash("sha256").update(sourceText).digest("hex"), expected, errors, rows,
    scope: "Unmodified actually earned source; normal guest startup, actual Questbook/build picker and " +
      "manual save/reload. Browser Date is fixed at the source's recorded game time; simulation is held " +
      "after restoration for exact UI/save comparison. No direct XP, debug unlock, grant or claim is invoked. " +
      "This witnesses the source's earned range only, not a natural level-30 journey." }, null, 2));
const { server, url } = await startDevServer({
  env: { VITE_API_URL: "", VITE_IDENTITY_URL: "" }, unlockAll: false
});
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;

const readState = (page: Page) => page.evaluate(() => {
  const settlement = (window as any).__settlement;
  const player = settlement.playerSession.progress();
  return { player, level: settlement.playerSession.level(), buildings: settlement.simulation.buildings()
    .map((building: any) => ({ uid: building.uid, typeId: building.typeId, x: building.x, z: building.z })) };
});

const captureQuestbook = async (page: Page, quality: string) => {
  await page.getByRole("button", { name: /^Quests(?::|$)/ }).click();
  const book = page.getByRole("dialog", { exact: true, name: "Quests" });
  await book.waitFor({ state: "visible" });
  if (expected.active) {
    await book.locator(`[data-quest-id="${expected.active}"]`).waitFor({ state: "visible" });
    await book.locator(".quest-window__chapter").waitFor({ state: "visible" });
  }
  await page.screenshot({ path: resolve(output, `${quality}-earned-questbook.png`) });
  const text = await book.innerText();
  await page.keyboard.press("Escape");
  return text;
};

const captureBuildMenu = async (page: Page, quality: string) => {
  await page.getByRole("button", { exact: true, name: "Build" }).click();
  await page.getByRole("tablist", { exact: true, name: "Building categories" }).waitFor();
  const menu = await page.locator("[data-building]").evaluateAll(async nodes => {
    const { buildingUnlockLevel } = await import(
      /* @vite-ignore */ String("/src/shared/progression/building-unlocks.ts"));
    const { BUILDING_MENU } = await import(
      /* @vite-ignore */ String("/src/render-common/buildings/building-menu.ts"));
    const cards = nodes.map(node => ({ id: Number((node as HTMLElement).dataset.building),
      locked: node.getAttribute("aria-disabled") === "true",
      required: buildingUnlockLevel(Number((node as HTMLElement).dataset.building)),
      tab: node.closest("[role=tabpanel]")!.getAttribute("aria-labelledby")! }));
    return { cards, expectedIds: BUILDING_MENU.flatMap((group: any) =>
      group.buildings.map((building: any) => building.id)).filter((id: number) => id !== 0) };
  });
  const { cards } = menu;
  assert(cards.length >= 50, "Actual complete building picker is mounted");
  assert.deepEqual(cards.map(card => card.id).sort((a, b) => a - b),
    menu.expectedIds.sort((a: number, b: number) => a - b), "Every canonical picker entry is present exactly once");
  assert(cards.every(card => card.locked === (card.required > expected.level)), "Every card obeys earned level");
  const unlocked = cards.filter(card => !card.locked).sort((a, b) => b.required - a.required)[0]!;
  const locked = cards.filter(card => card.locked).sort((a, b) => a.required - b.required)[0];
  assert(unlocked);
  await page.locator(`[id="${unlocked.tab}"]`).click();
  await page.screenshot({ path: resolve(output, `${quality}-earned-building-unlock.png`) });
  let lockedNotice: string | undefined;
  if (locked) {
    await page.locator(`[id="${locked.tab}"]`).click();
    // The card intentionally retains an explanatory click handler while marked aria-disabled.
    await page.locator(`[data-building="${locked.id}"]`).click({ force: true });
    lockedNotice = await page.locator(".settlement-ui__selection-detail").innerText();
    assert(lockedNotice.includes(String(locked.required)), "Locked card reports its actual requirement");
    assert.equal(await page.evaluate(() => (window as any).__settlement.isInteracting()), false);
    await page.screenshot({ path: resolve(output, `${quality}-next-level-locked.png`) });
  }
  await page.keyboard.press("Escape");
  return { cards, locked, lockedNotice, unlocked };
};

try {
  browser = await launchBrowser();
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=value=>value;");
    await page.clock.setFixedTime(source.savedAt);
    await page.route("**/natural-source.html", route => route.fulfill({
      body: "<body>Loading the unmodified earned source</body>", contentType: "text/html"
    }));
    await page.goto(`${url}natural-source.html`);
    await page.evaluate(async value => {
      const { openLocalSaveStore } = await import(
        /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      await (await openLocalSaveStore()).writeStartupGame(value);
    }, sourceText);
    await page.route("**/src/app/island-runtime.ts", async route => {
      const response = await route.fetch(), body = await response.text();
      const marker = "renderLoop = startRenderLoop({";
      assert(body.includes(marker), "Current owned render-loop witness marker matches");
      await route.fulfill({ response, body: body.replace(marker,
        "window.__naturalProgressionWorld=world;" +
        "if(settlement)settlement.simulation.update=()=>{};" + marker) });
    });
    const visit = async () => {
      await page.goto(`${url}?quality=${quality}&login=1&time=day&cache=0`);
      await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 240000 });
      await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240000 });
      await page.locator(".player-hud__portrait").waitFor({ state: "visible" });
    };
    await visit();
    const loaded = await readState(page);
    assert.deepEqual(progressIdentity(loaded.player), expected);
    assert.equal(loaded.level, expected.level);
    assert.deepEqual(loaded.buildings, source.settlement.buildings.map(building => ({
      uid: building.uid, typeId: building.typeId, x: building.x, z: building.z
    })));
    const world = await page.evaluate(async saved => {
      const { readGameSave } = await import(/* @vite-ignore */ String("/src/shared/settlement/game-save.ts"));
      const baseline = (await readGameSave(saved)).map.world;
      const signature = async (world: any) => ({ seed: world.seed, cellsX: world.cellsX, cellsZ: world.cellsZ,
        props: world.props.count, heights: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
          world.heights.buffer.slice(world.heights.byteOffset, world.heights.byteOffset + world.heights.byteLength))))
          .map(byte => byte.toString(16).padStart(2, "0")).join("") });
      return { actual: await signature((window as any).__naturalProgressionWorld), expected: await signature(baseline) };
    }, source);
    assert.deepEqual(world.actual, world.expected, "Actual saved world, not regenerated seed-only scenery");
    await page.screenshot({ path: resolve(output, `${quality}-earned-world.png`) });
    const questbook = await captureQuestbook(page, quality);
    const build = await captureBuildMenu(page, quality);
    const saved = await page.evaluate(async () => {
      const settlement = (window as any).__settlement;
      if (!await settlement.saving.flush("manual")) throw new Error("Normal manual save did not commit");
      const { openLocalSaveStore } = await import(
        /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      const store = await openLocalSaveStore();
      return { save: await store.readSavedGame(), startupPending: await store.readStartupGame() !== null };
    });
    assert(saved.save?.player);
    assert.deepEqual(progressIdentity(saved.save.player), expected);
    assert.equal(saved.startupPending, false, "Normal startup payload was consumed");
    writeFileSync(resolve(output, `${quality}-normal-manual-save.json`), JSON.stringify(saved.save));
    await visit();
    const reloaded = await readState(page);
    assert.deepEqual(progressIdentity(reloaded.player), expected);
    assert.deepEqual(reloaded.buildings, loaded.buildings);
    await page.screenshot({ path: resolve(output, `${quality}-normal-reload.png`) });
    rows.push({ quality, world, loaded, questbook, build, savedAt: saved.save.savedAt, reloaded });
    saveReport("running");
    await page.close();
    console.log(`Natural native ${quality}: earned level${expected.level}, XP${expected.experience}, ` +
      `${expected.completed.length} retained tutorial claims; normal save/reload passed`);
  }
  assert.deepEqual(errors, []);
  saveReport("passed");
} catch (error) {
  saveReport("failed", String(error));
  throw error;
} finally { await browser?.close(); await server.close(); }
