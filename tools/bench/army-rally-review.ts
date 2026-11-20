import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { closeDevelopment,openDevelopmentAction } from "./development-ui-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Rally banner and "+" box selection in the real game (owner requests 2026-10-13): plants the
 * banner from the Call troops panel, watches the troops gather under it, box-selects them with a
 * left / one-finger drag while "+" is on (the camera must not pan) and checks right drag still
 * pans. High and Minimal, desktop and phone; screenshots go to resources/settlement-previews.
 */
const output = resourcesPath("settlement-previews", "army-rally");
mkdirSync(output, { recursive: true });

const flatIsland = async (page: Page) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/src/app/main.ts", async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (!text.includes("prepareIslandWorld(world, params, fog, revealOre,")) throw new Error("main.ts no longer prepares the island world");
    const source = text.replace("prepareIslandWorld(world, params, fog, revealOre,",
      `world.heights.fill(world.seaLevel + 2); world.props.count = 0;
       world.blocking.fill(0); world.walkCost.fill(10); world.buildClass.fill(4);
       world.start.x = 64.5; world.start.z = 64.5;
       prepareIslandWorld(world, params, fog, revealOre,`)
      .replace("window.__islandReady = true", "window.__rallyCamera = camera; window.__islandReady = true");
    await route.fulfill({ response, body: source });
  });
};

const openGame = async (browser: Browser, quality: string, phone: boolean, url: string) => {
  const viewport = phone ? { width: 390, height: 844 } : { width: 1200, height: 850 };
  const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await flatIsland(page);
  await page.goto(`${url}?quality=${quality}&seed=123&size=128&landform=peninsula` +
    "&mountains=0&forest=0&reveal=1&cache=0&time=day");
  await page.waitForFunction(() => !!(window as any).__islandReady, null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  return { errors, page };
};

const helpers = (page: Page, phone: boolean) => {
  const press = (name: string) => phone
    ? page.getByRole("button", { name, exact: true }).tap()
    : page.getByRole("button", { name, exact: true }).click();
  const advance = async (seconds: number) => {
    await page.evaluate(seconds => {
      const simulation = (window as any).__settlement.simulation;
      for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
    }, seconds);
    await page.waitForTimeout(600);
  };
  const focus = async (point: { x: number; z: number }, zoom: number) => {
    await page.evaluate(({ point, zoom }) => Object.assign((window as any).__rallyCamera,
      { centerX: point.x, centerZ: point.z, zoom }), { point, zoom });
    await page.waitForTimeout(500);
  };
  const screen = (point: { x: number; z: number }) =>
    page.evaluate(point => (window as any).__settlement.projectGround(point.x, point.z), point);
  const camera = () => page.evaluate(() => {
    const { centerX, centerZ } = (window as any).__rallyCamera;
    return { centerX, centerZ };
  });
  const selection = () => page.evaluate(() => (window as any).__settlement.simulation.militarySoldiers()
    .filter((soldier: any) => soldier.combat?.selected).length);
  return { advance, camera, focus, press, screen, selection };
};

/** One-finger drag through the DevTools touch API (Playwright's touchscreen only taps). */
const touchDrag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const session = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: { x: number; y: number }) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
  await touch("touchStart", from);
  for (let step = 1; step <= 8; step++)
    await touch("touchMove", { x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8 });
  await page.screenshot({ path: resolve(output, `phone-${await quality(page)}-box-select.png`) });
  await touch("touchEnd");
  await session.detach();
};

const plantBanner = async (page: Page, phone: boolean, target: { x: number; z: number }) => {
  const { focus, press, screen } = helpers(page, phone);
  await press("Call all free troops");
  await page.screenshot({ path: resolve(output, `${phone ? "phone" : "desktop"}-${await quality(page)}-panel.png`) });
  await press("Choose rally point");
  await focus(target, 1.6);
  const point = await screen(target);
  if (phone) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  const rally = await page.evaluate(() => (window as any).__settlement.simulation.militaryRally());
  assert(rally && Math.hypot(rally.x - target.x, rally.z - target.z) < 1.5, "The banner stands where clicked");
  return rally;
};

const quality = (page: Page) => page.evaluate(() => new URL(location.href).searchParams.get("quality"));

