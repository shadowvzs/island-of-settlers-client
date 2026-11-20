import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { renderProgressionIcons } from "./progression-icon-renderer";

/**
 * Renders the gem, quest scroll, level star, portrait frame, rally flag, the four nations' victory
 * emblems (tools/bench/victory-emblems.ts) and the theme-mode HUD art from original 3D models.
 */
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.addInitScript("window.__name = value => value;");
  await page.goto(url);
  const icons = await page.evaluate(renderProgressionIcons);
  mkdirSync("assets/ui-icons", { recursive: true });
  for (const [name, data] of Object.entries(icons)) writeFileSync(`assets/ui-icons/${name}.png`, Buffer.from(data, "base64"));
  console.log(Object.keys(icons).join(", "));
} finally {
  await browser.close(); await server.close();
}
