import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MeshStandardMaterial, Texture } from "three";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "reference-hero-b";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid topology run name");
try {
  const { createWisteriaHero } = await server.ssrLoadModule("/src/renderers/three/wisteria-hero.ts");
  const minimal = process.argv.includes("--minimal"), lean = process.argv.includes("--lean");
  const metadata = minimal ? JSON.parse(readFileSync("assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json", "utf8")) : undefined;
  let templates;
  if (minimal) {
    const { createWisteriaMinimalTemplates } = await server.ssrLoadModule("/src/renderers/three/wisteria-minimal-templates.ts");
    templates = createWisteriaMinimalTemplates(new Texture(), metadata);
  }
  const timber = new MeshStandardMaterial(), model = createWisteriaHero({ wood: timber }, templates, { minimal, lean });
  try {
    const report = { quality: minimal ? "minimal" : "high", lean, status: "CPU topology only: unaccepted art and unapproved production budget", counts: model.counts,
      modules: model.topology, total: model.topology.reduce((sum: number, entry: { visibleTriangles: number }) => sum + entry.visibleTriangles, 0) };
    const output = resolve("../resources/project-reviews/road-decoration-prototypes-2026-11-03", run);
    mkdirSync(output, { recursive: true }); writeFileSync(resolve(output, "cpu-topology.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { model.dispose(); templates?.dispose(); timber.dispose(); }
} finally { await server.close(); }
