import { BufferAttribute, BufferGeometry, type Camera, Color, GLSL3, type IUniform, Matrix4, Mesh, RawShaderMaterial,
  Scene, type WebGLRenderer } from "three";

import { ATMOSPHERE_GLSL } from "../../render-common/atmosphere/atmosphere-glsl";
import { SKY_RADIANCE_GLSL, skyRadianceDefines } from "../../render-common/atmosphere/sky-view-lut";
import { CLOUD_FIELD_GLSL } from "../../render-common/shaders/cloud-glsl";
import { AIR_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from "../../render-common/shaders/common-glsl";

/** Background-only sky: one triangle, no cloud meshes, extra textures or shadow-map pass. */
export const createThreeClouds = (uniforms: Record<string, IUniform>, background: number) => {
  const inverseProjection = new Matrix4(), cameraWorld = new Matrix4();
  let lastDraw = 0;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]), 3));
  const material = new RawShaderMaterial({
    defines: skyRadianceDefines(uniforms),
    glslVersion: GLSL3, depthTest: true, depthWrite: false,
    uniforms: { ...uniforms, uInverseProjection: { value: inverseProjection },
      uCameraWorld: { value: cameraWorld }, uBackground: { value: new Color(background) } },
    vertexShader: `precision highp float;
      in vec3 position; out vec2 vScreen;
      // z = w: the far plane, so the depth test (LEQUAL) keeps the sky behind every drawn surface.
      void main() { vScreen = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: `precision highp float;
      in vec2 vScreen; out vec4 fragColor;
      uniform mat4 uInverseProjection; uniform mat4 uCameraWorld; uniform vec3 uBackground;
      uniform float uDaylight;
      ${COMMON_UNIFORMS_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_FIELD_GLSL}
      ${ATMOSPHERE_GLSL}
      ${AIR_COLOR_OUTPUT_GLSL}
      ${SKY_RADIANCE_GLSL}
      void main() {
        vec4 nearPoint = uInverseProjection * vec4(vScreen, -1.0, 1.0);
        vec4 farPoint = uInverseProjection * vec4(vScreen, 1.0, 1.0);
        vec3 origin = (uCameraWorld * vec4(nearPoint.xyz / nearPoint.w, 1.0)).xyz;
        vec3 direction = normalize((uCameraWorld * vec4(farPoint.xyz / farPoint.w, 1.0)).xyz - origin);
        float horizon = smoothstep(-0.08, 0.12, direction.y);
        if (horizon < 0.001) {
          fragColor = vec4(finishColorToward(uBackground,
            atmosphereOpticalDepth(atmosphereSkyRay(direction)), direction), 1.0);
          return;
        }
        float daylight = clamp(max(max(uAmbientSky.r, uAmbientSky.g), uAmbientSky.b) * 1.6, 0.0, 1.0);
        // The shared sky (R06b): the same radiance the possessed view, SH light and water use.
        vec3 sunDirection = normalize(uSunDirection);
        vec3 color = mix(uBackground, skyBackdrop(direction, sunDirection, uDaylight, uBackground), horizon);
        // A real sun/moon disc on the light direction: the sky now shows what lights the island.
        float sunDot = dot(direction, sunDirection);
        float disc = smoothstep(0.9991, 0.99955, sunDot);
        float halo = pow(max(sunDot, 0.0), 18.0);
        vec3 sunTint = mix(vec3(0.58, 0.70, 0.96), vec3(1.0, 0.86, 0.60), daylight);
        color += sunTint * (disc * (1.3 + daylight * 2.0) + halo * 0.24);
        float distanceToCloud = (CLOUD_HEIGHT - origin.y) / (abs(direction.y) < 0.001 ? 0.001 : direction.y);
        if (distanceToCloud > 0.0) {
          // Grazing slab projection aliases into ribbons; keep distant puffs angular near the horizon.
          // Shadows retain the physical shared field; horizon sky position is an approximation.
          float angularBlend = 1.0 - smoothstep(0.05, 0.2, direction.y);
          vec2 angular = origin.xz + normalize(direction.xz) * (1200.0 + direction.y * 1200.0);
          vec2 xz = mix(origin.xz + direction.xz * distanceToCloud, angular, angularBlend);
          float density = cloudDensity(xz);
          float lowerDistance = (CLOUD_HEIGHT - 6.0 - origin.y) / max(direction.y, 0.001);
          float upperDistance = (CLOUD_HEIGHT + 6.0 - origin.y) / max(direction.y, 0.001);
          float lower = cloudDensity(mix(origin.xz + direction.xz * lowerDistance, angular - vec2(0.0, 8.0), angularBlend));
          float upper = cloudDensity(mix(origin.xz + direction.xz * upperDistance, angular + vec2(0.0, 8.0), angularBlend));
          float opacity = 1.0 - exp(-(density * 0.8 + lower * 0.35 + upper * 0.45));
          float silver = clamp(dot(direction, uSunDirection), 0.0, 1.0);
          float shade = clamp(0.8 + (upper - lower) * 0.15 + silver * 0.1, 0.65, 1.0);
          vec3 cloud = mix(uFogColor, vec3(0.94, 0.95, 0.98) * daylight, 0.8) * shade;
          float haze = 1.0 - smoothstep(900.0, 2800.0, distanceToCloud);
          color = mix(color, cloud, opacity * haze * horizon);
        }
        fragColor = vec4(finishColorToward(color,
          atmosphereOpticalDepth(atmosphereSkyRay(direction)), direction), 1.0);
      }`
  });
  // The WebGPU presenter recognises the background sky by this tag and builds its TSL twin.
  material.userData.wgIsoSky = true;
  const scene = new Scene(), mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Highest render order + z = w: the opaque world writes depth first, then only sky pixels shade.
  mesh.renderOrder = 1_000_000;
  scene.add(mesh);
  const update = (camera: Camera) => {
    lastDraw = 0;
    const visible = !(camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera;
    mesh.visible = visible;
    if (!visible) return;
    camera.updateMatrixWorld();
    inverseProjection.copy(camera.projectionMatrixInverse); cameraWorld.copy(camera.matrixWorld);
    lastDraw = 1;
  };
  return {
    root: mesh,
    update,
    render(renderer: WebGLRenderer, camera: Camera) {
      update(camera);
      if (mesh.visible) renderer.render(scene, camera);
    },
    dispose() { geometry.dispose(); material.dispose(); },
    getStats: () => ({ cloudDrawCalls: lastDraw, cloudTriangles: lastDraw, cloudExtraTextures: 0 })
  };
};
