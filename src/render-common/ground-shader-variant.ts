import { reportGlIssue } from "./gl-diagnostics";
import { type GlLimits,readGlLimits } from "./gl-limits";

/**
 * Ground shader variant: "full" (GROUND_GLSL) or "lite" (GROUND_LITE_GLSL, for
 * GPUs whose driver cannot build the full one). Chosen by queried WebGL limits and by the real
 * compile / link result, never by the user agent.
 */
export type GroundShaderVariant = "full" | "lite";

/** ?ground=full|lite forces a variant (tests, screenshots); "auto" decides from the GPU. */
export type GroundShaderRequest = GroundShaderVariant | "auto";

/** What the full ground draw needs. */
export interface GroundShaderNeeds {
  /** Ground texture array layer edge (px). */
  layerSize: number;
  /** Samplers in the fragment shader (Three: noise, fog, snow, water normals and field, the 2
   * ground texture arrays, the shadow map). */
  fragmentSamplers: number;
  /** Uniform vectors of the fragment shader (shared uniforms, shadow matrix; generous). */
  fragmentUniformVectors: number;
  /** vWorld, vNormal, vSplatA/B/C, vShading, vSurface, vWater. */
  varyingVectors: number;
  /** position / screen position, world, normal, splatA/B/C, shading, surface, water. */
  vertexAttribs: number;
}

export const FULL_GROUND_NEEDS: Omit<GroundShaderNeeds, "layerSize"> = {
  // 8 shared atlases + micro detail (T06b) + cover field (T04) + traffic wear (R14e).
  fragmentSamplers: 11,
  fragmentUniformVectors: 32,
  varyingVectors: 9,
  vertexAttribs: 9
};

export interface GroundShaderChoice {
  /** Why it is not the full ground (null: full). */
  reason: string | null;
  variant: GroundShaderVariant;
}

export const readGroundShaderRequest = (value: string | null): GroundShaderRequest =>
  value === "full" || value === "lite" ? value : "auto";

/** ?ground= wins; otherwise the Detail setting may ask for the lite variant. */
export const applyLiteGround = (request: GroundShaderRequest, liteGround: boolean) =>
  request === "auto" && liteGround ? "lite" : request;

/** The limits the full ground exceeds, as "name need > limit" (empty: it fits). */
export const findExceededLimits = (limits: GlLimits, needs: GroundShaderNeeds) => {
  const checks: [string, number, number][] = [
    ["texture size", needs.layerSize, limits.maxTextureSize],
    ["fragment samplers", needs.fragmentSamplers, limits.maxTextureImageUnits],
    ["fragment uniform vectors", needs.fragmentUniformVectors, limits.maxFragmentUniformVectors],
    ["varying vectors", needs.varyingVectors, limits.maxVaryingVectors],
    ["vertex attributes", needs.vertexAttribs, limits.maxVertexAttribs]
  ];
  return checks
    .filter(([, need, limit]) => need > limit)
    .map(([name, need, limit]) => `${name} ${need} > ${limit}`);
};

/** The variant to try first: the request, else full unless a limit rules it out. */
export const chooseGroundShader = (
  request: GroundShaderRequest,
  limits: GlLimits,
  needs: GroundShaderNeeds
): GroundShaderChoice => {
  if (request === "full") return { reason: null, variant: "full" };
  if (request === "lite") return { reason: "forced (?ground=lite or Detail)", variant: "lite" };
  const exceeded = findExceededLimits(limits, needs);
  if (exceeded.length === 0) return { reason: null, variant: "full" };
  return { reason: `limits: ${exceeded.join(", ")}`, variant: "lite" };
};

/**
 * The ground shader state: starts with the chosen variant; a failed build steps down to
 * the lite ground (console warning, GL diagnostics); a failed lite ground is reported loudly (the
 * ground would stay blank). `describe` is the HUD line (null while the full ground runs).
 */
export const createGroundShaderState = (initial: GroundShaderChoice) => {
  let choice = initial;
  let failed = false;
  /** Returns the variant to build next, or null when there is no fallback left. */
  const fail = (log: string): GroundShaderVariant | null => {
    reportGlIssue({ kind: "ground", log, name: `ground shader (${choice.variant})` });
    if (choice.variant === "lite") {
      failed = true;
      console.error("Ground: the lite ground shader failed too, the ground stays blank.", log);
      return null;
    }
    console.warn("Ground: the full ground shader failed, using the lite ground.", log);
    choice = { reason: "full shader failed", variant: "lite" };
    return "lite";
  };
  const describe = () => {
    if (failed) return "FAILED (see ?gldebug=1)";
    return choice.reason ? `${choice.variant} (${choice.reason})` : null;
  };
  return {
    describe,
    fail,
    get variant() {
      return choice.variant;
    }
  };
};

export type GroundShaderState = ReturnType<typeof createGroundShaderState>;

/** Marker every ground fragment shader source contains (both variants). */
export const GROUND_SHADER_MARKER = "GroundSample sampleGround(";

/** Program and shader info logs of a failed program (for the warning and the diagnostics). */
export const readProgramLogs = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  shaders: WebGLShader[] = gl.getAttachedShaders(program) ?? []
) =>
  [gl.getProgramInfoLog(program), ...shaders.map((shader) => gl.getShaderInfoLog(shader))]
    .map((log) => log?.replaceAll("\0", "").trim())
    .filter(Boolean)
    .join("\n")
    .trim() || "link failed (no log)";

/** The ground shader state of a renderer's context (the request, its limits, the layer size). */
export const createGroundShaderStateForGl = (
  gl: WebGL2RenderingContext,
  request: GroundShaderRequest,
  layerSize: number
) =>
  createGroundShaderState(
    chooseGroundShader(request, readGlLimits(gl), { ...FULL_GROUND_NEEDS, layerSize })
  );

/** The HUD detail: `ground` only while the ground is not the full variant. */
export const describeGround = (state: GroundShaderState): Record<string, string> => {
  const text = state.describe();
  return text ? { ground: text } : {};
};
