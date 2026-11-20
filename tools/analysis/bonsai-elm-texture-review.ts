import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createBonsaiElmBarkTextures } from "../../src/renderers/three/plants/bonsai-elm-bark-textures";
import { createBonsaiElmLeafTextures } from "../../src/renderers/three/plants/bonsai-elm-leaf-textures";
import { encodePng } from "../dev/png";

const run = process.argv[2] ?? "elm-c-textures";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid elm texture review label");
const output = resolve("../resources/project-reviews/bonsai-candidate-2026-11-04", run);
if (existsSync(resolve(output, "report.json"))) throw new Error("Preserve earlier texture evidence; use a fresh label");
mkdirSync(output, { recursive: true });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bark = createBonsaiElmBarkTextures(), leaves = createBonsaiElmLeafTextures();
const images = { "bark-albedo": bark.map, "bark-normal": bark.normalMap,
  "elm-leaf-alpha-albedo": leaves.map, "elm-leaf-normal": leaves.normalMap };
const reports: unknown[] = [];
try {
  for (const [name, texture] of Object.entries(images)) {
    const { data, height, width } = texture.image;
    if (!data) throw new Error("Elm texture pixel data is absent");
    const pixels = Uint8Array.from(data);
    writeFileSync(resolve(output, `${name}.png`), encodePng(width, height, pixels));
    if (name === "bark-albedo") {
      const tileWidth = width * 4, tileHeight = height * 2, tiled = new Uint8Array(tileWidth * tileHeight * 4);
      for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileWidth; x++) {
        const source = ((y % height) * width + x % width) * 4, target = (y * tileWidth + x) * 4;
        tiled.set(pixels.subarray(source, source + 4), target);
      }
      writeFileSync(resolve(output, "bark-repeat-diagnostic.png"), encodePng(tileWidth, tileHeight, tiled));
    }
    reports.push({ name, width, height, sha256: hash(pixels) });
  }
  const sourceFiles = ["src/renderers/three/plants/bonsai-elm-bark-textures.ts",
    "src/renderers/three/plants/bonsai-elm-leaf-textures.ts", "src/renderers/three/plants/ornamental-leaf-textures.ts"];
  const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(path))]));
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    scope: "CPU-only exact source texture diagnostic; does not replace native material/UV/shader acceptance",
    sourceHashes, reports
  }, null, 2));
  console.log(`Recorded ${reports.length} exact elm texture maps without a browser/GPU`);
} finally { bark.dispose(); leaves.dispose(); }
