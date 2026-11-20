import type { BakeLeafAtlas } from "../content-builders";
import { fitTextureSize } from "../gl-limits";
import { profileStep } from "../load-profile";
import type { PropMesh } from "../props/mesh-builder";
import { dilateColor, downsample } from "./atlas-image";
import { type AtlasMip, type AtlasRegion, buildAtlasMips } from "./atlas-mips";
import { compileBakeProgram, createMeshVao, uploadLeafAtlas } from "./prop-baker";
import {
  getViewRange,
  layoutTreeViews,
  TREE_VIEW_AZIMUTHS,
  TREE_VIEW_BARE_KEEP,
  TREE_VIEW_ELEVATIONS,
  TREE_VIEW_MARGIN,
  TREE_VIEW_MAX_ATLAS_SIDE,
  type TreeViewEntry,
  type TreeViewLayout,
  type TreeViewSource
} from "./tree-view-layout";

/** Rendered at twice the atlas size and averaged down: anti-aliased silhouettes. */
const SUPERSAMPLE = 2;
/** Mip levels below the base: frames are multiples of 8 texels, so level 3 stays frame aligned. */
const MIP_LEVELS = 3;
/**
 * Far trees read the small mips. A global coverage restore alone keeps the area but breaks
 * trunks, palm fronds and conifer whorls into dots; this keeps one-texel features connected.
 */
const THIN_FEATURE_KEEP = 0.3;

