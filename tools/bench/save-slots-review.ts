import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";

import {
  cloneGameSettings, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../../island-of-settlers-shared/src/game-settings/game-settings";
import { launchBrowser, startDevServer } from "./browser";

/**
 * SAVE-SLOTS review in the real page: (1) a table-level slot round trip in the browser's IndexedDB (every game
 * table, a filed campaign run, map bases, story progress; row-level equality both ways), plus the longest frame
 * while a large copy runs in the game-session worker versus on the page; (2) title page captures with slots
 * (Load list, load/delete confirmations, New game question); (3) the in-game flow with automatic saving off:
 * Settings > Game, Save window, overwrite question, Load window and question, a real Load (reload into the game
 * without the title page), and the Exit choice. Prints PASS/FAIL lines.
 * Run: npx tsx --env-file=<file with OUT=<folder>, optionally LANG=hu, PORT=5291> tools/bench/save-slots-review.ts
 */
const DESKTOP = { height: 800, width: 1280 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 900;
const ISLAND_TIMEOUT_MS = 180_000;
const out = process.env.OUT ?? "/tmp/save-slots-review";
const language = process.env.LANG_CODE ?? "hu";
const port = Number(process.env.PORT ?? 5291);
const failures: string[] = [];

const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}-${language}.png`) });
const settle = (page: Page) => page.waitForTimeout(SETTLE_MS);

/** Offline with a home, automatic saving off, slots on (the D3 combination). */
const manualHome = (): GameSettings => {
  const settings = cloneGameSettings(GAME_SETTINGS_PRESETS.offlineSettlement);
  settings.saving = { autosave: false, slots: true };
  return settings;
};

/** A blank page of the dev server (module imports work) with the language stored. */
const openFixture = async (page: Page, url: string) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/slots-fixture.html", route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.goto(`${url}slots-fixture.html`);
  await page.evaluate(code => localStorage.setItem("island-of-settlers.language", code), language);
};

/**
 * Writes a synthetic working slot straight into the tables (every game table, map bases, story progress, a pending
 * startup value), copies it into a save slot in the worker, changes the working slot, loads the slot back and
 * compares every record. Returns the facts the checks read.
 */
const roundTrip = (page: Page) => page.evaluate(async () => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const [{ openGameDatabase }, { copyGameSlotInWorker }] = await Promise.all([
    load("/src/app/settlement/game-database.ts"), load("/src/app/settlement/game-session-worker.ts")]);
  await openGameDatabase();
  const database: IDBDatabase = await new Promise((resolve, reject) => {
    const open = indexedDB.open("island-settlers-db");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const ranges = ["adventures", "islands", "colonies", "evacuations", "tradeHistory", "tradeOffers", "campaignRuns",
    "mapBases"];
  const working = "offline.home", slot = "offline.home.3";
  const bytes = (size: number, seed: number) => Uint8Array.from({ length: size }, (_, index) => (index * seed) % 251);
  const rows = (slotId: string) => ({
    adventures: [{ expeditionId: 9, slotId, theme: "desert" }],
    campaignRuns: [{ id: "campaign-first-1", run: { campaignId: "isles", mapId: "first", status: "running" },
      save: { map: bytes(2048, 3) }, slotId }, { id: "campaign-old-1", run: { status: "won" }, save: {}, slotId }],
    colonies: [{ expeditionId: 4, slotId, name: "Colony" }],
    evacuations: [{ expeditionId: 4, slotId, wares: { planks: 3 } }],
    islands: [{ id: "home", save: { map: bytes(4096, 7) }, signature: "s1", slotId },
      { id: "colony:4", save: { map: bytes(1024, 5) }, signature: "s2", slotId }],
    mapBases: [{ hash: "h1", key: "home:abc", map: bytes(8192, 11), slotId }],
    tradeHistory: [{ id: 1, islandId: "home", slotId }],
    tradeOffers: [{ id: 2, islandId: "home", kind: "merchant", slotId }]
  });
  const run = async (mode: IDBTransactionMode, body: (transaction: IDBTransaction) => void) => {
    const transaction = database.transaction([...ranges, "players", "sessions", "boot"], mode);
    body(transaction);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  };
  const range = (slotId: string) => IDBKeyRange.bound([slotId], [slotId, []]);
  const readAll = async (slotId: string) => {
    const found: Record<string, unknown> = {};
    await run("readonly", transaction => {
      for (const table of ranges) {
        const request = transaction.objectStore(table).getAll(range(slotId));
        request.onsuccess = () => { found[table] = request.result; };
      }
      const player = transaction.objectStore("players").get(slotId);
      player.onsuccess = () => { found.player = player.result; };
      const session = transaction.objectStore("sessions").get(slotId);
      session.onsuccess = () => { found.session = session.result; };
      for (const key of ["story-progress", "startup", "slot-meta"]) {
        const value = transaction.objectStore("boot").get(`${slotId}/${key}`);
        value.onsuccess = () => { found[key] = value.result; };
      }
    });
    return found;
  };
  /** Records with the slot id blanked: two slots with equal content compare equal. */
  const normalised = (records: Record<string, unknown>) => JSON.stringify(records, (key, value) => {
    if (key === "slotId" || (key === "id" && typeof value === "string" && value.startsWith("offline."))) return "*";
    if (value instanceof Uint8Array) return Array.from(value);
    return value;
  });
  await run("readwrite", transaction => {
    for (const [table, list] of Object.entries(rows(working)))
      for (const row of list) transaction.objectStore(table).put(row);
    transaction.objectStore("players").put({ id: working, progress: { experience: 1200 } });
    transaction.objectStore("sessions").put({ active: "campaign", campaign: { attempt: 1, campaignId: "isles",
      mapId: "first" }, id: working, origin: "offline", savedAt: 1 });
    transaction.objectStore("boot").put(JSON.stringify({ experience: 1200 }), `${working}/story-progress`);
    transaction.objectStore("boot").put("{}", `${working}/startup`);
  });
  const original = await readAll(working);
  await copyGameSlotInWorker({ from: working, meta: { label: "Round trip", savedAt: 2 }, to: slot });
  const copied = await readAll(slot);
  const meta = JSON.parse(String(copied["slot-meta"] ?? "null"));
  // The working slot moves on: a row goes, another changes, the startup value is gone.
  await run("readwrite", transaction => {
    transaction.objectStore("islands").delete([working, "colony:4"]);
    transaction.objectStore("campaignRuns").put({ id: "campaign-first-1", run: { status: "lost" }, save: {},
      slotId: working });
  });
  await copyGameSlotInWorker({ from: slot, meta: null, to: working });
  const restored = await readAll(working);
  const strip = (records: Record<string, unknown>) => ({ ...records, "slot-meta": undefined, startup: undefined });
  return {
    copiedEqual: normalised(strip(copied)) === normalised(strip(original)),
    copiedStartup: copied.startup ?? null,
    meta,
    restoredEqual: normalised(strip(restored)) === normalised(strip(original)),
    restoredMeta: restored["slot-meta"] ?? null,
    restoredStartup: restored.startup ?? null,
    tables: Object.fromEntries(ranges.map(table => [table, (original[table] as unknown[]).length]))
  };
});

/** The longest frame gap while a large slot (`megabytes` of island rows) is copied in the worker or on the page. */
const copyFrameCost = (page: Page, megabytes: number) => page.evaluate(async size => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const [{ openGameDatabase }, { copyGameSlotInWorker }, { copyGameSlot }] = await Promise.all([
    load("/src/app/settlement/game-database.ts"), load("/src/app/settlement/game-session-worker.ts"),
    load("/src/app/save-slots/slot-copy.ts")]);
  const database = await openGameDatabase();
  const islands = 40, perIsland = Math.round(size * 1_000_000 / islands);
  const save = (index: number) => ({ map: Array.from({ length: perIsland / 8 }, (_, cell) => cell * index) });
  const raw: IDBDatabase = await new Promise(resolve => {
    const open = indexedDB.open("island-settlers-db");
    open.onsuccess = () => resolve(open.result);
  });
  await new Promise<void>(resolve => {
    const transaction = raw.transaction(["islands", "sessions"], "readwrite");
    for (let index = 0; index < islands; index++)
      transaction.objectStore("islands").put({ id: `island-${index}`, save: save(index), slotId: "offline.big" });
    transaction.objectStore("sessions").put({ active: null, id: "offline.big", savedAt: 1 });
    transaction.oncomplete = () => resolve();
  });
  const longestFrame = async (copy: () => Promise<void>) => {
    let last = performance.now(), longest = 0, running = true;
    const tick = () => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const started = performance.now();
    await copy();
    const wall = performance.now() - started;
    running = false;
    return { longestFrameMs: Math.round(longest), wallMs: Math.round(wall) };
  };
  const worker = await longestFrame(() => copyGameSlotInWorker({ from: "offline.big", meta: null, to: "offline.big.1" }));
  const main = await longestFrame(() => copyGameSlot(database, { from: "offline.big", meta: null, to: "offline.big.2" }));
  return { main, worker };
}, megabytes);

const reviewStorage = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: DESKTOP });
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await openFixture(page, url);
  const facts = await roundTrip(page);
  console.log(`round trip: ${JSON.stringify(facts)}`);
  check("slot copy equals the working slot (all tables, run rows, map bases, story progress)", facts.copiedEqual);
  check("load restores the working slot record by record", facts.restoredEqual);
  check("a pending startup value is never copied and a load clears it",
    facts.copiedStartup === null && facts.restoredStartup === null);
  check("slot meta written in the copy, none on the working slot",
    facts.meta?.shows?.kind === "campaign" && facts.meta?.level > 1 && facts.restoredMeta === null);
  for (const megabytes of [8, 32]) {
    const cost = await copyFrameCost(page, megabytes);
    console.log(`copy ${megabytes} MB: worker ${JSON.stringify(cost.worker)} page ${JSON.stringify(cost.main)}`);
  }
  await page.close();
};

/** Seeds two save slots of the story working slot (synthetic rows: the list and questions only). */
const seedStorySlots = (page: Page) => page.evaluate(async () => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const [{ openGameDatabase }, { copyGameSlotInWorker }] = await Promise.all([
    load("/src/app/settlement/game-database.ts"), load("/src/app/settlement/game-session-worker.ts")]);
  const database = await openGameDatabase();
  await database.writeValue("offline.story/story-progress", JSON.stringify({ experience: 0 }));
  const raw: IDBDatabase = await new Promise(resolve => {
    const open = indexedDB.open("island-settlers-db");
    open.onsuccess = () => resolve(open.result);
  });
  const session = (active: unknown, campaign?: unknown) => new Promise<void>(resolve => {
    const transaction = raw.transaction(["sessions", "players"], "readwrite");
    transaction.objectStore("sessions").put({ active, campaign, id: "offline.story", savedAt: 1 });
    transaction.objectStore("players").put({ id: "offline.story", progress: { experience: 4200 } });
    transaction.oncomplete = () => resolve();
  });
  await session("campaign", { attempt: 1, campaignId: "isles", mapId: "bay" });
  await copyGameSlotInWorker({ from: "offline.story", meta: { place: "The Quiet Bay", savedAt: Date.now() - 86_400_000 },
    to: "offline.story.1" });
  await copyGameSlotInWorker({ from: "offline.story", meta: { label: "Before the fortress", place: "The Quiet Bay",
    savedAt: Date.now() }, to: "offline.story.4" });
});

const reviewTitle = async (browser: Browser, url: string) => {
  for (const [size, viewport] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const context = await browser.newContext({ viewport });
    await context.route("**/game-settings.json", route => route.fulfill({ json: GAME_SETTINGS_PRESETS.story }));
    const page = await context.newPage();
    page.on("pageerror", error => console.error("[pageerror]", error.message));
    await openFixture(page, url);
    await seedStorySlots(page);
    await page.goto(`${url}?login=1`);
    const panel = page.locator(".title-page__panel");
    await panel.waitFor({ state: "visible", timeout: 60_000 });
    await settle(page);
    const ids = await page.locator("[data-title-entry]").evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("data-title-entry")));
    check(`title entries with slots (${size})`, ids.join() === "continue,campaigns,load,newGame,multiplayer,settings",
      ids.join());
    await shot(page, `title-menu-${size}`);
    await page.locator('[data-title-entry="load"]').click();
    await page.locator("[data-save-slot]").first().waitFor();
    await settle(page);
    check(`title Load lists only used slots (${size})`, await page.locator("[data-save-slot]").count() === 2);
    const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no horizontal scroll (${size})`, width <= 0, String(width));
    await shot(page, `title-load-${size}`);
    if (size === "desktop") {
      await page.locator('[data-save-slot="4"] [data-save-slot-action="load"]').click();
      await settle(page);
      await shot(page, "title-load-question-desktop");
      await page.locator(".save-slots__confirm-actions button").last().click();
      await page.locator('[data-save-slot="1"] [data-save-slot-action="delete"]').click();
      await settle(page);
      await shot(page, "title-delete-question-desktop");
      await page.locator("[data-save-slot-confirm]").click();
      await page.waitForFunction(() => document.querySelectorAll("[data-save-slot]").length === 1);
      check("title delete removes the slot", true);
      await page.locator(".title-page__back").click();
      await page.locator('[data-title-entry="newGame"]').click();
      await settle(page);
      await shot(page, "title-new-game-question-desktop");
    }
    await context.close();
  }
};

