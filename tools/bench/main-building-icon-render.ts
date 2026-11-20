import { writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { renderMainBuildingIcon } from "./main-building-icon-renderer";
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}building-showcase.html?building=0&quality=high`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady));
  const png = await page.evaluate(renderMainBuildingIcon);
  writeFileSync("assets/ui-icons/roman-buildings.png", Buffer.from(png, "base64"));
  console.log("Rendered actual Roman HQ to transparent building icon.");
} finally { await browser.close(); await server.close(); }
