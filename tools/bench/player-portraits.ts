import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { PORTRAIT_SHEET_OPTIONS, renderPortraitSheets, SIZE } from "./player-portrait-renderer";

/**
 * Animated HUD portraits: a looping head-and-shoulders sprite sheet of each nation×gender player
 * that breathes, looks around, waves and talks, with short crossfades so the loop never pops.
 * The radio face crops come from the same body and frame as the HUD sheet.
 * Must match PORTRAIT_FRAMES, PORTRAIT_FPS and PORTRAIT_COLUMNS in
 * `src/app/settlement-ui/player-hud/helpers.ts`.
 */
const wanted = process.env.PORTRAIT_KEYS?.split(",");
const options = { ...PORTRAIT_SHEET_OPTIONS, portraits: PORTRAIT_SHEET_OPTIONS.portraits
  .filter(portrait => !wanted || wanted.includes(portrait.key)) };
assert(options.portraits.length, "No requested published player portraits found");
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: SIZE * 2, height: SIZE * 2 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/portrait.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}portrait.html`);
  const { durations, faces, result: sheets } = await page.evaluate(renderPortraitSheets, options);
  assert.deepEqual(errors, [], "Portrait export must not publish browser failures");
  mkdirSync("assets/ui-icons/portraits", { recursive: true });
  mkdirSync("assets/ui-icons/portraits/faces", { recursive: true });
  for (const [key, data] of Object.entries(sheets))
    writeFileSync(`assets/ui-icons/portraits/${key}.webp`, Buffer.from(data, "base64"));
  for (const [key, data] of Object.entries(faces))
    writeFileSync(`assets/ui-icons/portraits/faces/${key}.webp`, Buffer.from(data, "base64"));
  console.log(Object.keys(sheets).join(", "), "clip seconds", JSON.stringify(durations), errors.length ? errors : "");
} finally {
  await browser.close(); await server.close();
}
