import { launchBrowser, startDevServer } from "./browser";
import { emitBenchJson } from "./bench-json";
import { centreOn, type LiveWindow, openDecorReviewPage, settleDecorations } from "./decor-review-session";

/**
 * Frame cost over a dense bush / sapling patch (seed 123, around x 91 z 33): iso view at `ZOOM` (default 2.6,
 * close: every prop is a 3D mesh), `QUALITY` preset (default minimal). Samples the pass profiler (`?passes=1`)
 * for `SECONDS` and prints frame GPU / CPU ms, prop triangles and draw calls (BENCH_JSON for TOOL-4).
 * Usage (from island-of-settlers-client, in a browser slot): npx tsx tools/bench/foliage-frame-bench.ts
 */
const QUALITY = process.env.QUALITY ?? "minimal";
const ZOOM = Number(process.env.ZOOM ?? 2.6);
const SECONDS = Number(process.env.SECONDS ?? 6);
const PATCH = { x: 91, z: 33 };
/** EXTRA_QUERY appends page parameters (e.g. "&season=autumn" for the seasons-1 A/B). */
const QUERY = "size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1&passes=1&passProfile=1" +
  (process.env.EXTRA_QUERY ?? "");

const readNumber = (text: unknown, pattern: RegExp) => {
  const match = typeof text === "string" ? pattern.exec(text) : null;
  return match ? Number(match[1]) : Number.NaN;
};

const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const errors: string[] = [];
  const page = await openDecorReviewPage(browser, url, QUALITY, errors, QUERY);
  await centreOn(page, PATCH, ZOOM);
  await settleDecorations(page, 120);
  const samples: { cpu: number; gpu: number; props: number }[] = [];
  for (let second = 0; second < SECONDS; second++) {
    await page.waitForTimeout(1000);
    const details = await page.evaluate(() => (window as LiveWindow).__profileDetails as Record<string, unknown>);
    samples.push({
      cpu: readNumber(details?.profileFrame, /cpu ([\d.]+)/),
      gpu: readNumber(details?.profileFrame, /gpu ([\d.]+)/),
      props: Number(details?.propTriangles ?? Number.NaN)
    });
  }
  const stats = await page.evaluate(() => (window as LiveWindow).__decorLive.renderer.getStats().details);
  const record = {
    cpuMs: median(samples.map(sample => sample.cpu)),
    gpuMs: median(samples.map(sample => sample.gpu)),
    propTriangles: Number(stats.propTriangles ?? median(samples.map(sample => sample.props))),
    quality: QUALITY
  };
  console.log(`foliage frame ${QUALITY}: gpu ${record.gpuMs} ms, cpu ${record.cpuMs} ms, ` +
    `prop triangles ${record.propTriangles}${errors.length ? `, errors ${errors.length}` : ""}`);
  emitBenchJson(record);
} finally {
  await browser.close();
  await server.close();
}
