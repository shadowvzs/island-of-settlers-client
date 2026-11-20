import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { type SheetRow, writeContactSheet } from "../review/review-contact-sheet";
import { launchBrowser, startDevServer } from "./browser";
import { fleetEyeView, fleetIsoView } from "./ship-wind-stage";
import { enterPossessed, openReviewPage, pinLight, prepareScene, readFrame,
  stageReviewSave } from "./water-review-page";

/**
 * Pirate ship review (TOOL-3 style sheet on the real island renderer, frozen owner-save frame): the owner's
 * Blackwake and Red Viper raiders beside a Roman player ship for scale, and a Blackwake with soldiers on
 * deck. Per preset: the fleet at normal and far iso zoom, every ship close, the eye from the beach, the
 * spyglass and a waterline eye. Writes `shots/`, `sheet.png` and `report.json`.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1280x800] [SHEET_ONLY=1]
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1280x800").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const shotsDir = resolve(outputDir, "shots");
const SHOT_TIME = 12;
const ZOOM = { close: 2.2, far: .45, normal: 1 };
mkdirSync(shotsDir, { recursive: true });

/** Ships at the ship-wind fleet offsets; ids pick the pirate hull (even Blackwake, odd Red Viper). */
const FLEET = [
  { heading: 0, id: 900, label: "Blackwake (raider)", livery: "enemy", troops: 0 },
  { heading: Math.PI / 2, id: 901, label: "Red Viper (raider)", livery: "enemy", troops: 0 },
  { heading: Math.PI, id: 903, label: "Roman player ship (scale)", livery: undefined, troops: 0 },
  { heading: -Math.PI / 4, id: 904, label: "Blackwake, soldiers aboard", livery: "enemy", troops: 8 }
] as const;
const OFFSETS = [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const;

const stageFleet = (page: Page) => page.evaluate(({ fleet, offsets, time }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { deep, water } = debug.sites;
  const frame = debug.frozenFrame, environment = frame.environment;
  const downwind = Math.atan2(environment.windX, environment.windZ);
  frame.time = time;
  frame.ships = fleet.map((ship, index) => ({ cargoCount: 0, id: ship.id, livery: ship.livery, phase: "sailing",
    deckTroops: Array.from({ length: ship.troops }, (_, rank) => ({ rank, type: rank % 2 ? "archer" : "shield" })),
    x: deep.x + offsets[index]![0], y: water, yaw: downwind + ship.heading, z: deep.z + offsets[index]![1] }));
  debug.draw();
}, { fleet: FLEET, offsets: OFFSETS, time: SHOT_TIME });

const save = async (page: Page, name: string) => {
  // The pirate pack loads on the first raider frame: redraw until the models replaced the galley.
  for (let attempt = 0; attempt < 3; attempt++) { await stageFleet(page); await page.waitForTimeout(400); }
  const dataUrl = await readFrame(page);
  writeFileSync(resolve(shotsDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  console.log("shot", name);
};

const capturePreset = async (page: Page, quality: string) => {
  await prepareScene(page);
  await pinLight(page, "day");
  await stageFleet(page); await page.waitForTimeout(3000);
  for (const [view, zoom] of [["iso-normal", ZOOM.normal], ["iso-far", ZOOM.far]] as const) {
    await fleetIsoView(page, -1, zoom); await save(page, `${quality}-${view}`);
  }
  for (const ship of FLEET.keys()) {
    await fleetIsoView(page, ship, ZOOM.close); await save(page, `${quality}-iso-close-${ship}`);
  }
  await enterPossessed(page);
  for (const [kind, ship] of [["far", 0], ["spyglass", 1], ["spyglass", 0], ["near", 3]] as const) {
    await fleetEyeView(page, kind, ship); await save(page, `${quality}-eye-${kind}-${ship}`);
  }
};

const VIEWS = ["iso-normal", "iso-far", ...FLEET.map((_, ship) => `iso-close-${ship}`), "eye-far-0",
  "eye-spyglass-1", "eye-spyglass-0", "eye-near-3"];
const viewLabel = (view: string) => {
  const ship = /-(\d)$/.exec(view)?.[1];
  return ship ? `${view.replace(/-\d$/, "")}: ${FLEET[Number(ship)]!.label}` : view;
};

const writeSheet = async () => {
  const browser = await launchBrowser();
  try {
    const rows: SheetRow[] = qualities.flatMap(quality => [VIEWS.slice(0, 6), VIEWS.slice(6)].map((views, part) => ({
      cells: views.map(view => ({ label: viewLabel(view), path: resolve(shotsDir, `${quality}-${view}.png`) })),
      heading: `${quality} · ${part ? "eye views" : "iso views"}`
    })));
    await writeContactSheet(browser, { columns: 6, rows, title: "Pirate ships (owner models) in game", width: 3200 },
      resolve(outputDir, "sheet.png"));
  } finally { await browser.close(); }
};

const captureAll = async () => {
  const saveText = readFileSync(sourcePath, "utf8"), staged = stageReviewSave(saveText);
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const errors: string[] = [];
  try {
    for (const quality of qualities) {
      const opened = await openReviewPage(browser, url, quality, staged, { height: height!, width: width! });
      await capturePreset(opened.page, quality);
      errors.push(...opened.errors);
      await opened.page.close();
    }
  } finally { await browser.close(); await server.close(); }
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ errors, qualities }, null, 2));
};

if (process.env.SHEET_ONLY !== "1") await captureAll();
await writeSheet();
console.log("done", outputDir);
