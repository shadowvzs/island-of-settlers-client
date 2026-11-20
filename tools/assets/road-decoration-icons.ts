import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { decorationEntry } from "@shared/catalog";

import { ROAD_DECORATION_ITEM_DEFINITIONS, roadDecorationItemsTagged }
  from "../../../island-of-settlers-shared/src/road-decoration-items";
import { isPlantCompletionAsset, plantCompletionModelFamily } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { ornamentalPlantArtReady, ornamentalPlantModel } from "../../../island-of-settlers-shared/src/road-plant-models";
import { BAMBOO_CONTENT_IDS } from "../../src/render-common/plants/bamboo-grove-species";
import { launchBrowser, startDevServer } from "../bench/browser";
import { catalogIconFile } from "./catalog-asset-files";

/** The catalog icon file of one decoration finish (`decoration:*` `icon`). */
const iconFile = (item: { decoration: string; finish: string }) =>
  catalogIconFile(decorationEntry(item.decoration)!, { finish: item.finish });
/** Actual transparent model icons; geometry/finish is identical to the placement renderer. */
const output = dirname(iconFile(Object.values(ROAD_DECORATION_ITEM_DEFINITIONS)[0]!));
const completionOnly = process.argv.includes("--plant-completion");
const completionFamily = process.argv.find(argument => argument.startsWith("--plant-family="))?.split("=")[1];
const integratedPlants = process.argv.includes("--integrated-plants") || process.argv.includes("--approved-plants");
const additiveArches = process.argv.includes("--additive-arches");
const additiveStructures = process.argv.includes("--additive-structures") || additiveArches;
const peachOnly = process.argv.includes("--peach");
const elmOnly = process.argv.includes("--elm");
const woodenLanternsOnly = process.argv.includes("--wooden-lanterns");
const wisteriaTreesOnly = process.argv.includes("--wisteria-trees");
const gardenTreesOnly = process.argv.includes("--roman-garden-trees");
const romanColumnsOnly = process.argv.includes("--roman-columns");
const climbersOnly = process.argv.includes("--climbers");
const willowOnly = process.argv.includes("--willow");
const mapleOnly = process.argv.includes("--maple");
const bambooOnly = process.argv.includes("--bamboo");
const BAMBOO_ICON_CONTENT: ReadonlySet<string> = new Set([...BAMBOO_CONTENT_IDS, "japanese-bamboo-stand"]);
const CLIMBER_ITEMS = roadDecorationItemsTagged("climber"), ADDITION_ITEMS = roadDecorationItemsTagged("addition");
const items = Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS).filter(([id, item]) => {
  if (completionOnly) return item.plant && isPlantCompletionAsset(item.plant) &&
    (!completionFamily || plantCompletionModelFamily(item.plant) === completionFamily);
  if (bambooOnly) return BAMBOO_ICON_CONTENT.has(item.decoration);
  if (willowOnly) return item.plant && ornamentalPlantModel(item.plant) === "willow-tree";
  if (mapleOnly) return item.plant && ornamentalPlantModel(item.plant) === "maple-tree";
  if (climbersOnly) return Object.hasOwn(CLIMBER_ITEMS, id);
  if (romanColumnsOnly) return item.decoration === "roman-doric-column" || item.decoration === "roman-ionic-column";
  if (gardenTreesOnly) return item.plant && !item.plant.potted &&
    (item.plant.species === "compact-willow" && item.plant.form === "standalone" ||
      item.plant.species === "columnar-cypress" && item.plant.form === "roadside");
  if (wisteriaTreesOnly) return ["wisteria-tree-0", "wisteria-tree-1", "wisteria-tree-2"].includes(item.decoration);
  if (woodenLanternsOnly) return item.decoration.endsWith("-wooden-lantern");
  if (elmOnly) return item.plant?.species === "bonsai-maple" && item.plant.potted;
  if (peachOnly) return item.plant?.species === "pink-peach" && item.plant.form === "standalone" && !item.plant.potted;
  if (additiveStructures) return Object.hasOwn(ADDITION_ITEMS, id) &&
    (!additiveArches || item.category === "arches");
  if (integratedPlants) return item.plant && ornamentalPlantArtReady(item.plant);
  return item.shopAvailable;
})
  .map(([id, definition]) => ({ id, ...definition }));
