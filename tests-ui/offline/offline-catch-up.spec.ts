import { readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";
import { expectInsideViewport } from "../fixtures/ui";

interface SimulationState {
  actors: number;
  buildings: number;
  gameNow: number;
  resources: Record<string, number>;
  tick: number;
}

interface SettlementWindow extends Window {
  __settlement?: {
    simulation: {
      gameNow: () => number;
      resourceTotal: (ware: string) => number;
      snapshot: () => { actors: unknown[]; buildings: unknown[] };
      tickCount: () => number;
    };
  };
}

const HORIZON_SECONDS = Number(process.env.OFFLINE_ACCEPTANCE_HORIZON_SECONDS ?? 3_600);
if (!Number.isFinite(HORIZON_SECONDS) || HORIZON_SECONDS <= 0)
  throw new Error("OFFLINE_ACCEPTANCE_HORIZON_SECONDS must be a positive number");
const horizonLabel = (seconds: number) => {
  if (seconds === 3_600) return "one hour";
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  return `${seconds / 60} minutes`;
};
const horizonPrefix = (seconds: number) => {
  if (seconds === 3_600) return "visual-1h";
  if (seconds % 3_600 === 0) return `visual-${seconds / 3_600}h`;
  return `visual-${seconds / 60}m`;
};
const HORIZON_LABEL = horizonLabel(HORIZON_SECONDS);
const DEFAULT_PREFIX = horizonPrefix(HORIZON_SECONDS);
const ARTIFACT_PREFIX = process.env.OFFLINE_ACCEPTANCE_ARTIFACT_PREFIX ?? DEFAULT_PREFIX;
if (!/^[a-z0-9][a-z0-9-]*$/i.test(ARTIFACT_PREFIX))
  throw new Error("OFFLINE_ACCEPTANCE_ARTIFACT_PREFIX must contain only letters, digits and dashes");
const TEST_TIMEOUT_MS = Math.max(360_000, HORIZON_SECONDS * 400);
const LOAD_TIMEOUT_MS = Math.max(300_000, HORIZON_SECONDS * 400);
const WARES = ["grain", "logs", "planks", "stone", "timber", "wood"];
const FIXTURE_PATH = resolve(process.env.OFFLINE_ACCEPTANCE_FIXTURE ??
  "public/demo/continued-0.json");
const FIXTURE_LABEL = basename(FIXTURE_PATH);
// Read in Node; the page only sees the routed bytes, so owner saves outside public/ work unchanged.
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);
const MODE = "client default (native below 30 min, fast economy at/above 30 min, via the game-session worker)";

/**
 * Optional fixed evidence directory. The focused run sets this to the tracked resources folder so the
 * screenshots/state can be cited directly; a plain `npm run test:offline` keeps its artifacts in the
 * Playwright output only.
 */
const ARTIFACT_DIR = process.env.OFFLINE_ACCEPTANCE_ARTIFACTS
  ? resolve(process.env.OFFLINE_ACCEPTANCE_ARTIFACTS) : null;

const readState = (page: Page): Promise<SimulationState> =>
  page.evaluate((wares: string[]) => {
    const settlement = (window as SettlementWindow).__settlement;
    if (!settlement) throw new Error("The settlement did not load");
    const { simulation } = settlement, snapshot = simulation.snapshot();
    return {
      actors: snapshot.actors.length,
      buildings: snapshot.buildings.length,
      gameNow: simulation.gameNow(),
      resources: Object.fromEntries(wares.map(ware => [ware, simulation.resourceTotal(ware)])),
      tick: simulation.tickCount()
    };
  }, WARES);

