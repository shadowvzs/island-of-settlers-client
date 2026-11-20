import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/** Camera bookmarks: name -> "x,z,zoom" (seed 1234 island). Extend as the island evolves. */
const BOOKMARKS: Record<string, string> = {
  overview: "128,128,0.1",
  start: "164,212,1",
  coast: "170,218,1.6",
  closeup: "166,214,2.4",
  forest: "168,200,2.2"
};

/** Bookmarks also captured with the perspective camera (C key). */
const CINEMATIC = new Set(["start", "coast", "closeup", "forest"]);

const only = process.argv[2];
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/screenshots";

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
  page.on("console", (message) => {
    if (message.type() !== "log" || process.env.VERBOSE)
      console.log("[browser]", message.type(), message.text().slice(0, 600));
  });
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const compile = proto.compileShader;
    const link = proto.linkProgram;
    proto.linkProgram = function (program) {
      link.call(this, program);
      if (!this.getProgramParameter(program, this.LINK_STATUS)) {
        console.error("GLSL link error:", this.getProgramInfoLog(program));
      }
    };
    proto.compileShader = function (shader) {
      compile.call(this, shader);
      if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) {
        console.error("GLSL compile error:", this.getShaderInfoLog(shader));
      }
    };
  });
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  for (const [name, view] of Object.entries(BOOKMARKS)) {
    if (only && only !== name) continue;
    await page.goto(`${url}?view=${view}`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    if (CINEMATIC.has(name)) {
      await page.keyboard.press("c");
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(outDir, `${name}-cinematic.png`) });
    }
    const stats = await page.locator(".stats-overlay pre").textContent();
    console.log(file, "\n", stats?.replaceAll("\n", " | "));
  }
  await browser.close();
  await server.close();
};

await main();
