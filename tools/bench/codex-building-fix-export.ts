import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { nationalBuildingIconPath } from "../../src/render-common/buildings/building-icon-path";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { launchBrowser, startDevServer } from "./browser";
import { buildingAssetCodes, buildingAssetNations } from "./building-asset-targets";

// Example: npx tsx tools/bench/codex-building-fix-export.ts --out=/tmp/hq-review --ids=0 --nations=roman
// Individual GLBs are review artifacts, not replacements for the production multi-building libraries.
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const outputArgument = option("out"), idsArgument = option("ids"), nationsArgument = option("nations");
assert(outputArgument && isAbsolute(outputArgument), "Provide an absolute --out=/tmp/<new-directory>");
assert(idsArgument && nationsArgument, "Provide explicit --ids=0,18 and --nations=roman,...");
const output = resolve(outputArgument), tmp = realpathSync("/tmp"), parent = realpathSync(dirname(output));
assert(parent === tmp || (!relative(tmp, parent).startsWith("..") && !isAbsolute(relative(tmp, parent))),
  "Output parent must resolve inside /tmp");
assert(!existsSync(output), "Output directory must not already exist");
const codes = buildingAssetCodes(), allowedNations = buildingAssetNations();
const ids = idsArgument.split(",").map(value => {
  assert(/^\d+$/.test(value), `Invalid building id: ${value}`);
  const id = Number(value); assert(codes.includes(id), `Unknown building id: ${value}`); return id;
});
const nations = nationsArgument.split(",").map(value => {
  assert(allowedNations.includes(value as WorkerNation), `Unknown nation: ${value}`); return value as WorkerNation;
});
const levels = (option("levels") ?? "1,5").split(",").map(value => {
  assert(/^[1-5]$/.test(value), `Invalid level: ${value}`); return Number(value);
});
assert(new Set(ids).size === ids.length && new Set(nations).size === nations.length &&
  new Set(levels).size === levels.length, "Duplicate selection");
mkdirSync(output);