const seedFixture = (page: Page, horizonSeconds: number) =>
  page.evaluate(async ({ horizon, storageTypeIds, wares }: {
    horizon: number; storageTypeIds: number[]; wares: string[];
  }) => {
    const modulePath = "/src/app/save-store/local-save-store.ts";
    const { openLocalSaveStore } = await import(/* @vite-ignore */ modulePath) as {
      openLocalSaveStore: () => Promise<{
        readStartupGame: () => Promise<string | null>;
        writeStartupGame: (json: string) => Promise<void>;
      }>;
    };
    const response = await fetch("/offline-acceptance-fixture.json");
    if (!response.ok) throw new Error(`Acceptance fixture unavailable (${response.status})`);
    const fixture = await response.json() as {
      savedAt: number;
      settlement: {
        actors: unknown[];
        buildings: { inventory?: Record<string, number>; typeId: number }[];
      };
    };
    fixture.savedAt = Date.now() - horizon * 1000;
    const resources = Object.fromEntries(wares.map(ware => [ware, fixture.settlement.buildings
      .reduce((sum, building) => sum + (storageTypeIds.includes(building.typeId)
        ? building.inventory?.[ware] ?? 0 : 0), 0)]));
    const store = await openLocalSaveStore();
    await store.writeStartupGame(JSON.stringify(fixture));
    const stored = await store.readStartupGame();
    if (!stored) throw new Error("The startup fixture was not persisted");
    return { actors: fixture.settlement.actors.length, buildings: fixture.settlement.buildings.length,
      resources, savedAt: fixture.savedAt, startupBytes: stored.length } satisfies {
      actors: number; buildings: number; resources: Record<string, number>; savedAt: number;
      startupBytes: number;
    };
  }, { horizon: horizonSeconds, storageTypeIds: [0, 29, 39], wares: WARES });

const waitForSettlement = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as SettlementWindow).__settlement), null,
    { timeout: LOAD_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: LOAD_TIMEOUT_MS });
  await expect(page.locator(".settlement-ui__bar")).toBeVisible();
};

/**
 * Seeds the developed save one hour in the past without booting the game first, then loads the
 * normal game URL. The normal startup path replays it in the game-session worker before staging.
 */
const openSeededGame = async (page: Page, extraQuery = "", waitForGame = true) => {
  const pageErrors: string[] = [];
  await page.addInitScript("window.__name = value => value;");
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.routeWebSocket("**/*", () => {});

  await page.route("**/offline-seed.html", route => route.fulfill({
    body: "<!doctype html><html><body>offline acceptance seed</body></html>", contentType: "text/html"
  }));
  await page.route("**/offline-acceptance-fixture.json", route => route.fulfill({
    body: FIXTURE_BYTES, contentType: "application/json"
  }));
  await page.goto(`${UI_TEST_URL}offline-seed.html`);
  const fixture = await seedFixture(page, HORIZON_SECONDS);

  const navigationStartedAt = Date.now();
  await page.goto(`${UI_TEST_URL}?quality=minimal&cache=0&skipLogin=1${extraQuery}`);
  if (waitForGame) await waitForSettlement(page);
  const settlementReadyAt = Date.now();
  return {
    fixture,
    pageErrors,
    timings: {
      navigationStartedAt,
      settlementReadyAt,
      timeToSettlementMs: settlementReadyAt - navigationStartedAt
    }
  };
};

const readPersistedSave = (page: Page) =>
  page.evaluate(async (wares: string[]) => {
    const modulePath = "/src/app/save-store/local-save-store.ts";
    const { openLocalSaveStore } = await import(/* @vite-ignore */ modulePath) as {
      openLocalSaveStore: () => Promise<{
        readSavedGame: () => Promise<{
          savedAt: number;
          settlement: { buildings: { inventory?: Record<string, number>; typeId: number }[] };
        } | null>;
      }>;
    };
    const save = await (await openLocalSaveStore()).readSavedGame();
    if (!save) return null;
    const storageTypeIds = [0, 29, 39];
    return {
      buildings: save.settlement.buildings.length,
      resources: Object.fromEntries(wares.map(ware => [ware, save.settlement.buildings
        .reduce((sum, building) => sum + (storageTypeIds.includes(building.typeId)
          ? building.inventory?.[ware] ?? 0 : 0), 0)])),
      savedAt: save.savedAt
    };
  }, WARES);

const expectCatchUpClock = async (page: Page, caughtUp: SimulationState) => {
  await page.waitForTimeout(2_000);
  const later = await readState(page);
  expect(later.tick).toBeGreaterThan(caughtUp.tick);
  expect(later.gameNow - caughtUp.gameNow).toBeGreaterThan(1_000);
  expect(later.gameNow - caughtUp.gameNow).toBeLessThan(6_000);
  expect(later.buildings).toBe(caughtUp.buildings);
  return later;
};

const publishArtifact = async (name: string, source: string | { body: string }) => {
  if (!ARTIFACT_DIR) return;
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const target = resolve(ARTIFACT_DIR, name);
  if (typeof source === "string") await copyFile(source, target);
  else await writeFile(target, source.body);
};

