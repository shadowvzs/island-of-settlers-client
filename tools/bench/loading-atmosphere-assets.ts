import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { launchBrowser } from "./browser";
import { resourcesPath } from "./resources-path";

// Export small alpha-preserving runtime derivatives; generated source art remains unchanged.
const sourceFolder = resourcesPath("project-reviews", "acceptance-2026-10-28", "loading-atmosphere", "originals");
const sources = [
  { name: "cloud", file: "cloud.png", width: 512 },
  { name: "smoke", file: "smoke.png", width: 128 }
];
const browser = await launchBrowser();
const output = resolve("src/app/assets");
const review = resourcesPath("project-reviews", "acceptance-2026-10-28", "loading-atmosphere");
await mkdir(output, { recursive: true }); await mkdir(review, { recursive: true });
const reports = [];
try {
  const page = await browser.newPage();
  for (const source of sources) {
    const bytes = await readFile(resolve(sourceFolder, source.file));
    const result = await page.evaluate(async ({ data, width }) => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = Math.round(width * image.height / image.width);
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0;
      for (let i = 3; i < alpha.length; i += 4) if (alpha[i] === 0) transparent++;
      return { data: canvas.toDataURL("image/webp", .82).split(",")[1]!,
        height: canvas.height, transparent, width: canvas.width };
    }, { data: `data:image/png;base64,${bytes.toString("base64")}`, width: source.width });
    assert(result.transparent > result.width * result.height * .1, "The generated sprite must retain real alpha");
    const encoded = Buffer.from(result.data, "base64");
    assert(encoded.length < 40_000, "Atmosphere sprites must remain small optional downloads");
    await writeFile(resolve(output, `loading-${source.name}.webp`), encoded);
    reports.push({ ...source, bytes: encoded.length, height: result.height,
      transparentPixels: result.transparent, decodedRgbaBytes: result.width * result.height * 4 });
  }
  await writeFile(resolve(review, "assets.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
console.log(JSON.stringify(reports));