/** Orthographic view of one block frame: mesh space -> the frame's viewport. */
const VIEW_VERTEX_GLSL = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
in vec2 aUv;
in vec2 aWind;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uToViewer;
uniform vec4 uRange;
uniform float uDepthRange;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out vec2 vWind;
out vec3 vWorld;
void main() {
  vec2 view = vec2(dot(aPosition, uRight), dot(aPosition, uUp));
  vec2 clip = (view - uRange.xz) / (uRange.yw - uRange.xz) * 2.0 - 1.0;
  float depth = -dot(aPosition, uToViewer) / uDepthRange;
  gl_Position = vec4(clip, clamp(depth, -1.0, 1.0), 1.0);
  vNormal = aNormal;
  vColor = aColor;
  vUv = aUv;
  vWind = aWind;
  vWorld = aPosition;
}`;

/**
 * The baked maps of the hemispherical tree views with region-safe mips: albedo at the layout size,
 * the normal map (leaf class in alpha) at half of it.
 */
export interface BakedTreeViews {
  albedo: Uint8Array;
  albedoMips: AtlasMip[];
  height: number;
  layout: TreeViewLayout;
  normalMips: AtlasMip[];
  normals: Uint8Array;
  width: number;
}

/** View basis of a block frame (mesh space): the same convention as the runtime shader. */
export const getTreeViewBasis = (azimuth: number, elevation: number) => {
  const sinA = Math.sin(azimuth);
  const cosA = Math.cos(azimuth);
  const sinE = Math.sin(elevation);
  const cosE = Math.cos(elevation);
  return {
    right: [cosA, 0, -sinA] as const,
    toViewer: [cosE * sinA, sinE, cosE * cosA] as const,
    up: [-sinE * sinA, cosE, -sinE * cosA] as const
  };
};

interface ViewContext {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  uniform: (name: string) => WebGLUniformLocation | null;
  vaos: ({ count: number; vao: WebGLVertexArrayObject } | undefined)[];
}

const forEachFrame = (entry: TreeViewEntry, visit: (column: number, row: number) => void) => {
  for (let row = 0; row < TREE_VIEW_ELEVATIONS.length; row += 1) {
    for (let column = 0; column < TREE_VIEW_AZIMUTHS; column += 1) visit(column, row);
  }
};

const drawFrame = (context: ViewContext, entry: TreeViewEntry, column: number, row: number) => {
  const { gl, uniform } = context;
  const elevation = TREE_VIEW_ELEVATIONS[row]!;
  const basis = getTreeViewBasis(column * Math.PI * 2 / TREE_VIEW_AZIMUTHS, elevation);
  const range = getViewRange(entry, elevation);
  gl.uniform3f(uniform("uRight"), ...basis.right);
  gl.uniform3f(uniform("uUp"), ...basis.up);
  gl.uniform3f(uniform("uToViewer"), ...basis.toViewer);
  gl.uniform4f(uniform("uRange"), -entry.radius, entry.radius, range.min, range.max);
  const margin = TREE_VIEW_MARGIN * SUPERSAMPLE;
  gl.viewport(
    (entry.x + column * entry.frameWidth) * SUPERSAMPLE + margin,
    (entry.y + row * entry.frameHeight) * SUPERSAMPLE + margin,
    entry.frameWidth * SUPERSAMPLE - margin * 2,
    entry.frameHeight * SUPERSAMPLE - margin * 2
  );
  const { count, vao } = context.vaos[entry.meshId]!;
  gl.bindVertexArray(vao);
  gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
};

const drawEntry = (context: ViewContext, entry: TreeViewEntry) => {
  const { gl, uniform } = context;
  gl.uniform1f(uniform("uBareKeep"), entry.bare ? TREE_VIEW_BARE_KEEP : 0);
  gl.uniform1f(uniform("uDepthRange"), entry.radius + Math.max(Math.abs(entry.yMin), Math.abs(entry.yMax)) + 1);
  forEachFrame(entry, (column, row) => drawFrame(context, entry, column, row));
};

/** Frame rectangles of every block, at the albedo size divided by `divisor`. */
const getFrameRegions = (layout: TreeViewLayout, divisor: number) => layout.entries.flatMap(entry => {
  const regions: AtlasRegion[] = [];
  forEachFrame(entry, (column, row) => regions.push({
    height: entry.frameHeight / divisor,
    width: entry.frameWidth / divisor,
    x: (entry.x + column * entry.frameWidth) / divisor,
    y: (entry.y + row * entry.frameHeight) / divisor
  }));
  return regions;
});

/** One map (0 colour, 1 world normal + leaf class) at the final size, edges dilated. */
const renderMap = (context: ViewContext, layout: TreeViewLayout, mode: number) => {
  const { gl, uniform } = context;
  const width = layout.width * SUPERSAMPLE;
  const height = layout.height * SUPERSAMPLE;
  gl.clearColor(0, 0, 0, 0);
  gl.viewport(0, 0, width, height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1i(uniform("uMode"), mode);
  for (const entry of layout.entries) drawEntry(context, entry);
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const reduced = downsample(pixels, width, height);
  dilateColor(reduced, layout.width, layout.height, 2);
  return reduced;
};

/** The bake context on a 1 x 1 canvas: its limits size the layout before the target is allocated. */
const createViewContext = (
  meshes: readonly PropMesh[],
  sources: readonly TreeViewSource[],
  leafAtlas: BakeLeafAtlas
): ViewContext => {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })!;
  const program = compileBakeProgram(gl, VIEW_VERTEX_GLSL);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  uploadLeafAtlas(gl, leafAtlas.pixels, leafAtlas.size, 0);
  uploadLeafAtlas(gl, leafAtlas.normalPixels ?? Uint8Array.from([128, 128, 255, 255]),
    leafAtlas.normalPixels ? leafAtlas.size : 1, 1);
  gl.uniform1i(uniform("uLeafAtlas"), 0);
  gl.uniform1i(uniform("uLeafNormals"), 1);
  const vaos: ViewContext["vaos"] = [];
  for (const { meshId } of sources) {
    vaos[meshId] ??= createMeshVao(gl, program, meshes[meshId]!);
  }
  return { canvas, gl, uniform, vaos };
};

/** Largest atlas side whose supersampled bake target this GPU can allocate. */
const getMaxAtlasSide = (gl: WebGL2RenderingContext) =>
  Math.floor(fitTextureSize(gl, TREE_VIEW_MAX_ATLAS_SIDE * SUPERSAMPLE) / SUPERSAMPLE);

const resizeTarget = ({ canvas }: ViewContext, layout: TreeViewLayout) => {
  canvas.width = layout.width * SUPERSAMPLE;
  canvas.height = layout.height * SUPERSAMPLE;
};

/**
 * R15a: bakes the hemispherical view blocks of the listed tree meshes (colour, mesh-space normal
 * with the leaf class in alpha) on a throw-away WebGL2 context, in a loading worker. Winter
 * sources (`bare`) drop most broadleaf clumps like the 3D winter crown. The atlas fills
 * `budgetBytes` as far as the context's texture size limit allows.
 */
export const bakeTreeViews = (
  meshes: readonly PropMesh[],
  sources: readonly TreeViewSource[],
  leafAtlas: BakeLeafAtlas,
  budgetBytes: number
): BakedTreeViews => {
  const context = profileStep("tree views context", () => createViewContext(meshes, sources, leafAtlas));
  const limits = { budgetBytes, maxAtlasSide: getMaxAtlasSide(context.gl) };
  const layout = profileStep("tree views layout", () => layoutTreeViews(meshes, sources, limits));
  resizeTarget(context, layout);
  const albedo = profileStep("tree views colour", () => renderMap(context, layout, 0));
  const { height, width } = layout;
  const normals = profileStep("tree views normal", () => downsample(renderMap(context, layout, 1), width, height));
  context.gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {
    albedo,
    albedoMips: buildAtlasMips(albedo, width, height, getFrameRegions(layout, 1), {
      alphaThreshold: 0.5, maxLevels: MIP_LEVELS, mode: "alpha-test", thinFeatureKeep: THIN_FEATURE_KEEP
    }),
    height,
    layout,
    normalMips: buildAtlasMips(normals, width / 2, height / 2, getFrameRegions(layout, 2), {
      maxLevels: MIP_LEVELS - 1, mode: "normal"
    }),
    normals,
    width
  };
};
