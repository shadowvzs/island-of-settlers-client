import { ISO_GLSL, VIEW_DIRECTION } from "../iso-projection";
import { profileStep } from "../load-profile";
import type { PropMesh } from "../props/mesh-builder";
import { LEAF_NORMAL_GLSL } from "../shaders/leaf-glsl";
import { FOLIAGE_KIND_GLSL } from "../shaders/winter-glsl";
import { dilateColor, downsample } from "./atlas-image";
import { type AtlasMip, type AtlasRegion,buildAtlasMips } from "./atlas-mips";
import {
  type AtlasLayout,
  BAKE_SCALE,
  type LayoutEntry,
  layoutSpriteAtlas,
  SUPERSAMPLE} from "./sprite-atlas-layout";

/** Leaf atlas as a mipmapped texture of the bake context. */
export const uploadLeafAtlas = (
  gl: WebGL2RenderingContext,
  pixels: Uint8Array,
  size: number,
  unit = 0
) => {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
};

/** Where a baked sprite sits in the final atlas, and its size in screen pixels at zoom 1. */
export interface SpriteFrame {
  height: number;
  pivotX: number;
  pivotY: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  width: number;
}

/** The baked atlas maps (final resolution). */
interface BakedAtlas {
  albedo: Uint8Array;
  albedoMips?: AtlasMip[];
  height: number;
  normals: Uint8Array;
  normalMips?: AtlasMip[];
  width: number;
  /**
   * Half resolution wind map: r bend weight relative to the sprite's largest, g leaf flutter,
   * b foliage kind (winter: 0 wood, 0.5 evergreen, 1 broadleaf).
   */
  wind: Uint8Array;
}

/** A baked atlas and every mesh's sprite frame in it. */
export interface BakedSprites {
  atlas: BakedAtlas;
  sprites: SpriteFrame[];
}

