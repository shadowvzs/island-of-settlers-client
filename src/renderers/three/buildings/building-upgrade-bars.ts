import {
  GLSL3, InstancedBufferAttribute, InstancedMesh, type IUniform, Object3D, PlaneGeometry, RawShaderMaterial, Sphere,
  Vector3
} from "three";

import { DISPLAY_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";
import { pickColorDisplayUniforms } from "../color/color-output-control";

const CAPACITY = 32;
const BAR_WIDTH = 2.4;
const BAR_HEIGHT = .18;

const VERTEX = `precision highp float;
in vec3 position;
in mat4 instanceMatrix;
in float progress;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 local;
out float fill;
void main() {
  local = position.xy + 0.5;
  fill = progress;
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0, 0, 0, 1);
  center.xy += position.xy * vec2(${BAR_WIDTH.toFixed(2)}, ${BAR_HEIGHT.toFixed(2)});
  gl_Position = projectionMatrix * center;
}`;
const FRAGMENT = `precision highp float;
in vec2 local;
in float fill;
out vec4 fragColor;
${DISPLAY_COLOR_OUTPUT_GLSL}
void main() {
  vec2 size = vec2(${BAR_WIDTH.toFixed(2)}, ${BAR_HEIGHT.toFixed(2)});
  vec2 point = abs((local - 0.5) * size) - (size * 0.5 - vec2(0.035));
  float edge = length(max(point, 0.0)) + min(max(point.x, point.y), 0.0) - 0.035;
  float aa = max(fwidth(edge), 0.0001);
  float outline = 1.0 - smoothstep(-aa, aa, edge);
  float inside = 1.0 - smoothstep(-aa, aa, edge + 0.012);
  float innerX = (local.x * size.x - 0.012) / (size.x - 0.024);
  float filled = 1.0 - smoothstep(fill - fwidth(innerX), fill + fwidth(innerX), innerX);
  vec3 upgrade = mix(vec3(0.52, 0.32, 0.08), vec3(0.98, 0.76, 0.22), local.y);
  vec3 shaded = mix(upgrade * 0.66, mix(upgrade, vec3(1.0, 0.92, 0.68), 0.28), local.y);
  shaded *= 0.9 + 0.1 * clamp(innerX / max(fill, 0.001), 0.0, 1.0);
  vec3 background = mix(vec3(0.07, 0.065, 0.055), vec3(0.15, 0.135, 0.11), local.y);
  vec3 color = mix(vec3(0.19, 0.16, 0.12), mix(background, shaded, filled), inside);
  fragColor = vec4(colorDisplayOutput(color), outline * mix(0.65, 0.9, inside));
}`;

export interface BuildingUpgradeMarker { progress: number; x: number; y: number; z: number }

/** Camera-facing upgrade-progress bars; one instanced draw for every upgrading building. */
export const createBuildingUpgradeBars = (colorUniforms: Record<string, IUniform> = {}) => {
  const geometry = new PlaneGeometry(1, 1);
  const progresses = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  geometry.setAttribute("progress", progresses);
  const material = new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    depthWrite: false, transparent: true, uniforms: pickColorDisplayUniforms(colorUniforms) });
  const bars = new InstancedMesh(geometry, material, CAPACITY);
  bars.name = "building-upgrade-bars";
  bars.frustumCulled = false;
  bars.renderOrder = 10;
  bars.boundingSphere = new Sphere(new Vector3(), Infinity);
  const transform = new Object3D();
  return {
    root: bars,
    update: (markers: readonly BuildingUpgradeMarker[]) => {
      bars.count = Math.min(CAPACITY, markers.length);
      for (let index = 0; index < bars.count; index++) {
        const marker = markers[index]!;
        transform.position.set(marker.x, marker.y, marker.z);
        transform.updateMatrix();
        bars.setMatrixAt(index, transform.matrix);
        progresses.setX(index, Math.max(0, Math.min(1, marker.progress)));
      }
      bars.visible = bars.count > 0;
      bars.instanceMatrix.needsUpdate = true;
      progresses.needsUpdate = true;
    },
    dispose: () => { geometry.dispose(); material.dispose(); bars.dispose(); }
  };
};
