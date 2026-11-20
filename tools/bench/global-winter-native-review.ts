import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { createIdentityClient } from "../../src/app/account/identity-client";
import { createAppearanceApi } from "../../src/app/settings/seasonal-appearance/api";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const minimalOnly = process.argv.includes("--minimal-only");
const uiOnly = process.argv.includes("--ui-only");
const waterOnly = process.argv.includes("--water-only");
let outputName = "native";
if (minimalOnly) outputName = "native-minimal-final";
if (uiOnly) outputName = "native-ui-final";
if (waterOnly) outputName = "native-water-final";
const output = resourcesPath("project-reviews", "global-winter-2026-11-02", outputName);
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:5293";
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack(origin);
const { server, url } = await startDevServer({ env: { VITE_API_URL: stack.apiUrl,
  VITE_IDENTITY_URL: stack.identityUrl }, host: "127.0.0.1", port: 5293 });
const browser = await launchBrowser();
const suffix = randomBytes(5).toString("hex");
const credentials = { displayName: `Admin${suffix}`, email: `admin-${suffix}@example.test`,
  nation: "roman" as const, password: randomBytes(24).toString("base64url") };
const rows: any[] = [], errors: string[] = [], missing: string[] = [], consoleErrors: string[] = [];
let status = "running", failure: string | undefined;
const save = () => writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, failure, rows, errors, missing, uiOnly, waterOnly,
  waterPaletteNormalization: "Shader operation hashes normalize only the three compile-time water colour constants.",
  consoleErrors, summerPixelTolerance: { maximumByteDifference: 1, meanAbsoluteByteDifference: .001 },
  scope: "Real game on/off/ignore/restore through authenticated admin and ordinary Appearance controls. " +
    "Render actor/felling/growth frames pinned; shader/sampler and same-camera draw budgets compared. " +
    "One legal editor oak is placed before the baseline and normalized through a real handoff. " +
    "Only the disabled optional backend verification poll is fulfilled as notverified. " +
    "GPU timings are diagnostic measurements, not a zero-cost guarantee." }, null, 2));

const instrument = async (page: Page) => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() === 404) missing.push(response.url()); });
  page.on("console", message => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text());
    if (/shader|WebGL|THREE.*Error/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  // This disposable stack disables replay verification; its unrelated status poll has no registered route.
  await page.route("**/v1/saves/*/verification", route => route.fulfill({ json: {
    flag: null, flaggedAt: null, randomTrailRequest: null, verifiedRevision: null
  } }));
  await page.route("**/create-three-renderer.ts*", async route => {
    const response = await route.fetch();
    const source = patchAtmosphereLiveCost(await response.text()).replace("atmosphereDebug.camera = camera;", `
      atmosphereDebug.camera = camera;
      if(atmosphereDebug.frozen){uniformValues.uWindPhase.fill(0);uniformValues.uCloudDrift.fill(0);}
    `).replace("atmosphereDebug.api = result;", `
      atmosphereDebug.world=world;atmosphereDebug.vegetation=vegetation;atmosphereDebug.visualWinter=visualWinter;
      atmosphereDebug.terrain=terrain;atmosphereDebug.scene=scene;
      atmosphereDebug.identity=window.__winterRendererSequence=(window.__winterRendererSequence??0)+1;
      atmosphereDebug.api=result;`);
    await route.fulfill({ response, body: source });
  });
  await page.route("**/game-boot.ts*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const anchor = "const applyDetailLive =";
    assert(source.includes(anchor), "Diagnostic refresh hook anchor changed");
    await route.fulfill({ response, body: source.replace(anchor,
      `window.__winterRefresh = () => refreshGraphics("graphics-appearance", () => {}, () => {});\n${anchor}`) });
  });
  await page.route("**/exploration-weather-adapter.ts*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: patchAtmosphereWeatherClock(await response.text()) });
  });
};

const enterGame = async (page: Page) => {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__islandReady === true)) return;
    const email = page.getByRole("textbox", { name: /^Email/ });
    if (await email.isVisible()) {
      await email.fill(credentials.email);
      await page.getByLabel(/^Password/).fill(credentials.password);
      await page.getByRole("button", { exact: true, name: "Sign in" }).click();
    }
    const slot = page.getByRole("button", { name: /^Slot 1:/ });
    if (await slot.isVisible()) await slot.click();
    const takeover = page.getByRole("button", { exact: true, name: "Take over here" });
    if (await takeover.isVisible()) await takeover.click();
    await page.waitForTimeout(250);
  }
  throw new Error(`Game startup timed out: ${(await page.locator("body").innerText()).slice(0, 1800)}`);
};

