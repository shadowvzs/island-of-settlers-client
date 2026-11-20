import { readShaderName, reportGlIssue } from "../../render-common/gl-diagnostics";

/** GL error names of texture uploads. */
const GL_ERRORS: Record<number, string> = {
  0x0500: "INVALID_ENUM",
  0x0501: "INVALID_VALUE",
  0x0502: "INVALID_OPERATION",
  0x0505: "OUT_OF_MEMORY"
};

const TEXTURE_UPLOADS = ["texImage2D", "texStorage2D", "texImage3D", "texStorage3D"] as const;

/** 32-bit float internal formats (R32F, RG32F, RGB32F, RGBA32F). */
const FLOAT32_FORMATS = new Set([0x822e, 0x8230, 0x8815, 0x8814]);

type Proto = WebGL2RenderingContext;

/**
 * A 32-bit float texture is only filterable with OES_texture_float_linear (often missing on
 * Mali): sampled with LINEAR or mipmaps it is incomplete and reads as black.
 */
const reportUnfilterableFloat = (gl: Proto, name: string, args: unknown[]) => {
  if (!FLOAT32_FORMATS.has(args[2] as number)) return;
  if (gl.getExtension("OES_texture_float_linear")) return;
  const size = args.slice(3, 5).join(" x ");
  reportGlIssue({
    kind: "texture",
    log: `float32 texture ${size}: only NEAREST works (no OES_texture_float_linear)`,
    name
  });
};

/** "texImage2D 4096 x 16384: INVALID_VALUE" (the size args when the call has them). */
const describeUpload = (name: string, args: unknown[], error: number) => {
  const size = args.slice(3, 5).filter((value) => typeof value === "number");
  return `${name} ${size.join(" x ")}: ${GL_ERRORS[error] ?? error}`;
};

const hookCompile = (proto: Proto) => {
  const compile = proto.compileShader;
  proto.compileShader = function (this: Proto, shader: WebGLShader) {
    compile.call(this, shader);
    if (this.getShaderParameter(shader, this.COMPILE_STATUS)) return;
    const source = this.getShaderSource(shader) ?? "";
    reportGlIssue({
      kind: "shader",
      log: this.getShaderInfoLog(shader) ?? "compile failed (no log)",
      name: `compile ${readShaderName(source)}`
    });
  };
};

const hookLink = (proto: Proto) => {
  const link = proto.linkProgram;
  proto.linkProgram = function (this: Proto, program: WebGLProgram) {
    link.call(this, program);
    if (this.getProgramParameter(program, this.LINK_STATUS)) return;
    const sources = (this.getAttachedShaders(program) ?? []).map(
      (shader) => this.getShaderSource(shader) ?? ""
    );
    reportGlIssue({
      kind: "shader",
      log: this.getProgramInfoLog(program) ?? "link failed (no log)",
      name: `link ${sources.map(readShaderName).join(" + ")}`
    });
  };
};

/**
 * Texture uploads check the GL error right after (a sync call: debug runs only); the error flag
 * is cleared before, so an earlier call's error is not blamed on the upload.
 */
const hookTextureUploads = (proto: Proto) => {
  for (const name of TEXTURE_UPLOADS) {
    const methods = proto as unknown as Record<string, (...args: unknown[]) => void>;
    const upload = methods[name]!;
    methods[name] = function (this: Proto, ...args: unknown[]) {
      this.getError();
      upload.apply(this, args);
      reportUnfilterableFloat(this, name, args);
      const error = this.getError();
      if (error !== this.NO_ERROR) {
        reportGlIssue({ kind: "texture", log: describeUpload(name, args, error), name });
      }
    };
  }
};

/**
 * ?gldebug=1 only (this module is loaded lazily): every WebGL2 shader compile / link failure and
 * texture upload error is reported to the GL diagnostics. The checks are synchronous (they stop
 * the parallel shader compile), so they never run in a normal session. Install before any
 * context draws (the renderer and the graphics probe).
 */
export const installGlDebugHooks = () => {
  const proto = WebGL2RenderingContext.prototype;
  hookCompile(proto);
  hookLink(proto);
  hookTextureUploads(proto);
};
