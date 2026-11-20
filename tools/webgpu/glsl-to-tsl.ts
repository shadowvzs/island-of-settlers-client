import { readFileSync } from "node:fs";
import GLSLDecoder from "three/examples/jsm/transpiler/GLSLDecoder.js";
import Transpiler from "three/examples/jsm/transpiler/Transpiler.js";
import TSLEncoder from "three/examples/jsm/transpiler/TSLEncoder.js";

/**
 * Draft TSL from a GLSL snippet (Three's bundled transpiler). The output is a starting point only:
 * fix it by hand, import its constants from render-common and prove it with tools/bench/tsl-parity.ts
 * before any material uses it (docs/reference/tsl-porting-guide.md).
 *
 *   npx tsx tools/webgpu/glsl-to-tsl.ts <snippet.glsl>
 *   npx tsx tools/webgpu/glsl-to-tsl.ts --export WIND_GLSL src/render-common/shaders/prop-glsl.ts
 */
const readSource = async (args: readonly string[]) => {
  if (args[0] !== "--export") return readFileSync(args[0]!, "utf8");
  const module = await import(new URL(args[2]!, `file://${process.cwd()}/`).href) as Record<string, unknown>;
  const source = module[args[1]!];
  if (typeof source !== "string") throw new Error(`${args[2]} has no string export ${args[1]}`);
  return source;
};

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: glsl-to-tsl.ts <snippet.glsl> | --export <NAME> <module.ts>");
  process.exit(2);
}
const glsl = await readSource(args);
console.log(new Transpiler(new GLSLDecoder(), new TSLEncoder()).parse(glsl));
