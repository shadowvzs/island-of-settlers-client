import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { launchBrowser, startDevServer } from "./browser";

const assetRoot = resolve("../island-of-settlers-worker-generation/game_ready");
const { values: options } = parseArgs({ options: { baseline: { type: "boolean" }, bodies: { type: "string" },
  chest: { type: "boolean" }, close: { type: "boolean" },
  "candidate-source-folder": { type: "string" },
  "candidate-armour-folder": { type: "string" },
  "candidate-only": { type: "boolean" },
  "prior-source-folder": { type: "string" }, "skip-published": { type: "boolean" },
  diagnostics: { type: "boolean" }, head: { type: "boolean" },
  "layer-modes": { type: "string" }, neck: { type: "boolean" }, pilots: { type: "boolean" }, quality: { type: "string" },
  "raw-baseline": { type: "boolean" },
  ranks: { type: "string" }, "run-id": { type: "string" }, "run-phase": { type: "string" }, "run-blend": { type: "string" },
  "windup-phase": { type: "string" }, "witness-views": { type: "boolean" },
  "run-angle": { type: "string" }, "run-witness-point": { type: "string" },
  waist: { type: "boolean" } } });
const runPhase = Number(options["run-phase"] ?? "0");
if (!Number.isFinite(runPhase) || runPhase < 0 || runPhase >= 1) throw new Error("Run phase must be in[0,1)");
const runBlend = Number(options["run-blend"] ?? "1"), witnessViews = Boolean(options["witness-views"]);
if (!Number.isFinite(runBlend) || runBlend < 0 || runBlend > 1) throw new Error("Run blend must be in[0,1]");
const runAngle = Number(options["run-angle"] ?? ".18");
const runWitnessPoint = options["run-witness-point"]?.split(",").map(Number);
if (!Number.isFinite(runAngle) || runWitnessPoint && (runWitnessPoint.length !== 3 || runWitnessPoint.some(value => !Number.isFinite(value))))
  throw new Error("Choose one finite run angle and an optional exact3D witness point");
const windupPhase = Number(options["windup-phase"] ?? ".48");
if (!Number.isFinite(windupPhase) || windupPhase < 0 || windupPhase >= 1) throw new Error("Windup phase must be in[0,1)");
const selected = new Set((options.bodies ?? process.env.BODIES ?? "").split(","));
const pilots = options.pilots ?? process.env.PILOTS === "1", run = options["run-id"] ?? process.env.RUN_ID ?? "current";
const layerModes = (options["layer-modes"] ?? process.env.LAYER_MODES ?? process.env.LAYER_MODE ?? "all").split(",");
const close = options.close ?? process.env.CLOSE === "1";
if (layerModes.some(mode => !["all", "source", "linen", "torso"].includes(mode)))
  throw new Error("Unknown review layer mode");
const output = resolve(`../resources/project-reviews/armour-shared-repair-2026-11-02/${run}`);
const armourFolder = options["candidate-armour-folder"] ?? (pilots ? "armour-repair-pilots" : "armour");
if (!/^[a-z0-9-]+$/.test(armourFolder)) throw new Error("Choose a direct candidate armour folder");
const manifest = JSON.parse(await readFile(`${assetRoot}/${armourFolder}/manifest.json`, "utf8"));
if (options["candidate-armour-folder"] && !manifest.reviewOnly)
  throw new Error("Explicit candidate armour must be marked review-only");
const ranks = (options.ranks ?? process.env.RANKS ?? "recruit,soldier,centurion").split(",");
if (manifest.reviewOnlyRanks && ranks.some(rank => !manifest.reviewOnlyRanks.includes(rank)))
  throw new Error("Selected rank has no authored model in this review-only pack");
const published = JSON.parse(await readFile(`${assetRoot}/armour/manifest.json`, "utf8"));
if (options["raw-baseline"] && !options.baseline) throw new Error("Raw-original review requires the baseline comparison");
const candidateFolder = options["candidate-source-folder"];
const priorFolder = options["prior-source-folder"];
if (priorFolder && (!candidateFolder || !/^[a-z0-9-]+$/.test(priorFolder)))
  throw new Error("A prior source comparison needs the explicit immutable source candidate path");
