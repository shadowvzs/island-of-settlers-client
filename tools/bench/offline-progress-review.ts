import { readFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";

const source = JSON.parse(readFileSync(process.argv[2] ??
  "/home/shadowvzs/Downloads/island-settlers-2026-10-15 (8).json", "utf8"));
const seconds = Number(process.argv[3] ?? 60);
source.savedAt = Date.now() - seconds * 1000;
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/offline-progress-review.html", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body>Offline replay check</body></html>" }));
  await page.goto(`${url}offline-progress-review.html`);
  const result = await page.evaluate(async ({ seconds, source }) => {
    const { advanceOfflineGameInWorker, stageGameSessionInWorker } = await import(
      /* @vite-ignore */ String("/src/app/settlement/game-session-worker.ts"));
    const now = source.savedAt + seconds * 1000, started = performance.now();
    let reports = 0, heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 10);
    const resumed = await advanceOfflineGameInWorker(source, now, () => reports++);
    const loaded = await stageGameSessionInWorker(resumed);
    clearInterval(timer);
    return { milliseconds: Math.round(performance.now() - started), reports, heartbeats,
      seconds, buildings: loaded.settlement.buildings.length, actors: loaded.settlement.actors.length,
      cursor: resumed.savedAt === now, archipelagoActive: resumed.archipelago?.active ?? null };
  }, { source, seconds });
  console.log(JSON.stringify({ ...result, errors }));
  if (!result.cursor || !result.heartbeats || errors.length) throw new Error("Offline worker check failed");
} finally { await browser.close(); await server.close(); }