const reviewDesktop = async (browser: Browser, url: string, detail: string) => {
  const { errors, page } = await openGame(browser, detail, false, url);
  const { advance, camera, focus, press, screen, selection } = helpers(page, false);
  await (await openDevelopmentAction(page, "Start training encounter")).click(); await closeDevelopment(page);
  const hq = await page.evaluate(() => (window as any).__settlement.simulation.headquarters);
  const target = { x: hq.x - 8, z: hq.z + 18 };
  const rally = await plantBanner(page, false, target);
  await advance(4); await focus(target, 1.4);
  await page.screenshot({ path: resolve(output, `desktop-${detail}-march.png`) });
  await advance(150);
  await focus({ x: rally.x - 3, z: rally.z - 3 }, 3.2);
  await page.screenshot({ path: resolve(output, `desktop-${detail}-banner-close.png`) });
  await focus(rally, 1.3);
  await page.screenshot({ path: resolve(output, `desktop-${detail}-banner-gameplay.png`) });
  // A pending rally order (the campaign report) must not swallow the clicks of the "+" mode.
  await press("Call all free troops"); await press("Choose rally point");
  await press("Add soldiers to selection");
  const before = await camera();
  const centre = await screen(rally);
  const corner = { x: centre.x - 260, y: centre.y - 200 }, far = { x: centre.x + 260, y: centre.y + 160 };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move((corner.x + far.x) / 2, (corner.y + far.y) / 2, { steps: 6 });
  await page.mouse.move(far.x, far.y, { steps: 6 });
  await page.screenshot({ path: resolve(output, `desktop-${detail}-box-select.png`) });
  await page.mouse.up();
  const boxed = await selection();
  assert(boxed > 3, `The box selects the gathered soldiers (${boxed})`);
  assert.deepEqual(await camera(), before, "A left drag in + mode never pans");
  const banner = await page.evaluate(() => (window as any).__settlement.simulation.militaryRally());
  assert.deepEqual(banner, rally, "The + mode cancelled the pending rally order");
  await page.mouse.move(600, 400); await page.mouse.down({ button: "right" });
  await page.mouse.move(520, 340, { steps: 5 }); await page.mouse.up({ button: "right" });
  const panned = await camera();
  assert.notDeepEqual(panned, before, "Right drag pans in + mode");
  await press("Add soldiers to selection");
  await page.mouse.move(600, 400); await page.mouse.down();
  await page.mouse.move(680, 460, { steps: 5 }); await page.mouse.up();
  assert.notDeepEqual(await camera(), panned, "Leaving + mode restores left-drag panning");
  assert.deepEqual(errors, []);
  await page.close();
  return { boxed, rally };
};

const reviewPhone = async (browser: Browser, url: string, detail: string) => {
  const { errors, page } = await openGame(browser, detail, true, url);
  const { advance, camera, focus, press, screen, selection } = helpers(page, true);
  await (await openDevelopmentAction(page, "Start training encounter")).click(); await closeDevelopment(page);
  const hq = await page.evaluate(() => (window as any).__settlement.simulation.headquarters);
  const rally = await plantBanner(page, true, { x: hq.x + 6, z: hq.z + 16 });
  await advance(150); await focus(rally, 1.2);
  await page.screenshot({ path: resolve(output, `phone-${detail}-banner.png`) });
  await press("Add soldiers to selection");
  const before = await camera();
  const centre = await screen(rally);
  // Below the portrait and quest icons, so the finger starts on the map.
  const corner = { x: 30, y: Math.max(230, centre.y - 120) }, far = { x: 330, y: centre.y + 200 };
  await touchDrag(page, corner, far);
  const boxed = await selection();
  assert(boxed > 3, `A one-finger drag box-selects on the phone (${boxed})`);
  assert.deepEqual(await camera(), before, "A one-finger drag in + mode never pans");
  await page.screenshot({ path: resolve(output, `phone-${detail}-selected.png`) });
  assert.deepEqual(errors, []);
  await page.close();
  return { boxed };
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const report: Record<string, unknown> = {};
  for (const detail of ["high", "minimal"]) {
    report[`desktop-${detail}`] = await reviewDesktop(browser, url, detail);
    report[`phone-${detail}`] = await reviewPhone(browser, url, detail);
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  console.log(report);
} finally { await browser.close(); await server.close(); }
