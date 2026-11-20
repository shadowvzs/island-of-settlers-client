import { type BrowserEngine, launchEngine, startDevServer } from "../bench/browser";
import { runMathProbe } from "./math-probe";

/**
 * D4.6: do Math.hypot / trig / exp / log give the same float64 in Node (V8), Chrome, Firefox and WebKit, and does
 * the simulation's deterministic `DMath`? Prints, per engine and function, how many of the probe's samples differ
 * from Node's and the largest difference in ulps (every `deterministic.*` must be absent).
 *
 *   PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npx tsx tools/analysis/math-engine-compare.ts [engines]
 */
const PROBE_MODULE = "/tools/analysis/math-probe.ts";
const ENGINES = (process.argv[2] ?? "chromium,firefox,webkit").split(",") as BrowserEngine[];

const runInEngine = async (engine: BrowserEngine, url: string) => {
  const browser = await launchEngine(engine);
  try {
    const page = await browser.newPage();
    await page.goto(new URL("@vite/client", url).href);
    return await page.evaluate(async (modulePath) => {
      const module = await import(/* @vite-ignore */ modulePath) as typeof import("./math-probe");
      return { probe: module.runMathProbe(), userAgent: navigator.userAgent };
    }, PROBE_MODULE);
  } finally {
    await browser.close();
  }
};

const toBigInts = (hex: string) => {
  const bytes = new Uint8Array(hex.match(/../g)!.map(byte => parseInt(byte, 16)));
  return new BigInt64Array(bytes.buffer);
};

const compareFunction = (expected: string, actual: string) => {
  const left = toBigInts(expected), right = toBigInts(actual);
  let differing = 0, maxUlps = 0n;
  for (let index = 0; index < left.length; index++) {
    const distance = left[index]! > right[index]! ? left[index]! - right[index]! : right[index]! - left[index]!;
    if (!distance) continue;
    differing++;
    if (distance > maxUlps) maxUlps = distance;
  }
  return { differing, maxUlps: Number(maxUlps) };
};

const node = runMathProbe();
const { server, url } = await startDevServer({ unlockAll: false });
const report: Record<string, unknown> = {};
try {
  for (const engine of ENGINES) {
    const { probe, userAgent } = await runInEngine(engine, url);
    const functions = Object.fromEntries(Object.keys(node).map(name =>
      [name, compareFunction(node[name]!, probe[name]!)] as const).filter(([, result]) => result.differing > 0));
    report[engine] = { differingFunctions: functions, userAgent };
  }
} finally {
  await server.close();
}
console.log(JSON.stringify({ node: process.version, report }, null, 2));
