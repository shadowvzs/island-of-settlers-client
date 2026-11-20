import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  GLSL3,
  type IUniform,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
  type Vector2,
  type WebGLRenderer
} from "three";

import { COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from "../../render-common/shaders/common-glsl";
import { RAIN_OVERLAY_GLSL } from "../../render-common/shaders/rain-glsl";

const VERTEX_GLSL = `
precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_GLSL = `
precision highp float;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${RAIN_OVERLAY_GLSL}
${COLOR_OUTPUT_GLSL}
void main() {
  vec4 precipitation = rainOverlay(gl_FragCoord.xy);
  fragColor = vec4(colorOutputPremultiplied(precipitation.rgb, precipitation.a), precipitation.a);
}
`;

/**
 * Full screen precipitation pass drawn after the scene (premultiplied blend, no depth): rain or
 * snowfall.
 */
export const createThreeRain = (uniforms: Record<string, IUniform>, viewport: Vector2,
  onLightning?: () => void) => {
  const precipitation: IUniform<number> = { value: 0 };
  const snowfall: IUniform<number> = { value: 0 };
  const lightning: IUniform<number> = { value: 0 };
  let flash = 0, lastTime = 0, nextLightningAt = 5 + Math.random() * 12;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new RawShaderMaterial({
    blendDst: OneMinusSrcAlphaFactor,
    blendSrc: OneFactor,
    blending: CustomBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    transparent: true,
    uniforms: {
      ...uniforms,
      uPrecipitation: precipitation,
      uSnowfall: snowfall,
      uLightning: lightning,
      uViewportSize: { value: viewport }
    },
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera();

  /** amount: 0 dry .. 1 heavy; snowShare: how much of it is snow (0 rain .. 1 snow). */
  const render = (renderer: WebGLRenderer, weather: { amount: number; snowShare: number }) => {
    const time = Number(uniforms.uTime?.value ?? 0);
    const dry = weather.amount <= 0.01;
    // A cinematic strike flashes in clear weather too: the pass then draws the flash only.
    if (dry && flash <= 0) {
      lightning.value = 0;
      lastTime = time;
      return;
    }
    if (!dry && weather.amount > .55 && time >= nextLightningAt) {
      flash = 1;
      nextLightningAt = time + 8 + Math.random() * 22;
      onLightning?.();
    }
    const delta = Math.max(0, time - lastTime);
    lastTime = time;
    flash = Math.max(0, flash - delta * 3.8);
    precipitation.value = dry ? 0 : weather.amount;
    snowfall.value = weather.snowShare;
    lightning.value = flash;
    renderer.render(scene, camera);
  };

  /** Starts one screen flash now (CIN2 strike at a point); it fades like a storm flash. */
  const startFlash = () => { flash = 1; };

  return { flash: startFlash, render };
};
