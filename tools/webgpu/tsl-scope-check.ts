/**
 * TSL scope check (pitfall P33): dumps the generated shaders of ported node materials from the
 * live Ultra page and lists variables read outside the block that assigns them.
 *
 *   OUTPUT=<dir> MATERIALS=wg:sky,wg:iso-sky,wg2:terrain VIEWS=iso,possessed \
 *     <captures>/browser-slot.sh npx tsx --env-file=<file> tools/webgpu/tsl-scope-check.ts
 *   npx tsx tools/webgpu/tsl-scope-check.ts <shader.glsl> [...]   (check saved dumps)
 *
 * Env: QUERY (default renderer=webgpu-gl), QUALITY (high), LOAD_TIMEOUT_MS. Exits 1 on findings.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { enterPossession, waitForIslandPage } from "../bench/cloud-review-page";
import { findUnscopedReads } from "./tsl-scope";

const SHADER_TIMEOUT_MS = 20_000;

const report = (label: string, source: string) => {
  const findings = findUnscopedReads(source);
  console.log(`${label}: ${findings.length} unscoped variable(s)`);
  for (const finding of findings) console.log(`  ${finding.variable} line ${finding.line}: ${finding.text.slice(0, 140)}`);
  return findings.length;
};

const dumpShaders = (page: Page, name: string) => page.evaluate(({ name, timeout }) =>
  Promise.race([
    (globalThis as any).__webgpuSpike.shaderOf(name),
    new Promise(done => setTimeout(() => done(null), timeout))
  ]), { name, timeout: SHADER_TIMEOUT_MS }) as Promise<{ fragmentShader: string; vertexShader: string } | null>;

const checkLivePage = async () => {
  const output = resolve(process.env.OUTPUT ?? "tsl-scope-check");
  const materials = (process.env.MATERIALS ?? "wg:sky,wg:iso-sky,wg2:terrain").split(",");
  const views = (process.env.VIEWS ?? "iso,possessed").split(",");
  mkdirSync(output, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  let total = 0;
  try {
    const page = await browser.newPage({ viewport: { height: 600, width: 960 } });
    await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    const query = process.env.QUERY ?? "renderer=webgpu-gl";
    await page.goto(`${url}?quality=${process.env.QUALITY ?? "high"}&size=64&seed=123&cache=0&skipLogin=1&${query}`);
    await waitForIslandPage(page);
    const checked = new Set<string>();
    for (const view of views) {
      if (view === "possessed") await enterPossession(page);
      await page.waitForTimeout(1500);
      for (const name of materials) {
        if (checked.has(name)) continue;
        const shaders = await dumpShaders(page, name);
        if (shaders === null) continue;
        checked.add(name);
        const file = name.replace(/[^a-z0-9-]/gi, "_");
        writeFileSync(resolve(output, `${file}.vert.txt`), shaders.vertexShader);
        writeFileSync(resolve(output, `${file}.frag.txt`), shaders.fragmentShader);
        total += report(`${name} vertex`, shaders.vertexShader);
        total += report(`${name} fragment`, shaders.fragmentShader);
      }
    }
    for (const name of materials) if (!checked.has(name)) console.log(`${name}: not drawn in ${views.join("/")}`);
  } finally {
    await browser.close();
    await server.close();
  }
  return total;
};

const files = process.argv.slice(2);
const total = files.length > 0
  ? files.reduce((sum, file) => sum + report(file, readFileSync(file, "utf8")), 0)
  : await checkLivePage();
process.exitCode = total > 0 ? 1 : 0;