test(`the seeded fixture catches up ${HORIZON_LABEL}, renders and stays usable`, async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { fixture, pageErrors, timings } = await openSeededGame(page);

  const caughtUp = await readState(page);
  // The target is the seeded save time plus the requested horizon. Do not compare with Date.now():
  // a long replay legitimately takes minutes, so the wall clock has moved on by completion.
  const target = fixture.savedAt + HORIZON_SECONDS * 1000;
  expect(Math.abs(target - caughtUp.gameNow), "the game clock jumped to the catch-up target").toBeLessThan(300_000);
  expect(caughtUp.buildings).toBe(fixture.buildings);
  expect(caughtUp.actors).toBeGreaterThan(0);
  expect(caughtUp.tick).toBeGreaterThan(0);

  // Stable after the catch-up: the game clock keeps advancing and the built island does not reset.
  const later = await expectCatchUpClock(page, caughtUp);

  // Usable UI after the replay: open Build, see the panel, close it again.
  await page.getByRole("button", { exact: true, name: "Build" }).click();
  await expect(page.getByRole("heading", { exact: true, name: "Build your settlement" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { exact: true, name: "Build your settlement" })).toBeHidden();

  const usableAt = Date.now();
  const screenshot = testInfo.outputPath("offline-catch-up.png");
  await page.screenshot({ path: screenshot });

  const persisted = await readPersistedSave(page);
  expect(persisted, "the caught-up save is committed").not.toBeNull();
  expect(Math.abs(persisted!.savedAt - caughtUp.gameNow), "the committed save keeps the caught-up time")
    .toBeLessThan(300_000);
  expect(persisted!.buildings).toBe(caughtUp.buildings);

  const report = {
    artifactDirectory: ARTIFACT_DIR,
    fixture: { ...fixture, name: FIXTURE_LABEL, path: FIXTURE_PATH },
    horizonSeconds: HORIZON_SECONDS,
    mode: MODE,
    pageErrors,
    persisted,
    screenshot: ARTIFACT_DIR ? `${ARTIFACT_PREFIX}.png` : "offline-catch-up.png",
    stableState: later,
    stateAfterCatchUp: caughtUp,
    timings: { ...timings, timeToUsableUiMs: usableAt - timings.navigationStartedAt }
  };
  const reportPath = testInfo.outputPath("offline-catch-up.json"), reportBody = JSON.stringify(report, null, 2);
  await writeFile(reportPath, `${reportBody}\n`);
  await publishArtifact(`${ARTIFACT_PREFIX}.png`, screenshot);
  await publishArtifact(`${ARTIFACT_PREFIX}-state.json`, { body: `${reportBody}\n` });
  await testInfo.attach("offline-catch-up-state", { body: reportBody, contentType: "application/json" });
  await testInfo.attach("offline-catch-up.png", { contentType: "image/png", path: screenshot });
  expect(pageErrors).toEqual([]);
});

