import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { renderRaceHelmetIcons } from "./race-helmet-icon-renderer";
import type { EliteHelmetIconSource } from "./race-helmet-types";
import { resourcesPath } from "./resources-path";

/**
 * Registration helmets,256px: original four recipes or actual fitted elite GLBs for additions.
 * Select additions with --nations=indigenous,chinese,persian,maya; --out keeps preview PNGs separate.
 */
const OUTPUT = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? "assets/ui-icons/races");
const nations = (process.argv.find(arg => arg.startsWith("--nations="))?.slice(10)
  ?? "japanese,nubian,roman,viking").split(",");
const additions = new Set(["indigenous", "chinese", "persian", "maya"]);
assert(nations.every(nation => additions.has(nation) || ["japanese", "nubian", "roman", "viking"].includes(nation)));
const elites: Record<string, EliteHelmetIconSource> = {};
const selections: { body: string; manifestSha256: string; nation: string; path: string }[] = [];
const provenance = new Map<string, string>();
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const track = (path: string) => provenance.set(path, hash(path));
const preservedIcons = ["japanese", "nubian", "roman", "viking"].filter(nation => !nations.includes(nation))
  .map(nation => {
    const path = resolve(`assets/ui-icons/races/${nation}.png`);
    return { path, sha256: hash(path) };
  });
const pack = resolve("../island-of-settlers-worker-generation/game_ready/national-headgear-pilots");
for (const nation of nations.filter(nation => additions.has(nation))) {
  const manifestPath = resolve(pack, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const set = manifest.sets.find((item: { nation: string }) => item.nation === nation);
  const body = set?.bodies.find((item: { id: string }) => item.id === `${nation}-male-1`);
  assert(body, `Missing canonical elite helmet: ${nation}`);
  const relative = body.files[`${nation}-helmet-centurion`];
  assert(typeof relative === "string", `Missing elite headpiece path: ${nation}`);
  const file = resolve(pack, relative); track(file);
  selections.push({ body: body.id, manifestSha256: hash(manifestPath), nation, path: file });
  const metadataPath = resolve(dirname(file), "build.json"); track(metadataPath);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert(metadata.headFit, `Export the final ${nation} headFit frame before rendering its icon`);
  const elite = metadata.counts.find((piece: { id: string }) => piece.id === `${nation}-helmet-centurion`);
  assert.equal(elite?.glbSha256?.high, hash(file), `Elite frame/model hash mismatch: ${nation}`);
  elites[nation] = { ...metadata.headFit, url: `/workers/national-headgear-pilots/${relative}` };
  const bytes = readFileSync(file), gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  for (const image of gltf.images ?? []) if (image.uri && !image.uri.startsWith("data:"))
    track(resolve(dirname(file), decodeURIComponent(image.uri)));
}
const BLANK_PAGE = "race-helmet-render.html";

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.route(`**/${BLANK_PAGE}`, route =>
    route.fulfill({ body: "<!doctype html><html><body></body></html>", contentType: "text/html" }));
  await page.goto(`${url}${BLANK_PAGE}`);
  const icons = await page.evaluate(renderRaceHelmetIcons, { elites, nations });
  assert.deepEqual(Object.keys(icons).sort(), [...nations].sort());
  for (const [path, before] of provenance) assert.equal(hash(path), before, `Icon source changed: ${path}`);
  mkdirSync(OUTPUT, { recursive: true });
  for (const [name, data] of Object.entries(icons)) writeFileSync(`${OUTPUT}/${name}.png`, Buffer.from(data, "base64"));
  for (const icon of preservedIcons) assert.equal(hash(icon.path), icon.sha256, `Existing icon changed: ${icon.path}`);
  const review = resourcesPath("project-reviews", "national-headgear-current", "nation-icons", nations.join("_"));
  mkdirSync(review, { recursive: true });
  writeFileSync(resolve(review, "render.json"), JSON.stringify({ output: OUTPUT,
    generatedAt: new Date().toISOString(), nations, preservedIcons, selections,
    sources: [...provenance].map(([path, sha256]) => ({ path, sha256 })),
    framing: "Existing256pxstudio; yaw-.2, camera direction(.42,.3,1), radius1.92. "
      + "RestoredHead frame; complete silhouette centered/fitted to210px, matching original icon subject extents."
  }, null, 2));
  console.log(Object.keys(icons).join(", "));
} finally {
  await browser.close();
  await server.close();
}
