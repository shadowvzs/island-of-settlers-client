/**
 * ?glemulate=mali (tests on desktop, lazy chunk): the WebGL2 context pretends to be a mid-range
 * Mali GPU (Mali-G68 / G57 in Chrome): no OES_texture_float_linear, no EXT_color_buffer_float,
 * no EXT_float_blend, and mobile limits. Everything that asks for these sees the phone's answer.
 */
const HIDDEN_EXTENSIONS = new Set([
  "OES_texture_float_linear",
  "EXT_color_buffer_float",
  "EXT_float_blend"
]);

/** Typical Mali Chrome WebGL2 limits (parameter enum -> value). */
const MALI_LIMITS: Record<number, number> = {
  0x0d33: 8192, // MAX_TEXTURE_SIZE
  0x84e8: 8192, // MAX_RENDERBUFFER_SIZE
  0x8872: 16, // MAX_TEXTURE_IMAGE_UNITS
  0x8dfc: 15, // MAX_VARYING_VECTORS
  0x8869: 16, // MAX_VERTEX_ATTRIBS
  0x8dfd: 224 // MAX_FRAGMENT_UNIFORM_VECTORS
};

export const installMaliEmulation = () => {
  const proto = WebGL2RenderingContext.prototype;
  const getExtension = proto.getExtension as (name: string) => unknown;
  const getSupportedExtensions = proto.getSupportedExtensions;
  const getParameter = proto.getParameter;
  proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
    return HIDDEN_EXTENSIONS.has(name) ? null : getExtension.call(this, name);
  } as typeof proto.getExtension;
  proto.getSupportedExtensions = function (this: WebGL2RenderingContext) {
    const names = getSupportedExtensions.call(this);
    return names ? names.filter((name) => !HIDDEN_EXTENSIONS.has(name)) : names;
  };
  proto.getParameter = function (this: WebGL2RenderingContext, parameter: number) {
    const value: unknown = getParameter.call(this, parameter);
    const limit = MALI_LIMITS[parameter];
    return limit !== undefined && typeof value === "number" ? Math.min(value, limit) : value;
  };
};
