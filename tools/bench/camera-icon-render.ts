import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { renderCameraIcons } from "./camera-icon-renderer";

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.addInitScript("window.__name = value => value;");
  await page.goto(url);
  const icons = await page.evaluate(renderCameraIcons);
  mkdirSync("assets/ui-icons/camera", { recursive: true });
  for (const [name, bytes] of Object.entries(icons))
    writeFileSync(`assets/ui-icons/camera/${name}.png`, Buffer.from(bytes, "base64"));
  console.log("Rendered 12 original beveled 3D camera control icons.");
} finally { await browser.close(); await server.close(); }
