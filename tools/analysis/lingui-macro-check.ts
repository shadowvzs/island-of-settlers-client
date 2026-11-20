import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build, createServer } from "vite";

import gameConfig from "../../vite.config.ts";

const root = resolve(import.meta.dirname, "../..");
const fixtures = ["helpers.ts", "view.tsx"].map(name => `/tests/fixtures/lingui/${name}`);
const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true } });
try {
  for (const fixture of fixtures) {
    const result = await server.transformRequest(fixture);
    assert(result?.code, `No development output for ${fixture}`);
    assert(!result.code.includes("/macro"), `Uncompiled development macro in ${fixture}`);
    assert(result.code.includes("macro."), `Message ID lost in ${fixture}`);
  }
} finally {
  await server.close();
}

const outputs = await build({ ...gameConfig, configFile: false, root, logLevel: "error", build: {
  emptyOutDir: false,
  minify: false,
  rollupOptions: {
    external: [/^@lingui\//, /^react(?:\/|$)/],
    input: Object.fromEntries(fixtures.map((fixture, index) => [String(index), resolve(root, `.${fixture}`)])),
    output: { format: "es" },
    preserveEntrySignatures: "strict"
  },
  write: false
} });
const chunks = (Array.isArray(outputs) ? outputs : [outputs]).flatMap(output => {
  assert("output" in output, "Macro check unexpectedly started a watcher");
  return output.output;
})
  .filter(output => output.type === "chunk");
assert(chunks.length >= 2, "Missing production fixtures");
for (const chunk of chunks) assert(!chunk.code.includes("/macro"), `Uncompiled production macro in ${chunk.fileName}`);
assert(chunks.some(chunk => chunk.code.includes("macro.greeting")), "Missing production t/msg");
assert(chunks.some(chunk => chunk.code.includes("macro.ready")), "Missing production Trans");
console.log("Lingui t/msg/Trans compile through development and production Vite pipelines.");