const openAppearance = async (page: Page, admin: boolean) => {
  if (admin) {
    await page.getByRole("button", { exact: true, name: "Development tools" }).click();
    await page.locator(".development-menu").getByRole("tab", { exact: true, name: "Appearance" }).click();
    return page.locator(".development-menu").getByRole("button", { exact: true, name: "Global winter" });
  }
  await page.getByRole("button", { exact: true, name: "Menu" }).click();
  await page.getByRole("button", { exact: true, name: "Settings" }).click();
  const panel = page.locator(".settings-panel:not([hidden])").filter({ has: page.getByRole("tab", { name: "Graphics" }) });
  await panel.getByRole("tab", { exact: true, name: "Appearance" }).click();
  return panel.getByRole("button", { exact: true, name: "Ignore global winter" });
};

const waitForSeason = async (page: Page, expected: boolean, previous: number) => {
  await page.waitForFunction(({ expected, previous }) => {
    const current = (window as any).__atmosphereLiveDebug;
    return window.__islandReady === true && current?.visualWinter === expected && current.identity !== previous;
  }, { expected, previous }, { timeout: 180_000 });
};

const capture = async (page: Page, quality: string, state: string, timed: boolean) => {
  const prepared = await page.evaluate(async waterOnly => {
    const helpers = await import(/* @vite-ignore */ String("/tools/bench/global-winter-native-frame.ts"));
    const frame = await helpers.prepareWinterFrame();
    const waterSubjects = waterOnly ? helpers.prepareWinterWaterViews() : undefined;
    return { ...frame, waterSubjects, hashes: await helpers.hashWinterWorld() };
  }, waterOnly);
  const views: any[] = [];
  for (const view of ["normal", "close"] as const) {
    const detail = await page.evaluate(async ({ timed, view }) => {
      const helpers = await import(/* @vite-ignore */ String("/tools/bench/global-winter-native-frame.ts"));
      return helpers.reviewWinterView(view, timed);
    }, { timed, view });
    views.push(detail);
    await page.screenshot({ path: resolve(output, `${quality}-${state}-${view}.png`) });
  }
  const row = { quality, state, ...prepared, views };
  rows.push(row);
  save();
  return row;
};

const programBudget = (view: any) => view.programs.map((program: any) => ({
  linked: program.linked, operations: program.operationHash, samplers: program.samplers
})).sort((a: any, b: any) => a.operations.localeCompare(b.operations));

