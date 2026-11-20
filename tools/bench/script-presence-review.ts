import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { mapScriptHash } from "../../../island-of-settlers-shared/src/script/hash";
import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/index";
import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";

/**
 * TRG5a visual check of the map script's presence actions on the real game: a script spawns four rank-2 shield
 * soldiers beside the headquarters with a long fade in and hides the first one at once. The capture shows three
 * half-faded soldiers and no fourth (hidden), close and at the normal iso zoom, per detail level.
 * Environment: OUTPUT, QUALITY (comma list, default high,minimal), FADE_MS, SHOT_AFTER_MS, SUFFIX (file names).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITY ?? "high,minimal").split(",");
const FADE_MS = Number(process.env.FADE_MS ?? 12_000);
const SHOT_AFTER_MS = Number(process.env.SHOT_AFTER_MS ?? 5_000);
const suffix = process.env.SUFFIX ?? "";

const lit = (value: number) => ({ k: "lit", type: "number", value });
const ref = (kind: string, id: string) => ({ id, k: "ref", kind });

/** The presence script around the headquarters at (x, z). */
const scriptAt = (x: number, z: number): MapScript => ({
  actors: [], cameraShots: [], folders: [], homeRewards: [],
  nextIds: { actor: 0, folder: 0, region: 1, reward: 0, trigger: 1, variable: 1 },
  quests: { daily: "off", dailyResetUtcMinutes: 0, groups: [], id: "review", quests: [], revision: 1, version: 1 },
  regions: [{ id: "region-1", name: "beside", shape: { kind: "rect", maxX: x + 9, maxZ: z + 2, minX: x + 6,
    minZ: z - 1 } }],
  revision: 1, scriptUid: "trg5a-review", sequences: [],
  triggers: [{ actions: [
    { args: { at: ref("region", "region-1"), count: lit(4), fadeMs: lit(FADE_MS), owner: { faction: 0, kind: "slot" },
      store: ref("variable", "var-1"), type: { rank: { max: 2, min: 2 }, type: ref("content", "soldier:shield") } },
    id: "s1", k: "do", op: "spawn" },
    { args: { actor: { kind: "query", query: { from: { kind: "variable", variable: ref("variable", "var-1") },
      pick: { kind: "first" } } }, hidden: { k: "lit", type: "boolean", value: true } }, id: "s2", k: "do",
    op: "hide" }
  ], concurrency: "queue", conditions: { k: "all", of: [] }, enabled: true,
  events: [{ kind: "mapStarted", player: { kind: "any" }, slots: {} }], folderId: null, id: "trigger-1",
  name: "presence", runLimit: null }],
  variables: [{ id: "var-1", initial: { type: "actorGroup", value: [] }, maxLength: 8, name: "squad",
    type: "actorGroup" }],
  version: 1
}) as unknown as MapScript;

const home = (page: Page) => page.evaluate(() => {
  const { headquarters } = (window as any).__settlement.simulation;
  return { x: headquarters.x as number, z: headquarters.z as number };
});

/** Loads the island's own save again with the script snapshot added: the map script starts on that island. */
const startScript = (page: Page, script: MapScript) => page.evaluate(({ script, scriptHash }) => {
  const { simulation } = (window as any).__settlement;
  const save = simulation.saveState();
  const loaded = simulation.loadState({ ...save, scriptSnapshot: { revision: 1, script, scriptHash } });
  return { loaded: loaded.ok, reason: loaded.reason ?? null, script: Boolean(simulation.script()) };
}, { script, scriptHash: mapScriptHash(script) });

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
const errors: string[] = [];
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    page.on("pageerror", error => errors.push(`${quality}: ${error.message}`));
    await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&forest=0&cache=0&lang=hu`);
    await waitForIsland(page);
    await page.addStyleTag({ content: ".stats-overlay { opacity: 0 !important; pointer-events: none; }" });
    const centre = await home(page);
    const started = await startScript(page, scriptAt(centre.x, centre.z));
    const focus = { x: centre.x + 7.5, z: centre.z + .5 };
    const shots: Record<string, unknown> = { started };
    report[quality] = shots;
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 3), focus);
    await page.waitForTimeout(SHOT_AFTER_MS);
    shots.presentation = await page.evaluate(() =>
      (window as any).__settlement.simulation.script()?.actions.presentation());
    await page.screenshot({ path: resolve(output, `${quality}-close${suffix}.png`) });
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 1), focus);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(output, `${quality}-normal${suffix}.png`) });
    console.log(quality, JSON.stringify(shots));
    await page.close();
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