assert(items.length > 0, "No model icons matched the requested cohort/family");
if (completionOnly && !completionFamily) assert.equal(items.length, 201);
if (completionFamily === "catalog-flowering") assert.equal(items.length, 30);
const protectedIcons = completionOnly ? Object.values(ROAD_DECORATION_ITEM_DEFINITIONS)
  .filter(item => item.shopAvailable && (!item.plant || !isPlantCompletionAsset(item.plant)))
  .map(iconFile).filter(existsSync) : [];
const iconHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const protectedIconHashes = Object.fromEntries(protectedIcons.map(path => [path, iconHash(path)]));
const completionSources = completionOnly ? [
  ...["src/render-common/plants", "src/renderers/three/plants"].flatMap(directory =>
    readdirSync(directory).filter(file => {
      if (!file.endsWith(".ts")) return false;
      // The early30 export need not freeze unrelated families still receiving their art corrections.
      if (completionFamily === "catalog-flowering" && file.startsWith("catalog-"))
        return file.startsWith("catalog-flowering") || file === "catalog-plant-clearance.ts";
      return true;
    }).map(file => `${directory}/${file}`)),
  "src/render-common/plants/ornamental-plant-clearance.ts",
  "src/renderers/three/plants/ornamental-decoration-profile.ts",
  "src/renderers/three/road-decoration-asset-loader.ts", "src/renderers/three/road-decoration-templates.ts",
  "src/renderers/three/settlement/three-road-decorations.ts", "tools/assets/road-decoration-icons.ts",
  "../island-of-settlers-shared/src/road-plant-completion.ts",
  "../island-of-settlers-shared/src/road-plant-models.ts",
  "../island-of-settlers-shared/src/road-decoration-items.ts"
] : [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const hashSources = () => Object.fromEntries(completionSources.map(path => [path, hash(readFileSync(path))]));
const sourceHashes = hashSources(), receipts: unknown[] = [];
mkdirSync(output, { recursive: true });
const overview: Record<string, unknown> = {};
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/road-decoration-icons.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
  await page.goto(`${url}road-decoration-icons.html`);
  await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
    const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
    const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
    const renderer = new t.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(256, 256); renderer.setClearColor(0, 0);
    renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const scene = new t.Scene(), camera = new t.PerspectiveCamera(32, 1, .01, 50);
    scene.add(new t.HemisphereLight("#fff7e8", "#697478", 2.4));
    const sun = new t.DirectionalLight("#ffffff", 2.7); sun.position.set(-3, 6, 5); scene.add(sun);
    const base = createRomanMaterials(true), packs = new Map<string, any>();
    const owner = createThreeRoadDecorations({ cellsX: 16, cellsZ: 16, fogDisplayDisabled: true, fogRevision: 0 }, true, (nation: string) => {
      if (nation === "roman") return base.materials;
      if (!packs.has(nation)) packs.set(nation, createNationBuildingMaterials(base.materials, nation, true));
      return packs.get(nation).materials;
    });
    scene.add(owner.root);
    (window as any).roadIcons = {
      draw: async (item: { id: string; plant?: unknown; category?: string }) => {
        owner.update([{ item: item.id, uid: 1, position: [0, 0, 0], yaw: 0, volumes: [], supports: [] }]);
        await owner.ready();
        const statistics = owner.statistics();
        if (statistics.instances !== 1 || statistics.pending || statistics.errors || !owner.root.children.length)
          throw new Error(`Icon has no actual runtime model: ${item.id}`);
        const bounds = new t.Box3().setFromObject(owner.root), center = bounds.getCenter(new t.Vector3()), size = bounds.getSize(new t.Vector3());
        if (bounds.isEmpty() || ![...center.toArray(), ...size.toArray()].every(Number.isFinite))
          throw new Error(`Icon has invalid runtime bounds: ${item.id}`);
        let fit = 2.2, side = .32, elevation = .20;
        if (item.plant || item.category === "trees") { fit = 2; side = .55; elevation = .65; }
        const distance = Math.max(size.y, size.x) * fit;
        camera.position.copy(center).add(new t.Vector3(distance * side, distance * elevation, distance));
        camera.lookAt(center);
        renderer.render(scene, camera);
        const probe = document.createElement("canvas"); probe.width = probe.height = 256;
        const context = probe.getContext("2d")!; context.drawImage(renderer.domElement, 0, 0);
        const pixels = context.getImageData(0, 0, 256, 256).data;
        let visiblePixels = 0, edgePixels = 0;
        for (let pixel = 3; pixel < pixels.length; pixel += 4) if (pixels[pixel]! > 32) {
          visiblePixels++;
          const index = (pixel - 3) / 4, x = index % 256, y = Math.floor(index / 256);
          if (x === 0 || x === 255 || y === 0 || y === 255) edgePixels++;
        }
        if (visiblePixels < 128 || renderer.info.render.triangles < 1)
          throw new Error(`Icon is effectively blank: ${item.id}`);
        const png = renderer.domElement.toDataURL("image/png");
        const width = 2 * camera.position.distanceTo(center) * Math.tan(camera.fov * Math.PI / 360);
        const origin = new t.Vector3(0, 0, 0).project(camera);
        const metadata = { width, height: width, pivot: [(origin.x + 1) / 2, (origin.y + 1) / 2] };
        owner.update([]); return { png, metadata, visiblePixels, edgePixels, triangles: renderer.info.render.triangles };
      },
      dispose: () => { owner.dispose(); for (const pack of packs.values()) pack.dispose(); base.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
    };
  });
  for (const item of items) {
    const data = await page.evaluate(item => (window as any).roadIcons.draw(item), item);
    if (completionOnly) assert.equal(data.edgePixels, 0, `Completion icon clipped at image edge: ${item.id}`);
    const file = iconFile(item), image = basename(file);
    writeFileSync(file, Buffer.from(data.png.split(",")[1], "base64"));
    overview[item.id] = { image, ...data.metadata };
    if (completionOnly) receipts.push({ id: item.id, image, sha256: hash(readFileSync(file)),
      triangles: data.triangles, visiblePixels: data.visiblePixels, edgePixels: data.edgePixels, ...data.metadata });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(hashSources(), sourceHashes, "Completion source changed during actual icon export");
  assert.deepEqual(Object.fromEntries(protectedIcons.map(path => [path, iconHash(path)])), protectedIconHashes,
    "Completion export changed an existing released icon");
  if (completionOnly || integratedPlants || additiveStructures || peachOnly || elmOnly || woodenLanternsOnly || wisteriaTreesOnly ||
    gardenTreesOnly || romanColumnsOnly || climbersOnly || willowOnly || mapleOnly || bambooOnly) {
    const path = resolve(output, "ornamental-overview.json");
    const retained = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> : {};
    writeFileSync(path, JSON.stringify({ ...retained, ...overview }, null, 2));
  }
  if (completionOnly) {
    const receiptDirectory = resolve("../resources/project-reviews/plant-completion-2026-11-05/icon-export");
    mkdirSync(receiptDirectory, { recursive: true });
    writeFileSync(resolve(receiptDirectory, `${completionFamily ?? "all"}.json`),
      JSON.stringify({ count: receipts.length, imageSize: 256, sourceHashes, protectedIconHashes, items: receipts }, null, 2));
  }
  await page.evaluate(() => (window as any).roadIcons.dispose());
  console.log(`Exported ${items.length} actual road-decoration model icons`);
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
