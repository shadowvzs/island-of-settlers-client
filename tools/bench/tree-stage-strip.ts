import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { writeContactSheet } from "../review/review-contact-sheet";
import { launchBrowser, startDevServer } from "./browser";
import type { StripShot } from "./tree-stage-strip-page";

/**
 * Studio strips of prop and tree growth stage meshes (game prop material, sun shadow, full or core/Minimal
 * draw): a quick close inspection beside the in-game TOOL-3 sheet, e.g. every growth stage of a tree line.
 * Usage (from island-of-settlers-client, inside a browser slot):
 *   npx tsx tools/bench/tree-stage-strip.ts <spec.json> --out <dir>
 * Spec: { "title": string, "columns": number, "rows": [{ "heading": string, "shots": [{ "label": string,
 *   "core": boolean, "view": [x, y, z], "time"?: s, "wind"?: [x, z] (motion strips),
 *   "meshes": [{ "kind", "variant" } | { "kind", "stage", "form" }] }] }] }
 */
interface StripRow {
  heading: string;
  shots: (StripShot & { label: string })[];
}

interface StripSpec {
  columns: number;
  rows: StripRow[];
  title: string;
}

const option = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const specPath = process.argv[2];
if (!specPath) throw new Error("Usage: tree-stage-strip.ts <spec.json> --out <dir>");
const spec = JSON.parse(readFileSync(specPath, "utf8")) as StripSpec;
const out = resolve(option("out") ?? "tree-stage-strip");
mkdirSync(out, { recursive: true });

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await page.route(`${url}__tree-strip.html`, route => route.fulfill({ contentType: "text/html",
    body: "<!doctype html><script type=\"module\" src=\"/tools/bench/tree-stage-strip-page.ts\"></script>" }));
  await page.goto(`${url}__tree-strip.html`);
  await page.waitForFunction(() => window.__treeStrip !== undefined, null, { timeout: 120_000 });
  const rows = [];
  for (const [rowIndex, row] of spec.rows.entries()) {
    const images = await page.evaluate(shots => window.__treeStrip!(shots), row.shots);
    const cells = images.map((image, index) => {
      const path = `${out}/${rowIndex}-${index}.png`;
      writeFileSync(path, Buffer.from(image.split(",")[1]!, "base64"));
      return { label: row.shots[index]!.label, path };
    });
    rows.push({ cells, heading: row.heading });
  }
  await writeContactSheet(browser, { columns: spec.columns, rows, title: spec.title }, `${out}/sheet.png`);
  console.log(`Strip sheet written to ${out}/sheet.png`);
} finally {
  await browser.close();
  await server.close();
}
