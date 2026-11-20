import { launchBrowser, startDevServer } from "../bench/browser";

/**
 * Usage: npx tsx tools/dev/animal-view.mts <out-prefix> [zoom] [species] [dx] [dz]
 * One in-game view centred near the most crowded group of a species (0 rabbit,
 * 1 deer, 2 elk) at its spawn positions, offset by dx / dz world units.
 */
const [prefix = "animals", zoom = "3.5", pick = "1", dx = "0", dz = "0"] = process.argv.slice(2);
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
await page.goto(`${url}?reveal=1`);
await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
const animals = await page.evaluate(() => window.__listAnimals!());
const species = Number(pick);
const neighbours = (animal: (typeof animals)[number]) =>
  animals.filter((other) => Math.hypot(other.x - animal.x, other.z - animal.z) < 3).length;
const candidates = animals.filter((animal) => animal.species === species);
const best = candidates.reduce((a, b) => (neighbours(b) > neighbours(a) ? b : a));
const view = [best.x + Number(dx), best.z + Number(dz)].map((v) => v.toFixed(2)).join(",");
await page.goto(`${url}?reveal=1&view=${view},${zoom}`, { timeout: 120000 });
await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${prefix}.png` });
console.log("shot", view);
await browser.close();
await server.close();