/** Menu > Settings > Misc (hu or en names). */
const openGameSection = async (page: Page) => {
  const names = language === "hu" ? ["Menü", "Beállítások", "Egyéb"] : ["Menu", "Settings", "Misc"];
  await page.getByRole("button", { exact: true, name: names[0] }).click();
  await page.getByRole("button", { exact: true, name: names[1] }).click();
  await page.locator(".settings-panel").getByRole("tab", { exact: true, name: names[2] }).click();
  const save = page.locator("[data-game-save]");
  await save.scrollIntoViewIfNeeded();
  return save;
};

const saveToSlot = async (page: Page, number: number, confirm: boolean) => {
  await page.locator(`[data-save-slot="${number}"] [data-save-slot-action="save"]`).click();
  if (confirm) {
    await settle(page);
    await shot(page, "game-overwrite-question-desktop");
    await page.locator("[data-save-slot-confirm]").click();
  }
  await page.locator(".save-slots__status").filter({ hasText: /\S/ }).waitFor({ timeout: 60_000 });
};

const reviewInGame = async (browser: Browser, url: string) => {
  const context = await browser.newContext({ viewport: DESKTOP });
  await context.route("**/game-settings.json", route => route.fulfill({ json: manualHome() }));
  const page = await context.newPage();
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await openFixture(page, url);
  await page.goto(`${url}?login=1&size=64&cache=0`);
  await page.locator('[data-title-entry="newGame"]').click();
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: ISLAND_TIMEOUT_MS });
  const save = await openGameSection(page);
  await settle(page);
  await shot(page, "game-section-desktop");
  await save.click();
  await page.locator(".save-slots-window [data-save-slot]").first().waitFor();
  await page.locator(".save-slots__label").fill("Első mentés");
  await settle(page);
  await shot(page, "game-save-window-desktop");
  await saveToSlot(page, 1, false);
  const saved = await page.locator(".save-slots__status").innerText();
  check("in-game save to slot 1", !/not|could/i.test(saved), saved);
  await settle(page);
  await shot(page, "game-saved-desktop");
  await saveToSlot(page, 1, true);
  await page.locator("[data-game-load]").click();
  await page.locator('.save-slots-window [data-save-slot="1"] [data-save-slot-action="load"]').waitFor();
  await settle(page);
  await shot(page, "game-load-window-desktop");
  await page.locator('.save-slots-window [data-save-slot="1"] [data-save-slot-action="load"]').click();
  await settle(page);
  await shot(page, "game-load-question-desktop");
  const reloaded = page.waitForEvent("load", { timeout: 60_000 });
  await page.locator("[data-save-slot-confirm]").click();
  await reloaded;
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: ISLAND_TIMEOUT_MS });
  check("load reloads into the game without the title page", await page.locator(".title-page").count() === 0);
  check("the continue parameter is consumed", !new URL(page.url()).searchParams.has("continue"), page.url());
  await openGameSection(page);
  await page.locator("[data-exit-game]").click();
  await settle(page);
  await shot(page, "game-exit-choice-desktop");
  await context.close();
};

mkdirSync(out, { recursive: true });
const { server, url } = await startDevServer({ cacheDir: process.env.CACHE_DIR, port });
const browser = await launchBrowser();
try {
  await reviewStorage(browser, url);
  await reviewTitle(browser, url);
  await reviewInGame(browser, url);
} finally {
  await browser.close();
  await server.close();
}
console.log(failures.length ? `FAILED: ${failures.join("; ")}` : "ALL PASS");
if (failures.length) process.exitCode = 1;
