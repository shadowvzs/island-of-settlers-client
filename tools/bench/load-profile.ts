import { launchBrowser, startDevServer } from "./browser";

/**
 * Load profile: opens `?profile=1` (plus EXTRA query, e.g. "cache=1"), waits for the first
 * frame and prints the stage table (window.__loadProfile). RUNS=n repeats the load (the last
 * run of a cached island shows the warm cache). BASE_URL measures a running
 * server (e.g. `vite preview`) instead of a dev server. Refuses software WebGL numbers.
 */
const runs = Number(process.env.RUNS ?? 1);
const extra = process.env.EXTRA ? `&${process.env.EXTRA}` : "";

type Row = Record<string, number | string>;

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

const main = async () => {
  const dev = process.env.BASE_URL ? null : await startDevServer();
  const url = process.env.BASE_URL ?? dev!.url;
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { height: 900, width: 1600 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  /** Other agents' edits can reload the dev page mid-run: retry a few times. */
  const loadProfile = async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await page.goto(`${url}?profile=1${extra}`);
        await page.waitForFunction(() => window.__loadProfile !== undefined, null, {
          timeout: 180_000
        });
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        console.log(`retry: ${(error as Error).message.split("\n")[0]}`);
      }
    }
  };
  for (let run = 0; run < runs; run += 1) {
    await loadProfile();
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    if (SOFTWARE_GL.test(gpu)) {
      console.log(`SKIPPED run ${run}: software WebGL (${gpu})`);
      continue;
    }
    const rows = (await page.evaluate(() => window.__loadProfile)) as Row[];
    const firstFrames = await page.evaluate(async () => {
      const intervals: number[] = [];
      let previous = performance.now();
      for (let frame = 0; frame < 90; frame += 1) {
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        intervals.push(now - previous);
        previous = now;
      }
      const memory = (performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      }).memory;
      intervals.sort((a, b) => a - b);
      return {
        heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
        maxFrameMs: Math.round(intervals.at(-1)! * 10) / 10,
        medianFrameMs: Math.round(intervals[45]! * 10) / 10,
        p95FrameMs: Math.round(intervals[85]! * 10) / 10
      };
    });
    console.log(`\n== run ${run + 1}/${runs} (${gpu})`);
    for (const row of rows) {
      const name = String(row.stage).padEnd(48);
      console.log(`${name} ${String(row["start ms"]).padStart(6)} ${String(row.ms).padStart(8)}`);
    }
    console.log("first 90 frames", JSON.stringify(firstFrames));
  }
  await browser.close();
  await dev?.server.close();
};

await main();
