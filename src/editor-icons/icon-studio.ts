import {
  ACESFilmicToneMapping,
  Box3,
  type IUniform,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer} from "three";

import { computeEnvironment } from "../render-common/environment";
import { createNoiseTexture, NOISE_TEXTURE_SIZE } from "../render-common/noise-textures";
import {
  createSharedUniformValues,
  updateSharedUniformValues
} from "../render-common/shader-uniforms";
import type { PaintedTexture } from "../render-common/trees/atlas-canvas";
import {
  createAtlasTexture,
  createRepeatTexture,
  createThreeUniforms
} from "../renderers/three/three-materials";
import { createSunShadows } from "../renderers/three/three-shadows";
import { DEFAULT_SUN } from "../shared/world/lighting";

/** Render size of one item before it is trimmed and scaled to the icon. */
const RENDER_PIXELS = 512;
/** The items stand at the middle of a small stage (the sun shadow map covers it). */
export const STAGE_CENTRE = 8;
const STAGE = { cellsX: STAGE_CENTRE * 2, cellsZ: STAGE_CENTRE * 2 } as const;
const SHADOW_MAP = 2048;
const NOISE_SEED = 77;
/** Midday light; the camera looks down like the game's view, a little from the side. */
const HOUR = 11;
const VIEW = new Vector3(0.9, 0.75, 1).normalize();
const FIELD_OF_VIEW = 24;

/** What the studio renders: the item and its sun shadow casters. */
export interface StudioItem {
  casters: Object3D[];
  main: Object3D;
}

/**
 * A small offscreen Three studio with the game's own lighting (shared uniforms, sun shadows):
 * renders one item at a time on a transparent background, framed to its bounds, for the icons.
 * `view` points from the item to the camera (review tools look from the side).
 */
export const createIconStudio = (foliage: PaintedTexture, view = VIEW, pixels = RENDER_PIXELS) => {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(pixels, pixels, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  const values = createSharedUniformValues(STAGE);
  const environment = computeEnvironment(DEFAULT_SUN, HOUR, 0);
  updateSharedUniformValues(values, { environment, time: 0 });
  values.uViewDirection.set([view.x, view.y, view.z]);
  const shadows = createSunShadows(STAGE, { enabled: true, mapSize: SHADOW_MAP });
  const uniforms: Record<string, IUniform> = {
    ...createThreeUniforms(values),
    ...shadows.uniforms,
    uLeafAtlas: { value: createAtlasTexture(foliage.color, foliage.width, foliage.height) },
    uLeafNormals: { value: createAtlasTexture(foliage.normal, foliage.width, foliage.height) },
    uNoiseTexture: {
      value: createRepeatTexture(createNoiseTexture(NOISE_SEED), NOISE_TEXTURE_SIZE)
    },
    uSnowMap: { value: createAtlasTexture(new Uint8Array(4), 1, 1) }
  };
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 400);

  /** Points the camera at the bounding sphere so it fills the view. */
  const frame = ({ center, radius }: Sphere) => {
    const distance = radius / Math.sin((FIELD_OF_VIEW * Math.PI) / 360);
    camera.position.copy(center).addScaledVector(view, distance);
    camera.near = Math.max(0.01, distance - radius * 2);
    camera.far = distance + radius * 2;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };

  /** Renders the item (with its own sun shadow) and returns the studio canvas. */
  const shoot = ({ casters, main }: StudioItem) => {
    const sphere = new Box3().setFromObject(main).getBoundingSphere(new Sphere());
    shadows.scene.clear();
    shadows.scene.add(...casters);
    const focus = { radius: sphere.radius, x: sphere.center.x, z: sphere.center.z };
    shadows.render(renderer, environment.sun, focus);
    frame(sphere);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(new Scene().add(main), camera);
    return renderer.domElement;
  };

  return { shoot, uniforms };
};

export type IconStudio = ReturnType<typeof createIconStudio>;
