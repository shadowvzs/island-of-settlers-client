import { launchBrowser, startDevServer } from "../bench/browser";

/** Usage: npx tsx tools/dev/lab-shot.mts <out-prefix> "<query>" [c] (c = cinematic camera) */
const [prefix = "shot", query = "", cinematic] = process.argv.slice(2);
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
await page.goto(`${url}?${query}`);
await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120000 });
await page.waitForTimeout(3000);
if (cinematic === "c") {
  await page.keyboard.press("c");
  await page.waitForTimeout(800);
}
await page.screenshot({ path: `${prefix}.png` });
console.log(
  (await page.locator(".stats-overlay pre").textContent())?.split("\n").slice(1, 3).join(" | ")
);
await browser.close();
await server.close();
