import type { WebGLRenderer } from "three";

import { readShaderName, reportGlIssue } from "../../render-common/gl-diagnostics";
import {
  GROUND_SHADER_MARKER,
  type GroundShaderState,
  type GroundShaderVariant,
  readProgramLogs} from "../../render-common/ground-shader-variant";

/**
 * Three's shader error hook (it only runs when a program fails, so it costs nothing): every
 * failure is logged and reported to the GL diagnostics; a failed ground program steps the ground
 * down to the lite variant after the current frame (`onGroundFallback` swaps the material).
 */
export const watchThreeShaderErrors = (
  renderer: WebGLRenderer,
  ground: GroundShaderState,
  onGroundFallback: (variant: GroundShaderVariant) => void
) => {
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const context = gl as WebGL2RenderingContext;
    const log = readProgramLogs(context, program, [vertexShader, fragmentShader]);
    const source = context.getShaderSource(fragmentShader) ?? "";
    if (!source.includes(GROUND_SHADER_MARKER)) {
      const name = readShaderName(source);
      console.error(`THREE.WebGLProgram: ${name} failed`, log);
      reportGlIssue({ kind: "shader", log, name });
      return;
    }
    const next = ground.fail(log);
    if (next) queueMicrotask(() => onGroundFallback(next));
  };
};
