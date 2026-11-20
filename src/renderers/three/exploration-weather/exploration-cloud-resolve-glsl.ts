import { EXPLORATION_CLOUD_RESOLVE } from "../../../render-common/atmosphere/exploration-sky-constants";
import { glslLiteral } from "../../../render-common/shaders/glsl-literal";
import { EXPLORATION_CLOUD_MARCH_LIMIT, EXPLORATION_SKY_SHELL_GLSL } from "./exploration-sky-cloud-glsl";
import { EXPLORATION_VIEW_RAY_GLSL } from "./exploration-sky-shader";

/**
 * Temporal resolve of the half-resolution cloud march: last frame's clouds reprojected by the camera
 * rotation and the wind drift, read with a sharp Catmull-Rom filter, variance-clipped to this frame's
 * neighbourhood and blended by the CPU's frame-rate independent weight (exploration-cloud-history.ts).
 */
const RESOLVE = EXPLORATION_CLOUD_RESOLVE;

export const EXPLORATION_CLOUD_RESOLVE_GLSL = `precision highp float;
in vec2 vScreen;
out vec4 fragColor;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;
uniform mat4 uPreviousViewProjection;
uniform vec2 uCloudDriftDelta;
uniform float uHistoryWeight;
/** Representative cloud depth for the wind reprojection: the dense lower part of the shell. */
const float CLOUD_REPROJECTION_ALTITUDE = ${glslLiteral(RESOLVE.reprojectionAltitude)};
const float CLOUD_REPROJECTION_LIMIT = ${EXPLORATION_CLOUD_MARCH_LIMIT.toFixed(1)};
/** Upper parts drift ahead of the base (wind shear, detail erosion): the mean of both. */
const float CLOUD_DRIFT_SHARE = ${glslLiteral(RESOLVE.driftShare)};
${EXPLORATION_VIEW_RAY_GLSL}
${EXPLORATION_SKY_SHELL_GLSL}

/**
 * Where this pixel's cloud was last frame: the world direction moved back by the wind drift at the
 * cloud deck (the noise is sampled at point + drift, so a feature now at P was at P + delta).
 */
vec3 previousCloudDirection(vec3 direction, float cameraAltitude) {
  if (direction.y <= 0.0) return direction;
  float distanceToDeck = skyShellDistance(direction, cameraAltitude, CLOUD_REPROJECTION_ALTITUDE);
  if (!(distanceToDeck > 0.0) || distanceToDeck > CLOUD_REPROJECTION_LIMIT) return direction;
  vec3 drift = vec3(uCloudDriftDelta.x, 0.0, uCloudDriftDelta.y) * CLOUD_DRIFT_SHARE;
  return normalize(direction * distanceToDeck + drift);
}

/**
 * Five-tap Catmull-Rom history read: bilinear resampling under continuous camera motion blurs the
 * history a little every frame and, kept for many frames, smears thin wisps.
 */
vec4 sampleHistory(vec2 uv) {
  vec2 size = vec2(textureSize(uHistory, 0));
  vec2 position = uv * size;
  vec2 centre = floor(position - 0.5) + 0.5;
  vec2 f = position - centre;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 uv0 = (centre - 1.0) / size;
  vec2 uv3 = (centre + 2.0) / size;
  vec2 uv12 = (centre + w2 / w12) / size;
  vec4 sum = texture(uHistory, vec2(uv12.x, uv0.y)) * (w12.x * w0.y);
  sum += texture(uHistory, vec2(uv0.x, uv12.y)) * (w0.x * w12.y);
  sum += texture(uHistory, uv12) * (w12.x * w12.y);
  sum += texture(uHistory, vec2(uv3.x, uv12.y)) * (w3.x * w12.y);
  sum += texture(uHistory, vec2(uv12.x, uv3.y)) * (w12.x * w3.y);
  float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(sum / weight, 0.0);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 limit = textureSize(uCurrent, 0) - 1;
  vec4 current = texelFetch(uCurrent, pixel, 0);
  vec4 mean = vec4(0.0);
  vec4 meanSquare = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 neighbour = texelFetch(uCurrent, clamp(pixel + ivec2(x, y), ivec2(0), limit), 0);
    mean += neighbour;
    meanSquare += neighbour * neighbour;
  }
  mean /= 9.0;
  vec4 deviation = sqrt(max(meanSquare / 9.0 - mean * mean, 0.0));
  // Three quarters of the 3x3 mean filter this frame's jitter: where history is rejected (fast
  // turns, new sky at the screen edge) the clouds show soft grain instead of the raw per-pixel offset.
  vec4 filtered = mix(current, mean, ${glslLiteral(RESOLVE.currentMeanShare)});
  // A restart never reads the history: an unwritten target must not leak into the result.
  if (!(uHistoryWeight > 0.0)) {
    fragColor = filtered;
    return;
  }
  vec3 rayOrigin;
  vec3 direction = explorationViewRay(vScreen, rayOrigin);
  vec4 previousClip = uPreviousViewProjection *
    vec4(previousCloudDirection(direction, max(rayOrigin.y, 0.0)), 0.0);
  vec2 previousUv = previousClip.xy / max(previousClip.w, 0.0001) * 0.5 + 0.5;
  bool inside = previousClip.w > 0.0 && all(greaterThanEqual(previousUv, vec2(0.0))) &&
    all(lessThanEqual(previousUv, vec2(1.0)));
  if (!inside) {
    fragColor = filtered;
    return;
  }
  // Screen motion in cloud pixels: turning and drifting history keeps less weight and a tighter clip.
  vec2 motionPixels = (previousUv - (vScreen * 0.5 + 0.5)) * vec2(limit + 1);
  float motion = smoothstep(${glslLiteral(RESOLVE.motionStart)}, ${glslLiteral(RESOLVE.motionEnd)}, length(motionPixels));
  float clipWidth = mix(${glslLiteral(RESOLVE.clipStill)}, ${glslLiteral(RESOLVE.clipMoving)}, motion);
  // Variance clipping: history outside the current neighbourhood's spread is pulled back in.
  vec4 history = clamp(sampleHistory(previousUv),
    mean - deviation * clipWidth, mean + deviation * clipWidth);
  fragColor = mix(filtered, history, uHistoryWeight * mix(1.0, ${glslLiteral(RESOLVE.movingHistoryShare)}, motion));
}
`;
