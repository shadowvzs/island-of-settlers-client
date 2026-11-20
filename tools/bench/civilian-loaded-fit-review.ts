import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { launchBrowser, startDevServer } from "./browser";

const { values: options } = parseArgs({ options: { bodies: { type: "string" }, "foot-pilots": { type: "boolean" },
  modes: { type: "string" },
  "out-dir": { type: "string" }, "pilot-folder": { type: "string" }, pilots: { type: "boolean" },
  quality: { type: "string" }, "run-id": { type: "string" }, waist: { type: "boolean" } } });
const modes = (options.modes ?? "walk,carry_back,carry_shoulder").split(",");
if (modes.some(mode => !["walk", "carry_back", "carry_shoulder", "front", "bucket"].includes(mode)))
  throw new Error("Unknown civilian review mode");
const output = resolve(options["out-dir"] ?? process.env.OUT_DIR ??
  `../resources/project-reviews/roman-loaded-feet-2026-11-03/${options["run-id"] ?? process.env.RUN_ID ?? "native"}`);
const assetRoot = resolve("../island-of-settlers-worker-generation/game_ready");
const bodies = (options.bodies ?? process.env.BODIES ?? "roman-man-grey,roman-woman-grey,roman-woman-olive,roman-woman-pinafore").split(",");
const explicitPilotFolder = options["pilot-folder"] ?? process.env.CIVILIAN_PILOT_FOLDER;
const pilotFolder = explicitPilotFolder ?? "civilian-composition-pilots";
if (!pilotFolder || pilotFolder.includes("..") || pilotFolder.includes("/"))
  throw new Error("Choose a direct game_ready civilian pilot folder");
const { server, url } = await startDevServer(), browser = await launchBrowser(true);
const records: unknown[] = [];
await mkdir(output, { recursive: true });
try {
  for (const quality of (options.quality ?? process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/civilian-fit.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.goto(`${url}civilian-fit.html`);
    await page.evaluate(async ({ assetRoot, minimal, motionPilots }) => {
      const { createArmourFitScene } = await import(/* @vite-ignore */ String("/tools/bench/armour-fit-scene.ts"));
      (window as any).fitReview = createArmourFitScene(assetRoot, minimal, false, motionPilots);
    }, { assetRoot, minimal: quality === "minimal", motionPilots: options["foot-pilots"] ?? process.env.FOOT_PILOTS === "1" });
    for (const variant of bodies) {
      const nation = variant.split("-")[0] as WorkerNation;
      const staged = Boolean(explicitPilotFolder)
        || (options.pilots ?? process.env.PILOTS === "1") && variant === "roman-man-grey";
      const result = await page.evaluate(async ({ modes, nation, pilotFolder, staged, variant, waist }) =>
        (window as any).fitReview.captureCivilian(nation, variant, staged, pilotFolder, { modes, waist }),
      { modes, nation, pilotFolder, staged, variant, waist: options.waist });
      for (const image of result.images)
        await writeFile(`${output}/${variant}-${quality}-${image.name}.png`, Buffer.from(image.png, "base64"));
      records.push({ variant, quality, staged, heldProps: result.heldProps });
      console.log(`${variant}/${quality}`);
    }
    await page.evaluate(() => (window as any).fitReview.dispose()); await page.close();
    if (errors.length) throw new Error(errors.join("\n"));
  }
  await writeFile(`${output}/review.json`, JSON.stringify({ modes, pilotFolder, waist: options.waist, records }, null, 2));
} finally { await browser.close(); await server.close(); }
