import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { createIdentityClient } from "../../src/app/account/identity-client";
import { patchAtmosphereLiveCost } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "debug-creation-2026-11-02");
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:5294";
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const { commandLogInterval } = await import(String("../../../island-of-settlers-api/tests/command-log-fixture.ts"));
const stack = await startAcceptanceStack(origin);
const { server, url } = await startDevServer({ env: { VITE_API_URL: stack.apiUrl,
  VITE_IDENTITY_URL: stack.identityUrl }, host: "127.0.0.1", port: 5294 });
const browser = await launchBrowser();
const rows: any[] = [], errors: string[] = [], missing: string[] = [];
let authority: unknown, status = "running", failure: string | undefined;
const report = () => writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, failure, authority,
  errors, missing, rows, scope: "Real authenticated admin controls and real fleet/AI on High and Minimal. " +
    "Disposable player storage/database. Fixed renderer camera/frame; no gameplay timing or stress claim." }, null, 2));
const register = async (name: string) => {
  const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  const suffix = randomBytes(5).toString("hex");
  const credentials = { displayName: `${name}${suffix}`, email: `${name}-${suffix}@example.test`,
    nation: "viking" as const, password: randomBytes(24).toString("base64url") };
  const registered = await identity.register(credentials);
  assert(registered.ok);
  return { credentials, identity, role: registered.account.role };
};
const enterGame = async (page: Page, credentials: { email: string; password: string }) => {
  const deadline = Date.now() + 180_000;
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
  throw new Error(`Game startup timeout: ${(await page.locator("body").innerText()).slice(0, 1200)}`);
};
const instrument = async (page: Page) => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() === 404) missing.push(response.url()); });
  page.on("console", message => { if (message.type() === "error" && /shader|WebGL|THREE.*Error/i.test(message.text()))
    errors.push(message.text()); });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/v1/saves/*/verification", route => route.fulfill({ json: {
    flag: null, flaggedAt: null, randomTrailRequest: null, verifiedRevision: null
  } }));
  await page.route("**/create-three-renderer.ts*", async route => {
    const response = await route.fetch();
    const source = patchAtmosphereLiveCost(await response.text()).replace("atmosphereDebug.api = result;",
      "atmosphereDebug.world=world;atmosphereDebug.vegetation=vegetation;atmosphereDebug.api=result;");
    await route.fulfill({ response, body: source });
  });
};
const focus = (page: Page, point: { x: number; z: number }, zoom = 3.5) => page.evaluate(async ({ point, zoom }) => {
  const helper = await import(/* @vite-ignore */ String("/tools/bench/debug-creation-native-frame.ts"));
  return helper.focusDebugCreationPoint(point, zoom);
}, { point, zoom });
const openShipTool = async (page: Page) => {
  await page.getByRole("button", { exact: true, name: "Development tools" }).click();
  const menu = page.locator(".development-menu");
  await menu.getByRole("tab", { exact: true, name: "World" }).click();
  return menu.getByRole("button", { exact: true, name: "Create ship" });
};
try {
  const admin = await register("Admin"), player = await register("Player");
  assert.equal(admin.role, "admin"); assert.equal(player.role, "player");
  const upload = async (identity: typeof admin.identity, names: string[]) => {
    const headers = { authorization: `Bearer ${await identity.accessToken()}`, "content-type": "application/json" };
    const created = await fetch(`${stack.apiUrl}/v1/saves`, { method: "POST", headers,
      body: JSON.stringify({ slotNo: 2, name: "Debug authority proof" }) });
    assert.equal(created.status, 201);
    const slot = (await created.json()).id;
    const snapshot = { islands: [{ key: "home", save: { schemaVersion: 1, metadata: {}, data: { seed: 3 } } }],
      player: {}, session: {}, colonies: [], adventures: [], evacuations: [] };
    const statuses: number[] = [];
    for (const name of names) {
      const response = await fetch(`${stack.apiUrl}/v1/saves/${slot}/snapshot`, { method: "PUT",
        headers: { ...headers, "if-match": "0" }, body: JSON.stringify({ ...snapshot,
          commandLogs: [commandLogInterval({ baseRevision: null, entries: [{ checksum: "bb",
            command: { args: [{ x: 40, z: 30 }], name }, issuedTick: 110, tick: 110 }] })] }) });
      statuses.push(response.status);
    }
    return statuses;
  };
  const commands = ["spawnDebugShip", "spawnDebugSoldier", "spawnDebugEnemy"];
  const denied = await upload(player.identity, commands), accepted = await upload(admin.identity, [commands[0]!]);
  assert.deepEqual(denied, [403, 403, 403]); assert.deepEqual(accepted, [200]);
  authority = { commands, denied, accepted, adminRole: admin.role, playerRole: player.role };
  report();
  for (const quality of ["high", "minimal"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage(); await instrument(page);
    await page.goto(`${url}admin.html?quality=${quality}&size=128&seed=123&cache=0&login=1&time=day&reveal=1`);
    await enterGame(page, admin.credentials);
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const fixture = await page.evaluate(async () => {
      const helper = await import(/* @vite-ignore */ String("/tools/bench/debug-creation-native-frame.ts"));
      return helper.prepareDebugCreationFrame();
    });
    const tool = await openShipTool(page), box = await tool.boundingBox();
    assert(box && box.width === 48 && box.height === 48);
    assert.equal(await tool.locator("span").count(), 0);
    assert.equal(await tool.getAttribute("aria-pressed"), "false");
    await page.screenshot({ path: resolve(output, `${quality}-admin-control.png`) });
    await tool.click();
    assert.equal(await tool.getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { exact: true, name: "Development tools" }).click();
    const first = await focus(page, fixture.points[0]);
    assert(Math.hypot(first.seaPick.x - fixture.points[0].x, first.seaPick.z - fixture.points[0].z) < 1e-8);
    await page.mouse.click(first.screen.x, first.screen.y);
    let placed = await focus(page, fixture.points[0]);
    assert.equal(placed.ships.length, fixture.shipsBefore + 1);
    const ship = placed.ships.at(-1);
    assert(Math.hypot(ship.x - fixture.points[0].x, ship.z - fixture.points[0].z) < 1e-8);
    assert.equal(await page.evaluate(() => (window as any).__settlement.shipSpawnMode()), true);
    await page.screenshot({ path: resolve(output, `${quality}-ship-close.png`) });
    await focus(page, fixture.points[0], 1);
    await page.screenshot({ path: resolve(output, `${quality}-ship-normal.png`) });
    const occupied = await focus(page, fixture.points[0]);
    await page.mouse.click(occupied.screen.x, occupied.screen.y);
    placed = await focus(page, fixture.points[0]);
    assert.equal(placed.ships.length, fixture.shipsBefore + 1);
    assert.equal(await page.evaluate(() => (window as any).__settlement.shipSpawnMode()), true);
    const second = await focus(page, fixture.points[1]);
    await page.mouse.click(second.screen.x, second.screen.y);
    placed = await focus(page, fixture.points[1]);
    assert.equal(placed.ships.length, fixture.shipsBefore + 2);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => (window as any).__settlement.shipSpawnMode()), false);
    const troops = await page.evaluate(async () => {
      const helper = await import(/* @vite-ignore */ String("/tools/bench/debug-creation-native-frame.ts"));
      return helper.reviewDebugCreationTroops();
    });
    assert(troops.admitted.combat.returnToStorage, "Friendly joins ordinary storage admission");
    assert(troops.raider.combat.destination || troops.raider.combat.siege !== undefined, "Enemy has a real raid objective");
    assert(troops.fought, "Real debug troops must fight without scenario commands");
    assert(troops.actors.length > 0, "Real combat soldiers must produce scene actor frames");
    await focus(page, troops.initial, 6);
    await page.screenshot({ path: resolve(output, `${quality}-regular-troop-combat.png`) });
    rows.push({ quality, fixture, ships: placed.ships, frameShips: placed.frameShips, occupiedRejected: true,
      repeatedClick: true, exactVisibleSeaClick: true, escapeCancels: true, toolBox: box, troops });
    report(); await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); await instrument(page);
  const adminChunks: string[] = [];
  page.on("request", request => { if (/debug-click-modes|ship-spawn-mode|island-development-tools/.test(request.url()))
    adminChunks.push(request.url()); });
  await page.goto(`${url}?quality=minimal&size=128&seed=123&cache=0&login=1&time=day&reveal=1`);
  await enterGame(page, player.credentials);
  assert.equal(await page.getByRole("button", { exact: true, name: "Create ship" }).count(), 0);
  assert.equal(await page.getByRole("button", { exact: true, name: "Development tools" }).count(), 0);
  assert.equal(adminChunks.some(chunk => chunk.includes("island-development-tools")), false);
  rows.push({ quality: "minimal", role: "player", hiddenAdminControls: true,
    fullAdminPanelLoaded: false, localDevelopmentHooks: adminChunks,
    note: "Vite development intentionally loads local test click hooks. Production bundle separation is audited separately." });
  await page.screenshot({ path: resolve(output, "ordinary-player.png") });
  await context.close();
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  status = "passed"; report();
} catch (error) {
  status = "failed"; failure = String(error); report(); throw error;
} finally { await browser.close(); await server.close(); await stack.close(); }
console.log(`Debug creation native review: ${status}`);
