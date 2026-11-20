import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CLIENT_ROOT, serverBundleGraph } from "./helpers/server-bundle-graph";

/**
 * The server's game bundle (verifier, catch-up, replay) stays free of Lingui, React, renderer and UI code and of
 * browser globals; content reaches it only as plain catalog data. Three.js is still pulled in by the listed
 * decoration clearance graphs (pending: they should read catalog/sidecar data instead); the list only shrinks.
 */
const FORBIDDEN_INPUTS = [/node_modules\/@lingui\//, /node_modules\/react(-dom)?\//, /(^|\/)src\/renderers\//,
  /\.(tsx|css)$/];
const THREE_IMPORTERS_PENDING = [
  "src/render-common/plants/catalog-columnar-graph.ts",
  "src/render-common/plants/catalog-willow-columnar-clearance.ts",
  "src/render-common/plants/catalog-willow-graph.ts",
  "src/render-common/plants/willow-tree-graph.ts",
  "src/render-common/wisteria-hero-graph.ts",
  "src/render-common/wisteria-lod-layout.ts",
  "src/render-common/wisteria-structure-clearance.ts"
];
const BROWSER_GLOBALS = /\b(document|localStorage|sessionStorage|navigator|indexedDB)\./;
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
const isThree = (path: string) => /node_modules\/three\//.test(path);

describe("server bundle imports", () => {
  it("bundles no Lingui, React, renderer, view or stylesheet module", async () => {
    const inputs = Object.keys((await serverBundleGraph()).inputs);
    expect(inputs.filter(file => FORBIDDEN_INPUTS.some(pattern => pattern.test(file)))).toEqual([]);
  }, 60_000);

  it("pulls in Three.js only through the pending, shrinking list of importers", async () => {
    const { inputs } = await serverBundleGraph();
    const importers = Object.entries(inputs)
      .filter(([file, input]) => !isThree(file) && input.imports.some(entry => isThree(entry.path)))
      .map(([file]) => file).sort();
    expect(importers).toEqual(THREE_IMPORTERS_PENDING);
  }, 60_000);

  it("uses no browser globals in project modules", async () => {
    const files = Object.keys((await serverBundleGraph()).inputs).filter(file => !file.includes("node_modules"));
    const offenders = files.filter(file =>
      BROWSER_GLOBALS.test(readFileSync(resolve(CLIENT_ROOT, file), "utf8").replace(COMMENTS, "")));
    expect(offenders).toEqual([]);
  }, 60_000);
});