try {
  const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  const registered = await identity.register(credentials);
  assert(registered.ok && registered.account.role === "admin");
  const adminApi = createAppearanceApi({ apiUrl: stack.apiUrl, getAccessToken: identity.accessToken });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await instrument(page);
  if (uiOnly) {
    await page.goto(`${url}admin.html?quality=minimal&size=128&seed=123&cache=0&login=1&time=day&reveal=1`);
    await enterGame(page);
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
    const global = await openAppearance(page, true);
    assert.equal(await global.getAttribute("aria-pressed"), "false");
    const box = await global.boundingBox();
    assert(box && box.width === 48 && box.height === 48);
    assert.equal(await global.isDisabled(), false);
    await page.screenshot({ path: resolve(output, "admin-global-control.png") });
    const ignore = await openAppearance(page, false);
    assert.equal(await ignore.locator("span").count(), 0);
    await page.screenshot({ path: resolve(output, "admin-player-appearance.png") });
  }
  let qualities = ["high", "minimal"];
  if (minimalOnly) qualities = ["minimal"];
  if (uiOnly) qualities = [];
  for (const quality of qualities) {
    const terrain = waterOnly ? "seed=1234&rivers=2&forest=2&mountains=2" : "seed=123";
    await page.goto(`${url}admin.html?quality=${quality}&size=128&${terrain}&cache=0&login=1&time=day&reveal=1`);
    await enterGame(page);
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
    const fixture = await page.evaluate(async () => {
      const helpers = await import(/* @vite-ignore */ String("/tools/bench/global-winter-native-frame.ts"));
      const fixture = await helpers.addWinterFixture();
      if (fixture.added) await helpers.prepareWinterFrame();
      return fixture;
    });
    if (fixture.added) {
      assert.equal(await page.evaluate(() => (window as any).__winterRefresh()), true);
      await waitForSeason(page, false, fixture.identity);
    }
    const before = await capture(page, quality, "off-a", true);
    const global = await openAppearance(page, true);
    assert.equal(await global.getAttribute("aria-pressed"), "false");
    const box = await global.boundingBox();
    assert(box && box.width === 48 && box.height === 48, "Global winter uses the shared 48px square control");
    await page.screenshot({ path: resolve(output, `${quality}-admin-global-control.png`) });
    await global.click();
    await waitForSeason(page, true, before.identity);
    const winter = await capture(page, quality, "winter", true);
    const ignore = await openAppearance(page, false);
    assert.equal(await ignore.getAttribute("aria-pressed"), "false");
    assert.equal(await ignore.locator("span").count(), 0, "Ignore control must be captionless");
    const ignoreBox = await ignore.boundingBox();
    assert(ignoreBox && ignoreBox.width === 48 && ignoreBox.height === 48);
    await page.screenshot({ path: resolve(output, `${quality}-appearance-control.png`) });
    await ignore.click();
    await waitForSeason(page, false, winter.identity);
    const ignored = await capture(page, quality, "ignored", false);
    assert.deepEqual(ignored.hashes, before.hashes);
    const follow = await openAppearance(page, false);
    assert.equal(await follow.getAttribute("aria-pressed"), "true");
    await follow.click();
    await waitForSeason(page, true, ignored.identity);
    const followed = await capture(page, quality, "followed", false);
    const turnOff = await openAppearance(page, true);
    assert.equal(await turnOff.getAttribute("aria-pressed"), "true");
    await turnOff.click();
    await waitForSeason(page, false, followed.identity);
    const after = await capture(page, quality, "off-b", true);
    for (const row of [winter, followed, after]) assert.deepEqual(row.hashes, before.hashes, `${quality} world bytes changed`);
    for (let index = 0; index < before.views.length; index++) {
      const a = before.views[index], b = winter.views[index], returned = after.views[index];
      assert.equal(b.visualWinter, true);
      assert(b.draws <= a.draws && b.triangles <= a.triangles, `${quality} winter increased draw/triangle budget`);
      assert.deepEqual(programBudget(b), programBudget(a), `${quality} winter changed shader operations/samplers`);
      assert.deepEqual(programBudget(returned), programBudget(a));
      assert.equal(returned.draws, a.draws);
      assert.equal(returned.triangles, a.triangles);
      assert.notEqual(b.pixelHash, a.pixelHash, "Winter must visibly change the real scene");
      assert(returned.pixelComparison.maximum <= 1 && returned.pixelComparison.meanAbsolute <= .001,
        "Returning to summer must restore the pinned scene within one-byte GPU colour quantization");
    }
    const receipts = await page.evaluate(() => window.__handoffReceipts?.() ?? []);
    assert(receipts.some(row => row.phases.some(mark => mark.phase === "install") &&
      row.phases.some(mark => mark.phase === "activate")));
    save();
  }
  await context.close();
  await adminApi.setGlobalWinter(true);
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestContext.newPage();
  await instrument(guest);
  await guest.goto(`${url}?quality=minimal&size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1`);
  await enterGame(guest);
  assert.equal(await guest.getByRole("button", { exact: true, name: "Development tools" }).count(), 0);
  assert.equal(await guest.getByRole("button", { exact: true, name: "Global winter" }).count(), 0);
  const ordinary = await openAppearance(guest, false);
  assert.equal(await ordinary.getAttribute("aria-pressed"), "false");
  assert.equal(await guest.evaluate(() => (window as any).__atmosphereLiveDebug.visualWinter), true);
  await guest.screenshot({ path: resolve(output, "ordinary-guest-appearance.png") });
  await guestContext.close();
  await adminApi.setGlobalWinter(false);
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  status = "passed";
  save();
  console.log(JSON.stringify({ nativeStates: rows.length, errors, missing, output, status: "passed" }));
} catch (error) {
  status = "failed";
  failure = String(error);
  save();
  throw error;
} finally {
  await browser.close();
  await server.close();
  await stack.close();
}
