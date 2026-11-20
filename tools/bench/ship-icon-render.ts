import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { NEUTRAL_SHIP_ICONS, renderShipIcon, SHIP_ICONS } from "./ship-icon-renderer";

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/ship-icon.html", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><body style='margin:0'>"
  }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}ship-icon.html`);
  for (const icon of process.argv.includes("--neutral") ? NEUTRAL_SHIP_ICONS : SHIP_ICONS) {
    if (process.env.NATIONS && !process.env.NATIONS.split(",").includes(icon.nation)) continue;
    const png = await page.evaluate(renderShipIcon, { nation: icon.nation, neutral: process.argv.includes("--neutral") });
    assert(png.length > 10000);
    const path = resolve(icon.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(png, "base64"));
    console.log(`Rendered ${icon.file}`);
  }
} finally { await browser.close(); await server.close(); }
