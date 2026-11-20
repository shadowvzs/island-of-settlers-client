import { launchBrowser, startDevServer } from "./browser";
import { emitBenchJson } from "./bench-json";
import { centreOn, openDecorReviewPage, settleDecorations } from "./decor-review-session";

/**
 * Ground pass cost (GROUND-PALETTE, TOOL-4): iso view at `ZOOM` (default 1.2, normal gameplay distance) over
 * `SPOT` ("beach": seed 123 shore x 9 z 78; "mountain": rock/mine x 50 z 64), `QUALITY` preset (default high).
 * Samples the pass profiler (`?passes=1`) for `SECONDS` and prints the session's frame GPU ms and the GPU ms of
 * the `world` pass (terrain + vegetation) and the `refraction` pass (the seabed ground). The extra `QUERY` is
 * appended to the island query (for example `sand=white`). The bench runs the build of its working folder, so
 * TOOL-4 can run it against a base checkout by absolute path.
 * Usage (from island-of-settlers-client, in a browser slot): npx tsx tools/bench/ground-frame-bench.ts
 */
const QUALITY = process.env.QUALITY ?? "high";
const ZOOM = Number(process.env.ZOOM ?? 1.2);
const SECONDS = Number(process.env.SECONDS ?? 6);
const SPOTS = { beach: { x: 9, z: 78 }, mountain: { x: 50, z: 64 } } as const;
const SPOT = SPOTS[(process.env.SPOT ?? "beach") as keyof typeof SPOTS] ?? SPOTS.beach;
const EXTRA = process.env.QUERY ? `&${process.env.QUERY}` : "";
const QUERY = `size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1&passes=1${EXTRA}`;

interface PassReport { cpuMs?: number; gpuMs?: number | null; name: string; }
interface SessionReport { frameGpuMs: number | null; frames: number; passes: PassReport[]; }

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const errors: string[] = [];
  const page = await openDecorReviewPage(browser, url, QUALITY, errors, QUERY);
  await centreOn(page, SPOT, ZOOM);
  await settleDecorations(page, 120);
  await page.evaluate(() => (globalThis as { __frameProfiler?: { resetSession: () => void } })
    .__frameProfiler?.resetSession());
  await page.waitForTimeout(SECONDS * 1000);
  const report = await page.evaluate(() => (globalThis as unknown as {
    __frameProfiler: { sessionReport: () => SessionReport };
  }).__frameProfiler.sessionReport());
  const pass = (name: string) => report.passes.find(entry => entry.name === name)?.gpuMs ?? Number.NaN;
  const record = {
    frameGpuMs: report.frameGpuMs ?? Number.NaN,
    frames: report.frames,
    quality: QUALITY,
    refractionGpuMs: pass("refraction"),
    worldGpuMs: pass("world")
  };
  console.log(`ground ${QUALITY}: frame ${record.frameGpuMs.toFixed(3)} ms, world ${record.worldGpuMs.toFixed(3)} ms, ` +
    `refraction ${record.refractionGpuMs.toFixed(3)} ms (${record.frames} frames)${errors.length ? `, errors ${errors.join(" | ")}` : ""}`);
  emitBenchJson({ ground: record });
} finally {
  await browser.close();
  await server.close();
}