const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const write = (path: string, data: string | Buffer) => {
  const destination = join(output, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, data, { flag: "wx" });
  return { path, sha256: hash(data), bytes: Buffer.byteLength(data) };
};
// Include tracked and untracked inputs to detect concurrent changes while Vite evaluates recipes.
const fingerprint = () => {
  const roots = [
    "island-of-settlers-client/src/building-showcase",
    "island-of-settlers-client/src/render-common/buildings",
    "island-of-settlers-client/src/render-common/wares",
    "island-of-settlers-client/src/render-common/props",
    "island-of-settlers-client/src/render-common/content",
    "island-of-settlers-client/src/render-common/workers/worker-appearance.ts",
    "island-of-settlers-client/src/render-common/workers/worker-nation.ts",
    "island-of-settlers-client/src/renderers/three/buildings",
    "island-of-settlers-client/src/renderers/three/props",
    "island-of-settlers-client/src/renderers/three/roman-column-geometry.ts",
    "island-of-settlers-client/src/renderers/three/roman-column-decoration.ts",
    "island-of-settlers-client/src/renderers/three/sculpt-geometry.ts",
    "island-of-settlers-client/src/renderers/three/settlement/advanced-material-assets.ts",
    "island-of-settlers-client/tools/bench/codex-building-fix-export.ts",
    "island-of-settlers-client/tools/bench/building-asset-targets.ts",
    "island-of-settlers-client/tools/bench/building-export-animation-targets.ts",
    "island-of-settlers-client/tools/bench/building-export-normal-maps.ts",
    "island-of-settlers-client/tools/bench/building-export-texture-readiness.ts",
    "island-of-settlers-client/tools/bench/building-library-loader.ts",
    "island-of-settlers-client/tools/bench/main-building-icon-renderer.ts",
    "island-of-settlers-client/tools/bench/browser.ts",
    "island-of-settlers-client/tools/bench/chrome.ts",
    "island-of-settlers-shared/src/catalog"
  ];
  const repo = resolve("..");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...roots],
    { cwd: repo }).toString().split("\0").filter(Boolean).sort();
  const digest = createHash("sha256");
  const hashes: Record<string, string> = {};
  for (const file of files) {
    hashes[file] = hash(readFileSync(join(repo, file)));
    digest.update(file); digest.update("\0"); digest.update(hashes[file]!);
  }
  return { files: files.length, sha256: digest.digest("hex"), hashes };
};
const started = new Date().toISOString(), before = fingerprint();
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve("..") }).toString().trim();
const artifacts: unknown[] = [], reports: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  const reference = await server.ssrLoadModule("/src/render-common/buildings/building-geometry-reference.ts");
  const catalog = await server.ssrLoadModule("/src/render-common/buildings/building-catalog.ts");
  const shared = await server.ssrLoadModule("@shared/catalog");
  for (const id of ids) {
    const key = shared.buildingEntry(id).key as string;
    assert(/^[a-zA-Z0-9_-]+$/.test(key), `Unsafe catalog key: ${key}`);
    const geometry = reference.computeBuildingGeometry(catalog.getBuildingDefinition(id));
    artifacts.push(write(`navigation/${key}/geometry.json`, `${JSON.stringify(geometry, null, 2)}\n`));
    for (const nation of nations) {
      const levels = [1, 2, 3, 4, 5].map(level => reference.computeBuildingNavigationLevel(id, nation, level));
      const texts = levels.map(level => JSON.stringify(level));
      const deduped = levels.map((level, index) => {
        const first = texts.indexOf(texts[index]!); return first < index ? first + 1 : level;
      });
      artifacts.push(write(`navigation/${key}/navigation/${nation}.json`, `${JSON.stringify({ levels: deduped })}\n`));
    }
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const nation of nations) for (const quality of ["high", "minimal"]) {
    await page.setViewportSize({ width: 900, height: 750 });
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1&building=${ids[0]}`,
      { timeout: 120000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    for (const id of ids) for (const level of levels) {
      const result = await page.evaluate(async ({ id, level, nation }) => {
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null); preview.selectBuilding(id, level);
        await (window as any).__buildingResidentReady;
        const model = preview.model();
        model.update(0, { construction: 1, door: 0, working: false });
        preview.renderer.render(preview.scene, preview.camera);
        const identity = { id: model.root.userData.buildingId ?? (model.root.userData.monument ? 7 : -1),
          nation: model.root.userData.nation, triangles: model.triangles(false),
          clips: model.root.animations.map((clip: any) => clip.name).sort() };
        if (identity.id !== id || identity.nation !== nation) throw new Error("Showcase selected incorrect model");
        const normalMaps = await import(/* @vite-ignore */ String("/tools/bench/building-export-normal-maps.ts"));
        const buffer: ArrayBuffer = await normalMaps.withBuildingExportNormalMaps(() => preview.exportModel());
        const { GLTFLoader } = await import(/* @vite-ignore */ String("/tools/bench/building-library-loader.ts"));
        const { PropertyBinding } = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const loaded = await new GLTFLoader().parseAsync(buffer, "");
        const clips = loaded.animations.map((clip: any) => clip.name).sort();
        if (JSON.stringify(clips) !== JSON.stringify(identity.clips)) throw new Error("GLB clip mismatch");
        let roots = 0, meshes = 0, tracks = 0;
        loaded.scene.traverse((node: any) => {
          if (node.userData.nation === nation && node.userData.buildingId === id) roots++;
          if (node.isMesh) meshes++;
        });
        for (const clip of loaded.animations) for (const track of clip.tracks) {
          const binding = PropertyBinding.parseTrackName(track.name);
          if (!PropertyBinding.findNode(loaded.scene, binding.nodeName))
            throw new Error(`Missing GLB animation target ${clip.name}/${track.name}`);
          tracks++;
        }
        if (roots !== 1 || meshes === 0) throw new Error(`Unexpected loaded model roots/meshes: ${roots}/${meshes}`);
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(",")[1]!);
          reader.onerror = () => reject(reader.error); reader.readAsDataURL(new Blob([buffer]));
        });
        return { encoded, identity, roundtrip: { clips, meshes, roots, tracks } };
      }, { id, level, nation });
      artifacts.push(write(`models/${nation}/${id}-level-${level}-${quality}.glb`, Buffer.from(result.encoded, "base64")));
      const preview = await page.screenshot();
      artifacts.push(write(`previews/${nation}/${id}-level-${level}-${quality}.png`, preview));
      reports.push({ level, quality, ...result.identity, roundtrip: result.roundtrip });
    }
  }
  await page.setViewportSize({ width: 240, height: 180 });
  for (const nation of nations) {
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=high&sample=1&building=${ids[0]}`,
      { timeout: 120000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    for (const id of ids) {
      await page.evaluate(async id => {
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null); preview.selectBuilding(id, 1);
        await (window as any).__buildingResidentReady;
        preview.model().update(0, { construction: 1, door: 0, working: false });
        preview.renderer.render(preview.scene, preview.camera);
        await new Promise<void>(resolve => requestAnimationFrame(() => {
          preview.renderer.render(preview.scene, preview.camera); requestAnimationFrame(() => resolve());
        }));
      }, id);
      artifacts.push(write(`icons/${nationalBuildingIconPath(nation, id)}`, await page.screenshot()));
      if (nation === "roman" && id === 0) {
        const encoded = await page.evaluate(async () => {
          const { renderMainBuildingIcon } = await import(
            /* @vite-ignore */ String("/tools/bench/main-building-icon-renderer.ts"));
          return renderMainBuildingIcon();
        });
        artifacts.push(write("icons/assets/ui-icons/roman-buildings.png", Buffer.from(encoded, "base64")));
      }
    }
  }
  assert.deepEqual(errors, [], "Browser errors during export");
  const after = fingerprint();
  const changed = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])]
    .filter(file => before.hashes[file] !== after.hashes[file]);
  assert.equal(changed.length, 0, `Source inputs changed during export; discard artifacts and rerun: ${changed.join(", ")}`);
  const sourceFingerprint = { files: before.files, sha256: before.sha256,
    scope: "building, ware, prop, showcase, export helper and shared catalog sources; excludes asset files and nested repositories" };
  write("report.json", `${JSON.stringify({ started, finished: new Date().toISOString(), gitHead, sourceFingerprint,
    selection: { ids, nations, levels, qualities: ["high", "minimal"] }, artifacts, reports, errors,
    note: "Individual GLBs are staged review artifacts, not production libraries. Icons use level 1; navigation covers levels 1-5. No tests or gameplay acceptance were performed."
  }, null, 2)}\n`);
  console.log(`Staged ${reports.length} models in ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