test("skipping the wait discards offline progress and commits only the last save", async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  // The acceptance-only query shortens D15's 60 s delay; the production delay is unchanged.
  const { fixture, pageErrors } = await openSeededGame(page, "&offlineSkipMs=800", false);

  const skip = page.getByRole("button", { name: "Skip waiting and discard offline progress" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  const clickedAt = Date.now();
  await skip.click();
  await waitForSettlement(page);

  // The notice must never present the discarded interval as away gains.
  const status = page.locator(".settlement-ui__status");
  await expect(status).toContainText("Offline production");
  await expect(status).toContainText("calendar deadlines advanced");

  const after = await readState(page);
  expect(Math.abs(after.gameNow - clickedAt), "the clock committed at the skip time").toBeLessThan(120_000);
  expect(Math.abs(after.actors - fixture.actors), "no offline population growth was applied").toBeLessThanOrEqual(5);
  expect(after.buildings).toBe(fixture.buildings);

  const persisted = await readPersistedSave(page);
  expect(persisted, "the discarded state is committed once").not.toBeNull();
  expect(Math.abs(persisted!.savedAt - clickedAt), "the committed save keeps the skip time").toBeLessThan(120_000);
  expect(persisted!.resources, "no offline production reached the committed save").toEqual(fixture.resources);

  // A reload must not replay the discarded interval: the fixture's population and stock stay put.
  // `skipLogin=1` is a tool run and deliberately ignores the saved game; `login=1` keeps the guest
  // save path (no backend answers the probe) and continues it.
  const beforeReload = Date.now();
  await page.goto(`${UI_TEST_URL}?quality=minimal&cache=0&login=1&offlineSkipMs=800`);
  await waitForSettlement(page);
  const reloaded = await readState(page);
  expect(Math.abs(reloaded.gameNow - beforeReload), "the reloaded clock starts at the skip time").toBeLessThan(120_000);
  expect(Math.abs(reloaded.actors - fixture.actors), "the skipped interval was not replayed").toBeLessThanOrEqual(5);
  for (const ware of WARES)
    expect(Math.abs(reloaded.resources[ware]! - fixture.resources[ware]!), `${ware} was not replayed`)
      .toBeLessThanOrEqual(5);

  expect(pageErrors).toEqual([]);
});

test.describe("mobile/low-end viewport", () => {
  // A 390x844 CSS viewport at DPR 1: phone layout and touch input without a flagship pixel budget.
  test.use({ deviceScaleFactor: 1, hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } });

  test(`the seeded fixture catches up ${HORIZON_LABEL} on a mobile/low-end viewport`, async ({ page }, testInfo) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const { fixture, pageErrors, timings } = await openSeededGame(page);

    const viewport = await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      width: window.innerWidth
    }));
    expect(viewport).toEqual({ devicePixelRatio: 1, height: 844, width: 390 });

    const caughtUp = await readState(page);
    const target = fixture.savedAt + HORIZON_SECONDS * 1000;
    expect(Math.abs(target - caughtUp.gameNow), "the game clock jumped to the catch-up target").toBeLessThan(300_000);
    expect(caughtUp.buildings).toBe(fixture.buildings);
    expect(caughtUp.actors).toBeGreaterThan(0);
    expect(caughtUp.tick).toBeGreaterThan(0);

    // Settlement HUD on the phone layout: player corner and bottom bar visible, inside the viewport,
    // no sideways page scroll. The resource summary is a separate desktop window, not the bar.
    const hud = page.locator(".settlement-ui__bar");
    await expect(hud).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Player" })).toBeVisible();
    await expectInsideViewport(page, hud);

    // Clock/settlement stability at the narrow viewport, same two-second window as the desktop case.
    const later = await expectCatchUpClock(page, caughtUp);

    // The Build panel must be usable and fit the phone viewport after the replay.
    await page.getByRole("button", { exact: true, name: "Build" }).click();
    const buildHeading = page.getByRole("heading", { exact: true, name: "Build your settlement" });
    await expect(buildHeading).toBeVisible();
    const buildPanel = page.locator(".settlement-ui__panel").filter({ has: buildHeading });
    await expectInsideViewport(page, buildPanel);
    await page.keyboard.press("Escape");
    await expect(buildHeading).toBeHidden();

    const usableAt = Date.now();
    const screenshot = testInfo.outputPath("offline-catch-up-mobile.png");
    await page.screenshot({ path: screenshot });

    const persisted = await readPersistedSave(page);
    expect(persisted, "the caught-up save is committed").not.toBeNull();
    expect(Math.abs(persisted!.savedAt - caughtUp.gameNow), "the committed save keeps the caught-up time")
      .toBeLessThan(300_000);
    expect(persisted!.buildings).toBe(caughtUp.buildings);

    const report = {
      artifactDirectory: ARTIFACT_DIR,
      device: { isMobile: true, viewport },
      fixture: { ...fixture, name: FIXTURE_LABEL, path: FIXTURE_PATH },
      horizonSeconds: HORIZON_SECONDS,
      mode: MODE,
      pageErrors,
      persisted,
      screenshot: ARTIFACT_DIR ? `${ARTIFACT_PREFIX}-mobile.png` : "offline-catch-up-mobile.png",
      stableState: later,
      stateAfterCatchUp: caughtUp,
      timings: { ...timings, timeToUsableUiMs: usableAt - timings.navigationStartedAt }
    };
    const reportPath = testInfo.outputPath("offline-catch-up-mobile.json");
    const reportBody = JSON.stringify(report, null, 2);
    await writeFile(reportPath, `${reportBody}\n`);
    await publishArtifact(`${ARTIFACT_PREFIX}-mobile.png`, screenshot);
    await publishArtifact(`${ARTIFACT_PREFIX}-mobile-state.json`, { body: `${reportBody}\n` });
    await testInfo.attach("offline-catch-up-mobile-state", { body: reportBody, contentType: "application/json" });
    await testInfo.attach("offline-catch-up-mobile.png", { contentType: "image/png", path: screenshot });
    expect(pageErrors).toEqual([]);
  });
});
