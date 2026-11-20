import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "../bench/browser";
import { renderGameCursors } from "../bench/game-cursor-renderer";
import { encodeOptimizedPng } from "../dev/png";

/**
 * Renders the game cursor set (tools/bench/cursors: arrow, pointer, gauntlets, order cursors) to
 * assets/ui-icons/cursors/ as optimised 32 px and @2x PNGs, prints the hotspot table and checks that every
 * cursor stylesheet uses the rendered hotspots. Run: npx tsx tools/assets/game-cursors.ts
 */
const OUT = "assets/ui-icons/cursors";
const STYLESHEETS = ["src/app/cursors/game-cursors.css", "src/app/settlement/army-order-cursor.css"];

/** Every `<name>.png") x y` in the stylesheets that disagrees with the rendered hotspot. */
const hotspotMismatches = (hotspots: Record<string, readonly [number, number]>) => {
  const problems: string[] = [];
  for (const path of STYLESHEETS) {
    const css = readFileSync(path, "utf8");
    for (const [, name, x, y] of css.matchAll(/\/([\w-]+?)(?:@2x)?\.png"\)(?: 2x\))? (\d+) (\d+)/g)) {
      const expected = hotspots[name!];
      if (!expected) problems.push(`${path}: ${name} is not rendered`);
      else if (`${x} ${y}` !== expected.join(" "))
        problems.push(`${path}: ${name} ${x} ${y}, rendered ${expected.join(" ")}`);
    }
  }
  return problems;
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.addInitScript("window.__name = value => value;");
  await page.goto(url);
  const cursors = await page.evaluate(renderGameCursors, undefined);
  mkdirSync(OUT, { recursive: true });
  const hotspots: Record<string, readonly [number, number]> = {};
  for (const [name, { hotspot, pixels }] of Object.entries(cursors)) {
    hotspots[name] = hotspot;
    for (const [suffix, size, key] of [["", 32, "1x"], ["@2x", 64, "2x"]] as const) {
      const png = encodeOptimizedPng(size, size, Buffer.from(pixels[key], "base64"));
      writeFileSync(`${OUT}/${name}${suffix}.png`, png);
    }
    console.log(`${name.padEnd(18)} hotspot ${hotspot.join(" ")}`);
  }
  const problems = hotspotMismatches(hotspots);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
} finally { await browser.close(); await server.close(); }
