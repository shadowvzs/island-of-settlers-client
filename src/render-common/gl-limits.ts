/** The WebGL limits the renderers' fallbacks are chosen by (queried, never by user agent). */
export interface GlLimits {
  maxFragmentUniformVectors: number;
  maxTextureImageUnits: number;
  maxTextureSize: number;
  maxVaryingVectors: number;
  maxVertexAttribs: number;
}

export const readGlLimits = (gl: WebGL2RenderingContext): GlLimits => ({
  maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number,
  maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
  maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
  maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS) as number,
  maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number
});

/** A texture / render target edge clamped to what this GPU can allocate. */
export const fitTextureSize = (gl: WebGL2RenderingContext, size: number) =>
  Math.min(
    size,
    gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number
  );
