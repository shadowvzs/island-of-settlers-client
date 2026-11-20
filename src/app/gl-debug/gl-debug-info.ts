import { readGlLimits } from "../../render-common/gl-limits";
import { FULL_GROUND_NEEDS } from "../../render-common/ground-shader-variant";

/** One titled block of "label: value" rows of the GL diagnostics view. */
export interface GlInfoSection {
  rows: [string, string][];
  title: string;
}

/** Precision formats worth a screenshot (fragment highp float is the usual mobile suspect). */
const PRECISIONS = [
  ["fragment highp float", "FRAGMENT_SHADER", "HIGH_FLOAT"],
  ["fragment mediump float", "FRAGMENT_SHADER", "MEDIUM_FLOAT"],
  ["fragment highp int", "FRAGMENT_SHADER", "HIGH_INT"],
  ["vertex highp float", "VERTEX_SHADER", "HIGH_FLOAT"]
] as const;

/** Extensions the renderers use or a mobile driver typically lacks. */
const EXTENSIONS = [
  "KHR_parallel_shader_compile",
  "EXT_disjoint_timer_query_webgl2",
  "EXT_texture_filter_anisotropic",
  "OES_texture_float_linear",
  "EXT_color_buffer_float",
  "EXT_color_buffer_half_float",
  "EXT_float_blend",
  "WEBGL_compressed_texture_astc",
  "WEBGL_compressed_texture_etc",
  "WEBGL_compressed_texture_s3tc"
];

/** "2^-127..2^127, 23 bits" (0 bits and range: the precision is not supported). */
export const formatPrecision = (format: WebGLShaderPrecisionFormat | null) => {
  if (!format || (format.precision === 0 && format.rangeMax === 0)) return "not supported";
  return `2^-${format.rangeMin}..2^${format.rangeMax}, ${format.precision} bits`;
};

/** Supported ones first ("+name"), then the missing ones ("-name"). */
export const formatExtensions = (supported: readonly string[], wanted: readonly string[]) => {
  const has = wanted.filter((name) => supported.includes(name));
  const missing = wanted.filter((name) => !supported.includes(name));
  return [...has.map((name) => `+${name}`), ...missing.map((name) => `-${name}`)].join(" ");
};

const readGpu = (gl: WebGL2RenderingContext): [string, string][] => {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null;
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null;
  const attributes = gl.getContextAttributes();
  return [
    ["vendor", String(vendor ?? gl.getParameter(gl.VENDOR))],
    ["renderer", String(renderer ?? gl.getParameter(gl.RENDERER))],
    ["version", String(gl.getParameter(gl.VERSION))],
    ["glsl", String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION))],
    ["context", `antialias ${attributes?.antialias}, depth ${attributes?.depth}, ` +
      `stencil ${attributes?.stencil}, lost ${gl.isContextLost()}`],
    ["buffer", `${gl.drawingBufferWidth} x ${gl.drawingBufferHeight} ` +
      `(devicePixelRatio ${window.devicePixelRatio})`]
  ];
};

const readLimitRows = (gl: WebGL2RenderingContext): [string, string][] => {
  const limits = readGlLimits(gl);
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  return [
    ["MAX_TEXTURE_SIZE", String(limits.maxTextureSize)],
    ["MAX_RENDERBUFFER_SIZE", String(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))],
    ["MAX_TEXTURE_IMAGE_UNITS", String(limits.maxTextureImageUnits)],
    ["MAX_COMBINED_TEXTURE_IMAGE_UNITS",
      String(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS))],
    ["MAX_VERTEX_ATTRIBS", String(limits.maxVertexAttribs)],
    ["MAX_VARYING_VECTORS", String(limits.maxVaryingVectors)],
    ["MAX_FRAGMENT_UNIFORM_VECTORS", String(limits.maxFragmentUniformVectors)],
    ["MAX_VERTEX_UNIFORM_VECTORS", String(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS))],
    ["MAX_SAMPLES", String(gl.getParameter(gl.MAX_SAMPLES))],
    ["MAX_VIEWPORT_DIMS", `${viewport[0]} x ${viewport[1]}`]
  ];
};

const readPrecisionRows = (gl: WebGL2RenderingContext): [string, string][] =>
  PRECISIONS.map(([label, shader, precision]) => [
    label,
    formatPrecision(gl.getShaderPrecisionFormat(gl[shader], gl[precision]))
  ]);

/** Everything a phone screenshot needs to diagnose a GPU (static: read once). */
export const readGlInfo = (gl: WebGL2RenderingContext, layerSize: number): GlInfoSection[] => [
  { rows: readGpu(gl), title: "GPU" },
  { rows: readLimitRows(gl), title: "Limits" },
  { rows: readPrecisionRows(gl), title: "Precision" },
  {
    rows: [["extensions", formatExtensions(gl.getSupportedExtensions() ?? [], EXTENSIONS)]],
    title: "Extensions"
  },
  {
    rows: [
      ["full ground needs", `layers ${layerSize} px, ${FULL_GROUND_NEEDS.fragmentSamplers} ` +
        `samplers, ${FULL_GROUND_NEEDS.varyingVectors} varyings, ` +
        `${FULL_GROUND_NEEDS.vertexAttribs} attributes`],
      ["active variant", "the HUD's ground line (none: full)"]
    ],
    title: "Ground"
  }
];