if (candidateFolder && (!options.baseline || !/^[a-z0-9-]+$/.test(candidateFolder)))
  throw new Error("A source-clothes candidate requires a baseline comparison and one direct staging folder");
if (candidateFolder && options["candidate-armour-folder"]) throw new Error("Choose one candidate loading path");
const rawBaseline = options["raw-baseline"]
  ? JSON.parse(await readFile(`${assetRoot}/original-clothes-review/provenance.json`, "utf8")) : undefined;
if (options.baseline && (layerModes.length !== 1 || layerModes[0] !== "all"))
  throw new Error("Baseline comparisons require the complete visible outfit");
const { server, url } = await startDevServer(), browser = await launchBrowser(true);
const records = [];
await mkdir(output, { recursive: true });
try {
  for (const quality of (options.quality ?? process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/armour-fit.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.goto(`${url}armour-fit.html`);
    await page.evaluate(async ({ armourFolder, assetRoot, minimal, pilots }) => {
      const { createArmourFitScene } = await import(/* @vite-ignore */ String("/tools/bench/armour-fit-scene.ts"));
      (window as any).fitReview = createArmourFitScene(assetRoot, minimal, pilots, false, armourFolder);
    }, { armourFolder, assetRoot, minimal: quality === "minimal", pilots });
    for (const set of manifest.sets) for (const body of set.bodies) {
      if (!selected.has(body.id) && !selected.has("all")) continue;
      for (const rank of ranks) for (const layerMode of layerModes) {
        const focuses = ["body"];
        if (options.chest) focuses.push("chest");
        if (options.neck) focuses.push("neck");
        if (options.head) focuses.push("head");
        if (options.waist) focuses.push("waist");
        for (const focus of focuses) {
          const chest = focus === "chest", head = focus === "head", neck = focus === "neck", waist = focus === "waist";
          let states = ["candidate"];
          if (options.baseline) states = focus === "body"
            ? ["original-clothes", "published", "candidate"] : ["original-clothes", "candidate"];
          if (priorFolder) states = ["original-clothes", "prior-candidate", "candidate"];
          if (options["skip-published"]) states = states.filter(state => state !== "published");
          if (options["candidate-only"]) states = ["candidate"];
          const panels = [];
          for (const state of states) {
            const sourceId = body.sourceBody ?? body.id;
            const originalFolder = options["raw-baseline"] ? "original-clothes-review" : "tripo";
            let sourceModel: string | undefined;
            if (state === "original-clothes") sourceModel = `${originalFolder}/${sourceId}/model.glb`;
            if (state === "candidate" && candidateFolder) sourceModel = `${candidateFolder}/${sourceId}/model.glb`;
            if (state === "prior-candidate" && priorFolder) sourceModel = `${priorFolder}/${sourceId}/model.glb`;
            const baselineSource = state === "original-clothes"
              ? rawBaseline?.records.find((entry: any) => entry.id === sourceId) : undefined;
            if (state === "original-clothes" && rawBaseline) {
              if (!baselineSource) throw new Error(`Literal original-clothes baseline is missing: ${sourceId}`);
              const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
              if (hash(await readFile(baselineSource.source)) !== baselineSource.sourceSha256
                || hash(await readFile(baselineSource.output)) !== baselineSource.outputSha256)
                throw new Error("Literal original-clothes baseline provenance changed");
            }
            let sourceClothesCandidate;
            let stagedFolder: string | undefined;
            if (state === "candidate") stagedFolder = candidateFolder;
            if (state === "prior-candidate") stagedFolder = priorFolder;
            if (stagedFolder) {
              sourceClothesCandidate = JSON.parse(await readFile(`${assetRoot}/${stagedFolder}/${sourceId}/provenance.json`, "utf8"));
              if (sourceClothesCandidate.invalidPreservationBaseline)
                throw new Error("This candidate's source-preservation baseline was revoked; choose a corrected literal-source candidate");
              const hash = createHash("sha256").update(await readFile(`${assetRoot}/${sourceModel}`)).digest("hex");
              if (hash !== sourceClothesCandidate.outputSha256) throw new Error("Source-clothes candidate changed after its preservation gate");
            }
            const result = await page.evaluate(async ({ close, diagnostics, head, includeRun, layerMode, nation, neck, published, rank, runAngle, runBlend, runPhase, runWitnessPoint, sourceModel, variant, waist, windupPhase, witnessViews }) =>
              (window as any).fitReview.capture(nation, variant, rank, { close, diagnostics, head, includeRun, layerMode, neck, published, runAngle, runBlend, runPhase, runWitnessPoint, sourceModel, waist, windupPhase, witnessViews }),
            { close: close || chest, diagnostics: options.diagnostics, head, includeRun: options.baseline, layerMode, nation: set.nation, neck,
              published: state === "published", rank, runAngle, runBlend, runPhase, runWitnessPoint, sourceModel, variant: body.id, waist, windupPhase, witnessViews });
            let suffix = layerMode === "all" ? "" : `-${layerMode}`;
            if (options.baseline) suffix += `-${state}`;
            if (neck) suffix += "-neck";
            if (chest) suffix += "-chest";
            if (head) suffix += "-head";
            if (waist) suffix += "-waist";
            await writeFile(`${output}/${body.id}-${rank}-${quality}${suffix}.png`, Buffer.from(result.png, "base64"));
            const entry = state === "published" ? published.sets.find((entry: any) => entry.nation === set.nation)
              .bodies.find((entry: any) => entry.id === body.id) : body;
            const inputModel = quality === "minimal" && entry.modelsMinimal ? entry.modelsMinimal[rank] : entry.models[rank];
            let modelPath = resolve(assetRoot, armourFolder, inputModel);
            if (state === "published") modelPath = resolve(assetRoot, "armour", inputModel);
            if (sourceModel) modelPath = resolve(assetRoot, sourceModel);
            const modelSha256 = createHash("sha256").update(await readFile(modelPath)).digest("hex");
            records.push({ body: body.id, nation: set.nation, rank, quality, layerMode, state, chest, head, neck, waist,
              baselineSource, sourceClothesCandidate, modelPath, modelSha256, animations: body.animations, cells: result.cells });
            panels.push({ state, png: result.png });
            console.log(`${body.id}/${rank}/${quality}/${state}/${focus}`);
          }
          if (options.baseline) {
            const comparison = await page.evaluate(async panels => {
              const images = await Promise.all(panels.map(async panel => {
                const image = new Image(); image.src = `data:image/png;base64,${panel.png}`; await image.decode(); return image;
              }));
              const canvas = document.createElement("canvas"); canvas.width = images[0]!.width * images.length;
              canvas.height = images[0]!.height + 32;
              const context = canvas.getContext("2d")!; context.fillStyle = "#9ca49c"; context.fillRect(0, 0, canvas.width, canvas.height);
              images.forEach((image, index) => {
                context.drawImage(image, image.width * index, 32); context.fillStyle = "#152015"; context.font = "24px sans-serif";
                context.fillText(panels[index]!.state, image.width * index + 8, 25);
              });
              return canvas.toDataURL("image/png").split(",")[1]!;
            }, panels);
            const focusSuffix = focus === "body" ? "" : `-${focus}`;
            await writeFile(`${output}/${body.id}-${rank}-${quality}-comparison${focusSuffix}.png`, Buffer.from(comparison, "base64"));
          }
        }
      }
    }
    await page.evaluate(() => (window as any).fitReview.dispose());
    await page.close();
    if (errors.length) throw new Error(errors.join("\n"));
  }
  await writeFile(`${output}/review.json`, JSON.stringify({ records, pilots, close, layerModes }, null, 2));
} finally { await browser.close(); await server.close(); }
