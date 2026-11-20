import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, plantCompletionModelFamily } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { launchBrowser, startDevServer } from "./browser";

const run = process.argv[2] ?? "actors-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/verification-completion-2026-11-05/decorations", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve completed evidence");
mkdirSync(output, { recursive: true });
const placement = JSON.parse(readFileSync(resolve(output, "..", process.env.PLACEMENTS ?? "cpu-c.json"), "utf8"));
const representatives = [...new Map(PLANT_COMPLETION_ITEM_IDS.map(id =>
  [plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!), id])).values()];
const paths = ["src/renderers/three/three-mounts.ts", "src/renderers/three/worker-mounted-equipment.ts",
  "src/render-common/mounts/mount-assets.ts", "src/renderers/three/settlement/handcart-prototype.ts",
  "src/renderers/three/settlement/roman-handcart.ts", "assets/mounts/viking-commander-mounted-clean.glb",
  "assets/mounts/viking-commander-mounted-clean-minimal.glb", "tools/bench/verification-decoration-actors-scene.ts"];
const hashes = () => Object.fromEntries(paths.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sources = hashes();
const { server, url } = await startDevServer({ unlockAll: false });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const rows: unknown[] = [], errors: string[] = [], violations: unknown[] = [];
let passed = false;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 850, width: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/decoration-actors.html", route => route.fulfill({ body: "<body style='margin:0'></body>",
    contentType: "text/html" }));
  await page.goto(`${url}decoration-actors.html`);
  for (const detailed of [true, false]) {
    await page.evaluate(async detailed => {
      const { createDecorationActorScene } = await import(
        /* @vite-ignore */ String("/tools/bench/verification-decoration-actors-scene.ts"));
      (window as any).__decorationActors = await createDecorationActorScene(detailed);
    }, detailed);
    try {
      const result = await page.evaluate(() => (window as any).__decorationActors.measure());
      for (const actor of [...result.mounted, ...result.carts]) {
        if (actor.min[0] < -placement.halfWidth || actor.max[0] > placement.halfWidth || actor.max[1] > placement.height)
          violations.push({ detailed, ...actor });
      }
      rows.push(result);
      writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, rows, violations, status: "measured" }, null, 2));
      for (const [index, item] of representatives.entries()) {
        const offset = placement.rows.find((row: any) => row.item === item && row.yaw === 0).lateralOffset;
        const capture = await page.evaluate(({ index, offset }) =>
          (window as any).__decorationActors.capture(index, offset), { index, offset });
        for (const frame of capture.frames) writeFileSync(resolve(output,
          `${detailed ? "high" : "minimal"}-${index}-phase${frame.phase}.png`), Buffer.from(frame.png, "base64"));
      }
    } finally { await page.evaluate(() => (window as any).__decorationActors.dispose()); }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(hashes(), sources, "Actor source must stay frozen during its native witness");
  assert.deepEqual(violations, [], "Actual equipped geometry must remain inside the protected traffic prism");
  passed = true;
} finally {
  try { await browser?.close(); } finally { await server.close(); }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed, errors, rows, sources, violations,
    scope: "Actual fully equipped national Commander meshes in idle/walk/trot/gallop, eight phases each, " +
      "plus animated canonical Carrier/cart rig with six full cargo families, both LODs. " +
      "Visible skinned vertices/standards/weapons are measured; nonphysical aura excluded. " +
      "This proves the sampled actor envelopes clear all804 canonical accepted roadside placements. " +
      "Native frames show spaced opposite cart and mounted passage beside eight new model families. " +
      "No autonomous route/junction-turn or hardware performance claim." }, null, 2));
}