const VERTEX_GLSL = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
in vec2 aUv;
in vec2 aWind;
uniform vec2 uOffset;
uniform vec2 uAtlasSize;
uniform float uScale;
uniform float uBendScale;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out vec2 vWind;
out vec3 vWorld;
${ISO_GLSL}
void main() {
  vec2 pixel = isoProject(aPosition) * uScale + uOffset;
  float depth = -dot(aPosition, vec3(${VIEW_DIRECTION.x}, ${VIEW_DIRECTION.y}, ${VIEW_DIRECTION.z})) * 0.2;
  gl_Position = vec4(pixel / uAtlasSize * 2.0 - 1.0, clamp(depth, -1.0, 1.0), 1.0);
  vNormal = aNormal;
  vColor = aColor;
  vUv = aUv;
  vWind = vec2(aWind.x * uBendScale, aWind.y);
  vWorld = aPosition;
}`;

const FRAGMENT_GLSL = `#version 300 es
precision highp float;
precision highp int;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
in vec2 vWind;
in vec3 vWorld;
uniform int uMode;
uniform sampler2D uLeafAtlas;
/** R15a winter views: share of the broadleaf clumps kept (0 keeps every leaf). */
uniform float uBareKeep;
out vec4 fragColor;
${FOLIAGE_KIND_GLSL}
${LEAF_NORMAL_GLSL}
bool isFallenLeaf() {
  if (uBareKeep <= 0.0 || getFoliageKind(vUv) < FOLIAGE_BROADLEAF) return false;
  float clump = fract(sin(dot(floor(vWorld * 7.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return clump > uBareKeep;
}
void main() {
  vec4 leaf = isLeafAtlasUv(vUv) ? texture(uLeafAtlas, vUv) : vec4(1.0);
  if (leaf.a < 0.5 || isFallenLeaf()) discard;
  if (uMode == 1) {
    vec3 normal = normalize(vNormal);
    if (isLeafAtlasUv(vUv)) normal = perturbLeafNormal(normal, vWorld, vUv);
    // Alpha class survives the coverage downsample: leaves near 1, wood near 0.5.
    fragColor = vec4(normal * 0.5 + 0.5, isLeafAtlasUv(vUv) ? 1.0 : 0.5);
  } else if (uMode == 2) fragColor = vec4(vWind, getFoliageKind(vUv), 1.0);
  else fragColor = vec4(vColor * leaf.rgb, 1.0);
}`;

/** The bake program: the iso projection by default, or another view's vertex shader. */
export const compileBakeProgram = (gl: WebGL2RenderingContext, vertexSource = VERTEX_GLSL) => {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, FRAGMENT_GLSL]
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "");
  return program;
};

export const createMeshVao = (gl: WebGL2RenderingContext, program: WebGLProgram, mesh: PropMesh) => {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  for (const [name, data, size] of [
    ["aPosition", mesh.positions, 3],
    ["aNormal", mesh.normals, 3],
    ["aColor", mesh.colors, 3],
    ["aUv", mesh.uvs, 2],
    ["aWind", mesh.wind, 2]
  ] as const) {
    const location = gl.getAttribLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  return { count: mesh.indices.length, vao };
};

export const BAKE_PASSES = ["color", "normal", "wind"] as const;

export type BakePass = (typeof BAKE_PASSES)[number];

type PassPixels = { [Pass in BakePass]?: Uint8Array };

/** Maps of some bake passes (by pass) with the atlas layout's frames. */
export interface BakedPasses {
  height: number;
  mips?: Partial<Record<BakePass, AtlasMip[]>>;
  pixels: PassPixels;
  sprites: SpriteFrame[];
  width: number;
}

/** Fragment shader mode (uMode) of each pass. */
const PASS_MODES: Record<BakePass, number> = { color: 0, normal: 1, wind: 2 };

const getLargestBend = (mesh: PropMesh) => {
  let largest = 0.01;
  for (let index = 0; index < mesh.wind.length; index += 2) {
    largest = Math.max(largest, mesh.wind[index]!);
  }
  return largest;
};

const toFrame = (entry: LayoutEntry, width: number, height: number): SpriteFrame => {
  const scale = BAKE_SCALE * SUPERSAMPLE;
  return {
    height: entry.height / scale,
    pivotX: entry.pivotX / scale,
    pivotY: entry.pivotY / scale,
    u0: entry.x / width,
    u1: (entry.x + entry.width) / width,
    v0: entry.y / height,
    v1: (entry.y + entry.height) / height,
    width: entry.width / scale
  };
};

interface BakeContext {
  gl: WebGL2RenderingContext;
  meshes: PropMesh[];
  uniform: (name: string) => WebGLUniformLocation | null;
  vaos: { count: number; vao: WebGLVertexArrayObject }[];
}

const drawEntry = (context: BakeContext, entry: LayoutEntry) => {
  const { gl, uniform } = context;
  const { count, vao } = context.vaos[entry.meshId]!;
  gl.uniform2f(uniform("uOffset"), entry.x + entry.pivotX, entry.y + entry.pivotY);
  gl.uniform1f(uniform("uBendScale"), 1 / getLargestBend(context.meshes[entry.meshId]!));
  gl.bindVertexArray(vao);
  gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
};

const renderPass = (context: BakeContext, layout: AtlasLayout, pass: BakePass) => {
  const { gl, uniform } = context;
  const { height, width } = layout;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1i(uniform("uMode"), PASS_MODES[pass]);
  for (const entry of layout.entries) drawEntry(context, entry);
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const reduced = downsample(pixels, width, height);
  if (pass === "wind") return downsample(reduced, width / 2, height / 2);
  dilateColor(reduced, width / 2, height / 2, 2);
  return reduced;
};

/** Sprite frame of every mesh id in the layout. */
const createSpriteFrames = (layout: AtlasLayout) => {
  const sprites: SpriteFrame[] = [];
  for (const entry of layout.entries) {
    sprites[entry.meshId] = toFrame(entry, layout.width, layout.height);
  }
  return sprites;
};

const createBakeContext = (canvas: OffscreenCanvas, meshes: PropMesh[]): BakeContext => {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true
  })!;
  const program = compileBakeProgram(gl);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  return {
    gl,
    meshes,
    uniform: (name: string) => gl.getUniformLocation(program, name),
    vaos: meshes.map((mesh) => createMeshVao(gl, program, mesh))
  };
};

const getLayoutRegions = (layout: AtlasLayout): AtlasRegion[] =>
  layout.entries.map(entry => ({
    height: Math.round(entry.height / SUPERSAMPLE),
    width: Math.round(entry.width / SUPERSAMPLE),
    x: Math.round(entry.x / SUPERSAMPLE),
    y: Math.round(entry.y / SUPERSAMPLE)
  }));

/**
 * Renders procedural props at the iso angle into a sprite atlas (colour, world normal, wind
 * weights) with a throw-away WebGL2 context: the far zoom impostors. `meshes` may be sparse
 * (only the listed mesh ids are baked). `passes` picks the maps to render: the loading pool
 * bakes each pass in its own worker, in parallel (see mergeBakedPasses).
 */
export const bakeSpritePasses = (
  meshes: PropMesh[],
  leafAtlas: { normalPixels?: Uint8Array; pixels: Uint8Array; size: number },
  passes: readonly BakePass[] = BAKE_PASSES
): BakedPasses => {
  const layout = profileStep("bake layout", () => layoutSpriteAtlas(meshes));
  /** Offscreen: the same bake runs on the main thread or in a worker of the loading pool. */
  const canvas = new OffscreenCanvas(layout.width, layout.height);
  const context = profileStep("bake context", () => createBakeContext(canvas, meshes));
  const { gl, uniform } = context;
  uploadLeafAtlas(gl, leafAtlas.pixels, leafAtlas.size, 0);
  uploadLeafAtlas(
    gl,
    leafAtlas.normalPixels ?? Uint8Array.from([128, 128, 255, 255]),
    leafAtlas.normalPixels ? leafAtlas.size : 1,
    1
  );
  gl.uniform1f(uniform("uScale"), BAKE_SCALE * SUPERSAMPLE);
  gl.uniform1i(uniform("uLeafAtlas"), 0);
  gl.uniform1i(uniform("uLeafNormals"), 1);
  gl.uniform2f(uniform("uAtlasSize"), layout.width, layout.height);
  gl.viewport(0, 0, layout.width, layout.height);
  const pixels: PassPixels = {};
  const mips: Partial<Record<BakePass, AtlasMip[]>> = {};
  const width = layout.width / SUPERSAMPLE;
  const height = layout.height / SUPERSAMPLE;
  const regions = getLayoutRegions(layout);
  for (const pass of passes) {
    const passPixels = profileStep(`bake ${pass} pass`, () => renderPass(context, layout, pass));
    pixels[pass] = passPixels;
    if (pass === "color") {
      mips.color = buildAtlasMips(passPixels, width, height, regions, {
        alphaThreshold: 0.5, maxLevels: 4, mode: "alpha-test"
      });
    } else if (pass === "normal") {
      mips.normal = buildAtlasMips(passPixels, width, height, regions, {
        maxLevels: 4, mode: "normal"
      });
    }
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {
    height,
    mips,
    pixels,
    sprites: createSpriteFrames(layout),
    width
  };
};

/** One atlas from passes baked separately (each holds some of the maps, same layout). */
export const mergeBakedPasses = (parts: BakedPasses[]): BakedSprites => {
  const { height, sprites, width } = parts[0]!;
  const pixels: PassPixels = Object.assign({}, ...parts.map((part) => part.pixels));
  const mips: Partial<Record<BakePass, AtlasMip[]>> = Object.assign(
    {}, ...parts.map(part => part.mips ?? {})
  );
  return {
    atlas: {
      albedo: pixels.color!,
      albedoMips: mips.color,
      height,
      normals: pixels.normal!,
      normalMips: mips.normal,
      width,
      wind: pixels.wind!
    },
    sprites
  };
};
