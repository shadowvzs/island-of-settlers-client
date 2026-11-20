import {
  type Camera, Color, Float32BufferAttribute, type IUniform, Matrix4, Mesh, PlaneGeometry,
  Scene, Vector2, type WebGLRenderer, WebGLRenderTarget
} from "three";

import { WATER_GLSL } from "../../src/render-common/shaders/water-glsl";
import { encodeWaterDepth } from "../../src/render-common/water-field";
import { createGroundLayerTextures } from "../../src/renderers/three/three-ground-layers";
import {
  createAtlasTexture, createTerrainMaterial, createWaterMaterial
} from "../../src/renderers/three/three-materials";
import { compareAtmospherePixels, readAtmospherePixels } from "./atmosphere-gpu";

/** Production ground/water shader coverage. Full renderer orchestration is checked in live game. */
export const createAtmosphereWaterFixture = (
  renderer: WebGLRenderer,
  uniforms: Record<string, IUniform>,
  waterShader?: string
) => {
  const solidTexture = (rgba: number[]) => createAtlasTexture(new Uint8Array(rgba), 1, 1);
  /** One 1 x 1 layer: every ground layer index clamps to it. */
  const { albedo, normal } = createGroundLayerTextures({ albedoHeight: new Uint8Array([90, 110, 70, 150]),
    layerCount: 1, normalRoughness: new Uint8Array([128, 128, 255, 220]), size: 1 }, 1);
  /** Water three units deep, three cells off the coast. */
  const field = solidTexture([encodeWaterDepth(3), 96, 255, 0]);
  const ripples = solidTexture([128, 128, 128, 128]);
  const shadow = solidTexture([255, 255, 255, 255]);
  const capture = new WebGLRenderTarget(1920, 1080);
  const local: Record<string, IUniform> = {
    ...uniforms,
    uRefraction: { value: capture.texture },
    uShadowMap: { value: shadow },
    uShadowMatrix: { value: new Matrix4() },
    uShadowTexel: { value: 1 },
    uSunShadows: { value: 0 },
    uViewport: { value: new Vector2(1920, 1080) },
    uWaterField: { value: field },
    uWaterNormals: { value: ripples }
  };
  const geometry = new PlaneGeometry(256, 256, 4, 4);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(128, 0, 128);
  const count = geometry.getAttribute("position").count;
  const attribute = (name: string, value: number[]) => {
    const items = new Float32Array(count * 4);
    for (let index = 0; index < count; index++) items.set(value, index * 4);
    geometry.setAttribute(name, new Float32BufferAttribute(items, 4));
  };
  attribute("splatA", [1, 0, 0, 0]);
  attribute("splatB", [0, 0, 0, 0]);
  attribute("splatC", [0, 0, 0, 0]);
  attribute("shading", [1, 1, 1, 0]);
  attribute("surface", [0, 0, 0, 0]);
  attribute("water", [3, -2, 0, 0]);
  const bedGeometry = geometry.clone();
  bedGeometry.translate(0, -3, 0);
  const ground = createTerrainMaterial(local, albedo, normal, "lite");
  const refracted = createWaterMaterial(local, true);
  const blended = createWaterMaterial(local, false);
  if (waterShader) for (const material of [refracted, blended])
    material.fragmentShader = material.fragmentShader.replace(WATER_GLSL, waterShader);
  const bedScene = new Scene();
  // Force the same clear during each draw; renderer.clear() alone can inherit another scene's colour.
  bedScene.background = new Color(0);
  const bed = new Mesh(bedGeometry, ground);
  bedScene.add(bed);
  const waterScene = new Scene();
  const water = new Mesh(geometry, refracted);
  waterScene.add(water);
  const render = (camera: Camera, refraction: boolean, density: number) => {
    local.uAtmosphereProfile!.value[0] = density;
    if (refraction) {
      const saved = local.uAtmospherePass!.value;
      try {
        local.uAtmospherePass!.value = 0;
        renderer.setRenderTarget(capture);
        renderer.clear();
        renderer.render(bedScene, camera);
      } finally {
        renderer.setRenderTarget(null);
        local.uAtmospherePass!.value = saved;
      }
    }
    renderer.clear();
    renderer.render(bedScene, camera);
    water.material = refraction ? refracted : blended;
    renderer.render(waterScene, camera);
  };
  const compare = (camera: Camera, refraction: boolean) => {
    render(camera, refraction, 0);
    const before = readAtmospherePixels(renderer);
    render(camera, refraction, .035);
    return compareAtmospherePixels(before, readAtmospherePixels(renderer));
  };
  const captureParity = (camera: Camera) => {
    const saved = local.uAtmospherePass!.value;
    const savedWaterField = local.uWaterField!.value;
    const dryField = solidTexture([0, 96, 255, 0]);
    renderer.setRenderTarget(capture);
    try {
      // A dry surface ensures this checks the pass flag rather than the underwater bypass.
      local.uWaterField!.value = dryField;
      local.uAtmospherePass!.value = 0;
      local.uAtmosphereProfile!.value[0] = 0;
      renderer.clear();
      renderer.render(bedScene, camera);
      const before = readAtmospherePixels(renderer);
      local.uAtmosphereProfile!.value[0] = .035;
      renderer.clear();
      renderer.render(bedScene, camera);
      return compareAtmospherePixels(before, readAtmospherePixels(renderer));
    } finally {
      renderer.setRenderTarget(null);
      local.uAtmospherePass!.value = saved;
      local.uWaterField!.value = savedWaterField;
      dryField.dispose();
    }
  };
  const dispose = () => {
    ground.dispose(); refracted.dispose(); blended.dispose();
    geometry.dispose(); bedGeometry.dispose(); capture.dispose();
    for (const texture of [albedo, normal, field, ripples, shadow]) texture.dispose();
  };
  const setSurface = (depth: number, flow: readonly number[], coast = -2) => {
    const pixels = field.image.data as Uint8Array;
    pixels[0] = Math.round((depth + 1) / 7 * 255);
    pixels[1] = Math.round((coast / 16 + .5) * 255);
    field.needsUpdate = true;
    const water = geometry.getAttribute("water");
    for (let vertex = 0; vertex < water.count; vertex++) {
      water.setX(vertex, depth); water.setZ(vertex, flow[0]!); water.setW(vertex, flow[1]!);
    }
    water.needsUpdate = true;
    bed.position.y = 3 - depth;
  };
  return { captureParity, compare, dispose, render, setSurface };
};
