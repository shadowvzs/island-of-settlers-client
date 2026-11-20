import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { BACKDROP_NATIONS, BACKDROP_SIZE, renderPortraitBackdrops } from "./player-portrait-backdrop-renderer";

/**
 * Static backdrops behind the animated HUD portraits: each nation's own buildings (from the
 * exported libraries) with its emblematic game tree (sakura, pine, oak, palm) and sky, softly blurred so the character reads in front.
 */
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: BACKDROP_SIZE, height: BACKDROP_SIZE } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/backdrop.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}backdrop.html`);
  const images = await page.evaluate(renderPortraitBackdrops, { nations: BACKDROP_NATIONS, size: BACKDROP_SIZE });
  if (errors.length) throw new Error(errors.join("\n"));
  mkdirSync("assets/ui-icons/portraits", { recursive: true });
  for (const [nation, data] of Object.entries(images))
    writeFileSync(`assets/ui-icons/portraits/${nation}-backdrop.webp`, Buffer.from(data, "base64"));
  console.log(Object.keys(images).join(", "));
} finally {
  await browser.close(); await server.close();
}
