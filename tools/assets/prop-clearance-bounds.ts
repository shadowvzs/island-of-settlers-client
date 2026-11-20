import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";

const grassPayload = new Uint8Array(gunzipSync(readFileSync(resolve(
  "src/render-common/props/plants/biome-grass-data.gz.bin"))));
(globalThis as { __BIOME_GRASS_PAYLOAD__?: ArrayBuffer }).__BIOME_GRASS_PAYLOAD__ = grassPayload.buffer;

/** Offline-only GLB inlining. Runtime/headless authority imports only measured numbers, never model assets. */
const built = await build({ bundle: true, write: false, platform: "node", format: "esm", target: "node22",
  loader: { ".glb": "dataurl" }, entryPoints: [resolve("tools/assets/prop-clearance-source.ts")] });
const code = Buffer.from(built.outputFiles[0]!.text).toString("base64");
const { measurePropClearanceBounds } = await import(`data:text/javascript;base64,${code}`);
const rows: Record<number, number[]> = measurePropClearanceBounds();
const header = "/** Native non-tree prop metadata: [height,radius,maxSway,maxFlutter,minY] at PROP_MESH_SEED.\n" +
  " * Rebuild with npx tsx tools/assets/prop-clearance-bounds.ts; checked against exact native meshes. */\n";
const body = Object.entries(rows).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n");
writeFileSync(resolve("src/render-common/props/prop-clearance-bounds.ts"), header +
  "export const NATIVE_PROP_CLEARANCE_BOUNDS: Readonly<Record<number, readonly number[]>> = {\n" + body + "\n};\n");
console.log(`Wrote ${Object.keys(rows).length} exact native prop envelopes`);
