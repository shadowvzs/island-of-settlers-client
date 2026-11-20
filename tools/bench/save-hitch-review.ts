import { readFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

/**
 * Save hitch (D3): frame times while the game saves through the real path (a manual flush: a held frame captures,
 * the next held frame reloads the snapshot in place), against the same island idling. Optionally on a staged save and
 * with Chrome's CPU throttling (phone emulation).
 *
 *   npx tsx tools/bench/save-hitch-review.ts [rounds] [--save game.json] [--cpu 1,4] [--quality minimal]
 *     [--no-reload]   (baseline: the same saves without the in-place reload)
 *     [--journal off]  (baseline: clone the whole live world per save instead of the S06 journal patch)
 */
const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const rounds = Number(process.argv[2]?.startsWith("--") ? 5 : process.argv[2] ?? 5);
const saveFile = argument("--save", "");
const cpuRates = argument("--cpu", "1").split(",").map(Number);
const quality = argument("--quality", "minimal");
const reload = !process.argv.includes("--no-reload");
const journal = argument("--journal", "on") !== "off";

const MEASURE = `
    const app = window.__settlement;
    const reloads = [], captures = [];
    const profiling = typeof window.__saveStageProfileRead === "function";
    if (profiling) window.__saveStageProfile = true;
    const stageStats = (rounds) => {
      const values = new Map();
      for (const round of rounds) for (const sample of round ?? []) {
        const list = values.get(sample.name) ?? []; list.push(sample.ms); values.set(sample.name, list);
      }
      const at = (entries, fraction) => entries[Math.min(entries.length - 1,
        Math.floor(entries.length * fraction))];
      return Object.fromEntries([...values].map(([name, entries]) => {
        entries.sort((a, b) => a - b);
        return [name, { count: entries.length,
          p50: Math.round(at(entries, .5) * 100) / 100,
          p95: Math.round(at(entries, .95) * 100) / 100,
          max: Math.round(entries.at(-1) * 100) / 100 }];
      }));
    };
    const timed = (owner, name, into) => {
      const original = owner[name].bind(owner);
      owner[name] = (...args) => { const started = performance.now(); const value = original(...args);
        into.push(performance.now() - started); return value; };
    };
    if (!withReload) app.simulation.reloadSnapshot = () => ({ ok: true });
    timed(app.simulation, "reloadSnapshot", reloads);
    timed(app.simulation, "saveState", captures);
    const observe = async (action) => {
      const frames = [];
      let last = performance.now(), running = true;
      const tick = (time) => { frames.push(time - last); last = time; if (running) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await action();
      await new Promise(resolve => setTimeout(resolve, 600));
      running = false;
      const sorted = [...frames].sort((a, b) => a - b);
      return { longest: sorted.at(-1), median: sorted[Math.floor(sorted.length / 2)],
        over50: frames.filter(frame => frame > 50).length };
    };
    const idle = [], saves = [], stages = [];
    for (let round = 0; round < count; round++) {
      idle.push(await observe(() => new Promise(resolve => setTimeout(resolve, 900))));
      if (profiling) window.__saveStageProfileClear?.();
      saves.push(await observe(() => app.saving.flush("manual")));
      if (profiling) stages.push(window.__saveStageProfileRead?.() ?? []);
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const round2 = (value) => Math.round(value * 100) / 100;
    return { buildings: app.simulation.buildings().length, actors: app.simulation.frames().length,
      captureMs: round2(median(captures)), reloadMs: round2(median(reloads)), reloads: reloads.length,
      idleFrameMedian: round2(median(idle.map(entry => entry.median))),
      idleLongest: round2(median(idle.map(entry => entry.longest))),
      saveLongest: round2(median(saves.map(entry => entry.longest))),
      saveLongestMax: round2(Math.max(...saves.map(entry => entry.longest))),
      saveFramesOver50: saves.reduce((sum, entry) => sum + entry.over50, 0),
      saveStageStatsMs: profiling ? stageStats(stages) : undefined };
`;
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const rate of cpuRates) {
    const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
    await page.routeWebSocket("**/*", () => {});
    if (!journal) await page.addInitScript("window.__saveJournal = false");
    page.on("pageerror", error => console.error(`page error: ${error.message}`));
    const query = saveFile ? "skipLogin=1" : "seed=4242";
    // Pinned clock: the staged save resumes without an offline catch-up.
    if (saveFile) await stageStartupSave(page, url, readFileSync(saveFile, "utf8"), true);
    await page.goto(`${url}?quality=${quality}&cache=0&${query}`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 300_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.waitForTimeout(3000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.waitForTimeout(2000);
    // Page source as a string: tsx would otherwise inject its `__name` helper into the page.
    const result = await page.evaluate<Record<string, unknown>>(`(async (count, withReload) => {${MEASURE}})(${rounds}, ${reload})`);
    console.log(JSON.stringify({ cpu: rate, quality, reload, journal, save: saveFile.split("/").pop() || "seed 4242", ...result }));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
