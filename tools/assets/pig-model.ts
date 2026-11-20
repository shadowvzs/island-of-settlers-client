import { execFileSync } from "node:child_process";
import { mkdirSync,readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";

import { readAccessor,readGlb } from "../../src/render-common/glb-reader";

/** Offline adaptation of the unrigged attributed source; original GLB remains intact. */
const bytes = readFileSync(resolve("../resources/models/animals/livestock/lowpoly_pig.glb"));
const file = readGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const primitive = file.json.meshes[0]!.primitives[0]!;
const positions = readAccessor(file, primitive.attributes.POSITION!);
const normals = readAccessor(file, primitive.attributes.NORMAL!);
const uvs = readAccessor(file, primitive.attributes.TEXCOORD_0!);
const indices = readAccessor(file, primitive.indices);
// Source mesh coordinates are upside down with the snout towards -Z. Rigid rotation X=pi
// restores Y-up/+Z-forward; source scene transform only adds orientation, scale/translation.
const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
for (let at = 0; at < positions.length; at += 3) for (let axis = 0; axis < 3; axis++) {
  minimum[axis] = Math.min(minimum[axis]!, positions[at + axis]!);
  maximum[axis] = Math.max(maximum[axis]!, positions[at + axis]!);
}
const scale = .46 / (maximum[2]! - minimum[2]!);
for (let at = 0; at < positions.length; at += 3) {
  positions[at] = (positions[at]! - (minimum[0]! + maximum[0]!) / 2) * scale;
  positions[at + 1] = (maximum[1]! - positions[at + 1]!) * scale;
  positions[at + 2] = ((maximum[2]! + minimum[2]!) / 2 - positions[at + 2]!) * scale;
  normals[at + 1] = -normals[at + 1]!; normals[at + 2] = -normals[at + 2]!;
}
const geometry = new BufferGeometry();
geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
geometry.setIndex(Array.from(indices));
// Give atlas coordinates extra error weight: a collapse must preserve painted eyes/snout
// and may not drag a body triangle across unrelated islands of the texture atlas.
const weighted = geometry.clone();
for(let i=0;i<weighted.getAttribute("uv").array.length;i++) weighted.getAttribute("uv").array[i]! *= 12;
const minimal = await new SimplifyModifier().modify(weighted, Math.round(positions.length / 3 * .8));
for(let i=0;i<minimal.getAttribute("uv").array.length;i++) minimal.getAttribute("uv").array[i]! /= 12;
weighted.dispose();
const data = (geometry: BufferGeometry) => Object.fromEntries(["position", "normal", "uv"].map(name =>
  [name, Array.from(geometry.getAttribute(name).array, n => Math.round(n * 1e6) / 1e6)]).concat(
    [["index", Array.from(geometry.index!.array)]]));
writeFileSync("src/render-common/wares/imported-pig-data.ts", "// Derived from fabiotambone lowpoly pig, CC BY 4.0; see docs/reference/asset-credits.md.\nexport const IMPORTED_PIG_DATA = " + JSON.stringify({ high: data(geometry), minimal: data(minimal) }) + ";\n");
const target = resolve("assets/models/animals/pig"); mkdirSync(target, { recursive: true });
const image = file.json.images![0]!, view = file.json.bufferViews[image.bufferView]!;
writeFileSync(resolve(target, "albedo-source.jpg"), new Uint8Array(file.binary.buffer, file.binary.byteOffset + (view.byteOffset ?? 0), view.byteLength));
execFileSync("python3", ["-c", `from PIL import Image
import os
p='assets/models/animals/pig/'
im=Image.open(p+'albedo-source.jpg')
im.save(p+'albedo-high.jpg',quality=90,optimize=True)
im.resize((512,256),Image.Resampling.LANCZOS).save(p+'albedo-minimal.jpg',quality=85,optimize=True)
os.unlink(p+'albedo-source.jpg')`]);
console.log({ high: geometry.index!.count / 3, minimal: minimal.index!.count / 3, scale });
