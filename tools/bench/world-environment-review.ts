import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { mapScriptHash } from "../../../island-of-settlers-shared/src/script/hash";
import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/index";
import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";

/**
 * ENV0 visual check (hu): `plain` shots of an island without a map script at a clear noon (day mode "Always day"),
 * close and at the normal iso zoom per detail level, for a base-vs-lane comparison; with SCRIPT=1 the same island
 * then loads a script that reads the environment (`timeOfDay` 17, `setWeather` rain), so the presentation follows
 * the world environment (`env` shots) and the Settings Daylight section shows its locked state with the reason.
 * Environment: OUTPUT, QUALITY (comma list, default high,minimal), SCRIPT (1/0, default 1), SUFFIX.
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITY ?? "high,minimal").split(",");
const withScript = (process.env.SCRIPT ?? "1") === "1";
const suffix = process.env.SUFFIX ?? "";

const lit = (type: "number" | "string", value: number | string) => ({ k: "lit", type, value });

const ENVIRONMENT_SCRIPT = {
  actors: [], cameraShots: [], folders: [], homeRewards: [],
  nextIds: { actor: 0, folder: 0, region: 0, reward: 0, trigger: 1, variable: 0 },
  quests: { daily: "off", dailyResetUtcMinutes: 0, groups: [], id: "review", quests: [], revision: 1, version: 1 },
  regions: [], revision: 1, scriptUid: "env0-review", sequences: [],
  triggers: [{ actions: [
    { args: { hour: lit("number", 17) }, id: "s1", k: "do", op: "timeOfDay" },
    { args: { state: lit("string", "rain"), transitionSeconds: lit("number", 0) }, id: "s2", k: "do", op: "setWeather" }
  ], concurrency: "queue", conditions: { k: "all", of: [] }, enabled: true,
  events: [{ kind: "mapStarted", player: { kind: "any" }, slots: {} }], folderId: null, id: "trigger-1",
  name: "environment", runLimit: null }],
  variables: [], version: 1
} as unknown as MapScript;

const home = (page: Page) => page.evaluate(() => {
  const { headquarters } = (window as any).__settlement.simulation;
  return { x: headquarters.x as number, z: headquarters.z as number };
});

/** Loads the island's own save again with the script snapshot added: the map script starts on that island. */
const startScript = (page: Page, script: MapScript) => page.evaluate(({ script, scriptHash }) => {
  const { simulation } = (window as any).__settlement;
  const save = simulation.saveState();
  const loaded = simulation.loadState({ ...save, scriptSnapshot: { revision: 1, script, scriptHash } });
  return { environment: Boolean(simulation.script()?.environment), loaded: loaded.ok };
}, { script, scriptHash: mapScriptHash(script) });

const shoot = async (page: Page, focus: { x: number; z: number }, name: string) => {
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 3), focus);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(output, `${name}-close${suffix}.png`) });
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 1), focus);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(output, `${name}-normal${suffix}.png`) });
};

const shootSettings = async (page: Page, name: string) => {
  await page.locator("[data-ui-anchor='bottomBar.menu']").click();
  await page.getByRole("button", { exact: true, name: "Beállítások" }).click();
  const panel = page.locator(".settings-panel:not([hidden])");
  await panel.getByRole("tab", { name: "Egyéb" }).click();
  const daylight = panel.locator(".settings-panel__section").filter({ has: page.locator(".settings-panel__day-mode") });
  await daylight.waitFor();
  await daylight.screenshot({ path: resolve(output, `${name}-settings${suffix}.png`) });
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
const errors: string[] = [];
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    page.on("pageerror", error => errors.push(`${quality}: ${error.message}`));
    await page.addInitScript("window.__name = value => value;");
    await page.addInitScript(() => {
      localStorage.setItem("island-of-settlers.day-mode", "sun");
      localStorage.setItem("island-of-settlers.language", "hu");
    });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&forest=0&cache=0&lang=hu&time=12`);
    await waitForIsland(page);
    await page.addStyleTag({ content: ".stats-overlay { opacity: 0 !important; pointer-events: none; }" });
    const centre = await home(page);
    const focus = { x: centre.x + 4, z: centre.z + 4 };
    await shoot(page, focus, `${quality}-plain`);
    const shots: Record<string, unknown> = {};
    report[quality] = shots;
    if (withScript) {
      shots.started = await startScript(page, ENVIRONMENT_SCRIPT);
      await page.waitForTimeout(6000);
      shots.reading = await page.evaluate(() => (window as any).__settlement.simulation.script()?.environmentReading());
      await shoot(page, focus, `${quality}-env`);
      await shootSettings(page, `${quality}-env`);
    }
    console.log(quality, JSON.stringify(shots));
    await page.close();
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(output, `report${suffix}.json`), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
