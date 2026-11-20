import {
  DepthTexture,
  DoubleSide,
  Frustum,
  type IUniform,
  type Light,
  Matrix4,
  MeshDepthMaterial,
  NearestFilter,
  type Object3D,
  RedFormat,
  Scene,
  type Texture,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import { type CameraState, getViewHalfExtent } from "../../render-common/camera-state";
import { ISO_PITCH } from "../../render-common/iso-projection";
import type { ViewMode } from "../../render-common/renderer-contract";
import type { SunDirection, WorldData } from "../../shared/world/world-data";
import {
  getCascadeHalfExtent,
  getCascadeRadii,
  getDynamicCascadeCount,
  getShadowAtlasLayout,
  getSlotOrigin,
  SHADOW_CASCADE_BAND,
  SHADOW_CASCADE_KERNEL_TEXELS,
  SHADOW_CASTER_LAYER
} from "./shadow-cascades";
import { createFarCascade } from "./shadow-far-cascade";
import {
  createCascadeCamera,
  createDynamicLightCamera,
  createShadowTiming,
  drawShadowTile,
  exposeSunShadowDevHook,
  setStaticLayers,
  type ShadowEye
} from "./shadow-light-cameras";
import { clampPitch } from "./three-camera";

export { SHADOW_CASTER_LAYER, SHADOW_NEAR_CASTER_LAYER } from "./shadow-cascades";
export type { ShadowEye } from "./shadow-light-cameras";
export { SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORM_NAMES } from "./sun-shadow-glsl";

/** Extra ground (units) around the view: casters just outside still shadow into it. */
const FOCUS_MARGIN = 18;
/** The fitted extent changes in steps, so the shadows only re-quantise while zooming. */
const FOCUS_STEP = 8;

/**
 * Opt-in benchmark switch (`globalThis.__probeNoCasters = true`, tools/bench/character-shadow-probe.ts):
 * drops the dynamic casters for one A/B frame. Off by default.
 */
export const isSunCasterProbeOff = () =>
  (globalThis as { __probeNoCasters?: boolean }).__probeNoCasters === true;

/**
 * Opt-in benchmark switch (`globalThis.__probeLegacyShadowFade = true`): the shadow map fades with
 * the full baked weight again (before the owner's 0.7 floor), for one A/B frame. Off by default.
 */
export const isLegacyShadowFadeProbe = () =>
  (globalThis as { __probeLegacyShadowFade?: boolean }).__probeLegacyShadowFade === true;

/** Draws the dynamic casters of one scene (its objects on SHADOW_CASTER_LAYER) into the sun map. */
export type CastSunShadows = (scene: Scene) => void;
/** Called inside the shadow pass with the cast function, once per frame. */
export type DynamicSunCasters = (cast: CastSunShadows) => void;

/** Ground area the shadow map must cover: the iso view's footprint, null for the whole world. */
export interface ShadowFocus {
  radius: number;
  x: number;
  z: number;
}

export interface SunShadowOptions {
  /** Possessed-view cascades (QualityPreset.shadowCascadesFps); 1 by default. */
  cascades?: number;
  enabled: boolean;
  /** QualityPreset.shadowFilter; "pcf3" by default. */
  filter?: "pcf3" | "poisson12";
  mapSize: number;
  /** GPU texture limit for the cascade atlas; 4096 by default. */
  maxTextureSize?: number;
}

/**
 * The iso view's ground footprint (screen height stretched by the pitch); the cinematic camera
 * sees to the horizon, so it keeps the whole world map.
 */
export const getShadowFocus = (state: CameraState, mode: ViewMode): ShadowFocus | null => {
  if (mode !== "iso") return null;
  const { halfHeight, halfWidth } = getViewHalfExtent(state);
  const pitch = clampPitch(ISO_PITCH + state.tilt);
  return {
    radius: Math.hypot(halfWidth, halfHeight / Math.sin(pitch)),
    x: state.centerX,
    z: state.centerZ
  };
};

/**
 * Shadow caster variants compile without the sun shadow lookup: a sampled uShadowMap while the
 * shadow pass writes that depth texture is a framebuffer feedback loop (the draw is dropped).
 */
export const getDepthOnlyDefines = (depthOnly: boolean): Record<string, string> =>
  depthOnly ? { DEPTH_ONLY: "" } : {};

const enableCasterLayerOnLight = (object: Object3D) => {
  if ((object as Light).isLight) object.layers.enable(SHADOW_CASTER_LAYER);
};

/**
 * A caster scene's lights also pass the light camera's layer test. Three keeps one light setup per
 * scene: when the caster pass saw no lights and the main draw saw them, the setup changed twice a
 * frame and every lit material of the scene re-resolved its program (getParameters/getProgram)
 * on both draws. The pass draws depth only, so the lights it now collects change no pixel.
 * Scenes are rescanned when their child count changes (lights are created with their layer roots).
 */
const createCasterSceneLights = () => {
  const scanned = new WeakMap<Scene, number>();
  return (scene: Scene) => {
    if (scanned.get(scene) === scene.children.length) return;
    scanned.set(scene, scene.children.length);
    scene.traverse(enableCasterLayerOnLight);
  };
};

/**
 * Draws only `roots` (world matrices already current, never re-parented) through a cast: the sun
 * pass traverses these subtrees instead of a whole layer scene. The light-free list scene has its
 * own render state, so the layer scene's light setup is untouched; the list is emptied afterwards.
 */
export const createCasterRootScene = () => {
  const scene = new Scene();
  scene.matrixWorldAutoUpdate = false;
  return (cast: CastSunShadows, roots: readonly Object3D[]) => {
    if (roots.length === 0) return;
    const { children } = scene;
    for (let index = 0; index < roots.length; index++) children.push(roots[index]!);
    try { cast(scene); }
    finally { children.length = 0; }
  };
};

const createShadowUniforms = (enabled: boolean, poisson: boolean, isoSize: number): Record<string, IUniform> => ({
  uShadowAtlas: { value: new Vector2(1, 1) },
  uShadowCascades: { value: new Vector4(1, SHADOW_CASCADE_BAND, 0, poisson ? 1 : 0) },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new Matrix4() },
  uShadowMatrix1: { value: new Matrix4() },
  uShadowMatrix2: { value: new Matrix4() },
  uShadowSlots: { value: new Vector4(0, 1, 2, 1) },
  uShadowTexel: { value: 1 / isoSize },
  uShadowTexelWorld: { value: new Vector3(1, 1, 1) },
  uSunShadowWeight: { value: 1 },
  uSunShadows: { value: enabled ? 1 : 0 }
});

/** True for the sun shadow atlas's depth texture (the WebGPU presenter draws its own twin). */
export const isSunShadowDepthTexture = (texture: Texture | null | undefined): texture is Texture =>
  (texture?.userData as { sunShadowAtlas?: boolean } | undefined)?.sunShadowAtlas === true;

/** The colour attachment is never written (casters draw depth only): one byte per texel. */
const createDepthTarget = (width: number, height: number) => {
  const target = new WebGLRenderTarget(width, height, {
    depthTexture: new DepthTexture(width, height, UnsignedIntType),
    format: RedFormat,
    type: UnsignedByteType
  });
  target.depthTexture!.minFilter = NearestFilter;
  target.depthTexture!.magFilter = NearestFilter;
  // isSunShadowDepthTexture: the WebGPU presenter draws its own twin (webgpu/tsl/sun-shadow-atlas.ts).
  target.depthTexture!.userData.sunShadowAtlas = true;
  return target;
};

/**
 * Sun shadow depth atlas. The isometric view (and tools) draw one map fitted to the focus or the
 * whole world; the possessed view with cascades draws eye-centred tiles (R08): the detailed ones
 * every frame (with the moving casters), the far one through its own schedule (shadow-far-cascade).
 * Map size 1 when off: the uniform still needs a depth texture, nothing renders into it.
 */
// eslint-disable-next-line max-lines-per-function -- one factory owns the atlas, cameras and pass
export const createSunShadows = (
  world: Pick<WorldData, "cellsX" | "cellsZ">,
  { cascades = 1, enabled, filter = "pcf3", mapSize, maxTextureSize = 4096 }: SunShadowOptions
) => {
  const layout = getShadowAtlasLayout(mapSize, enabled ? cascades : 1, maxTextureSize);
  const target = createDepthTarget(layout.width, layout.height);
  const worldHalf = Math.max(world.cellsX, world.cellsZ) * 0.78;
  const worldCentre = new Vector3(world.cellsX / 2, 0, world.cellsZ / 2);
  const centre = new Vector3();
  const radii = getCascadeRadii(layout.cascades);
  const farIndex = radii.length - 1;
  const cascadeCameras = radii.map((_, index) => createCascadeCamera(index));
  const detailed = cascadeCameras.slice(0, farIndex);
  const single = createCascadeCamera(0);
  const far = createFarCascade(farIndex, layout);
  const dynamicCascades = createDynamicLightCamera(cascadeCameras.slice(0, Math.max(1, getDynamicCascadeCount(radii))));
  const dynamicSingle = createDynamicLightCamera([single]);
  const scene = new Scene();
  // The pass updates the static casters' matrices once, then draws them per tile.
  scene.matrixWorldAutoUpdate = false;
  const viewProjection = new Matrix4();
  const frustum = new Frustum();
  const timing = createShadowTiming();
  // Depth only: no colour write; both faces, so open cloth and sails keep their shadow.
  const casterDepth = new MeshDepthMaterial({ colorWrite: false, side: DoubleSide });
  /**
   * Last frame's shadow pass: draws/triangles of the static scene and of the dynamic casters, the
   * CPU submission time of the dynamic casters and of the whole pass (fit + draws, ms, GPU time
   * excluded) and the cascades in use.
   */
  const stats = {
    cascades: 1, casterDrawCalls: 0, casterMilliseconds: 0, casterTriangles: 0, drawCalls: 0,
    milliseconds: 0, triangles: 0
  };
  let castRenderer: WebGLRenderer | null = null;
  let cascadeMode = false;
  /** prepare() ran for this frame's render (its fit and time are reused). */
  let prepared = false;
  let prepareMilliseconds = 0;
  const uniforms = createShadowUniforms(enabled, filter === "poisson12", layout.isoSize);
  uniforms.uShadowMap!.value = target.depthTexture;
  const matrixUniforms = [uniforms.uShadowMatrix!, uniforms.uShadowMatrix1!, uniforms.uShadowMatrix2!];
  const removeDevHook = exposeSunShadowDevHook(uniforms.uShadowCascades as IUniform<Vector4>, timing);

  const fitSingle = (sun: SunDirection, focus: ShadowFocus | null) => {
    const fitted = focus ? Math.ceil((focus.radius + FOCUS_MARGIN) / FOCUS_STEP) * FOCUS_STEP : 0;
    const isFitted = focus !== null && fitted < worldHalf;
    if (isFitted) centre.set(focus.x, 0, focus.z);
    else centre.copy(worldCentre);
    single.fit(centre, isFitted ? fitted : worldHalf, sun, layout.isoSize);
    single.viewport.set(0, 0, layout.isoSize, layout.isoSize);
    return single.camera;
  };

  const fitCascades = (sun: SunDirection, eye: ShadowEye) => {
    centre.set(eye.x, eye.y, eye.z);
    for (const cascade of cascadeCameras) {
      const { index } = cascade;
      cascade.fit(centre, getCascadeHalfExtent(radii[index]!, index === farIndex, layout.tile), sun, layout.tile);
      const origin = getSlotOrigin(index, layout.tile, layout.columns);
      cascade.viewport.set(origin.x, origin.y, layout.tile, layout.tile);
    }
    return cascadeCameras[farIndex]!.camera;
  };

  /**
   * Fits the light cameras (the single map at the focus or the whole world; with an `eye` and
   * cascades the eye-centred atlas) and returns the world frustum of everything they cover. The
   * vegetation caster mask uses this exact projection, so casters outside the main camera view
   * are preserved only while they can contribute to the map.
   */
  const prepare = (sun: SunDirection, focus: ShadowFocus | null, eye: ShadowEye | null = null): Frustum | null => {
    if (!enabled) return null;
    const startedAt = performance.now();
    cascadeMode = eye !== null && layout.cascades > 1;
    const outer = cascadeMode ? fitCascades(sun, eye!) : fitSingle(sun, focus);
    viewProjection.multiplyMatrices(outer.projectionMatrix, outer.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    prepared = true;
    prepareMilliseconds = performance.now() - startedAt;
    return frustum;
  };

  const shareCasterSceneLights = createCasterSceneLights();
  let dynamicCamera = dynamicSingle;
  /** One dynamic caster scene: its caster layer, drawn with the shared depth material. */
  const cast: CastSunShadows = (casterScene) => {
    const renderer = castRenderer;
    if (!renderer) return;
    shareCasterSceneLights(casterScene);
    const previous = casterScene.overrideMaterial;
    casterScene.overrideMaterial = casterDepth;
    renderer.render(casterScene, dynamicCamera());
    casterScene.overrideMaterial = previous;
    stats.casterDrawCalls += renderer.info.render.calls;
    stats.casterTriangles += renderer.info.render.triangles;
  };

  const renderDynamicCasters = (renderer: WebGLRenderer, casters: DynamicSunCasters | undefined) => {
    if (!casters) return;
    const start = performance.now();
    castRenderer = renderer;
    dynamicCamera = cascadeMode ? dynamicCascades : dynamicSingle;
    try { casters(cast); }
    finally {
      castRenderer = null;
      stats.casterMilliseconds = performance.now() - start;
    }
  };

  const addDraw = (drawn: { calls: number; triangles: number }) => {
    stats.drawCalls += drawn.calls;
    stats.triangles += drawn.triangles;
  };

  /** The detailed tiles (with near-only casters) every frame, the far one by its schedule. */
  const drawStaticCascades = (renderer: WebGLRenderer) => {
    for (const cascade of detailed) {
      setStaticLayers(cascade.camera, true);
      const { viewport } = cascade;
      addDraw(drawShadowTile(renderer, target, scene, cascade.camera,
        { height: viewport.w, width: viewport.z, x: viewport.x, y: viewport.y }));
    }
    addDraw(far.draw(renderer, target, scene, cascadeCameras[farIndex]!));
  };

  const drawStaticSingle = (renderer: WebGLRenderer) => {
    far.invalidate();
    setStaticLayers(single.camera, true);
    addDraw(drawShadowTile(renderer, target, scene, single.camera,
      { height: layout.isoSize, width: layout.isoSize, x: 0, y: 0 }));
  };

  /** Uniforms of this frame; the far cascade keeps the matrix and slot of its last complete map. */
  const publish = () => {
    const size = cascadeMode ? layout.tile : layout.isoSize;
    uniforms.uShadowAtlas!.value.set(size / layout.width, size / layout.height);
    uniforms.uShadowCascades!.value.x = cascadeMode ? cascadeCameras.length : 1;
    uniforms.uShadowCascades!.value.z = cascadeMode ? SHADOW_CASCADE_KERNEL_TEXELS / size : 0;
    uniforms.uShadowTexel!.value = 1 / size;
    const texelWorld = uniforms.uShadowTexelWorld!.value as Vector3;
    const slots = uniforms.uShadowSlots!.value as Vector4;
    slots.w = cascadeMode ? layout.columns : 1;
    const nearTiles = cascadeMode ? detailed : [single];
    for (const cascade of nearTiles) {
      (matrixUniforms[cascade.index]!.value as Matrix4).copy(cascade.matrix);
      texelWorld.setComponent(cascade.index, (cascade.halfExtent * 2) / size);
      slots.setComponent(cascade.index, cascade.index);
    }
    if (!cascadeMode) return;
    (matrixUniforms[farIndex]!.value as Matrix4).copy(far.published.matrix);
    texelWorld.setComponent(farIndex, (far.published.halfExtent * 2) / size);
    slots.setComponent(farIndex, far.published.slot);
  };

  /**
   * Renders the shadow casters from the current light direction into the depth atlas: the single
   * map over the focus area (full texel density where the player looks) or the whole world, or
   * with an `eye` the possessed cascades. `casters` adds the moving casters of other scenes into
   * the single map or the detailed tiles, without clearing them.
   */
  const render = (
    renderer: WebGLRenderer,
    sun: SunDirection,
    focus: ShadowFocus | null,
    casters?: DynamicSunCasters,
    eye: ShadowEye | null = null
  ) => {
    stats.casterDrawCalls = 0;
    stats.casterMilliseconds = 0;
    stats.casterTriangles = 0;
    stats.drawCalls = 0;
    stats.triangles = 0;
    if (!enabled) return;
    const startedAt = performance.now();
    if (!prepared) prepare(sun, focus, eye);
    const fitMilliseconds = prepareMilliseconds;
    prepared = false;
    stats.cascades = cascadeMode ? cascadeCameras.length : 1;
    scene.updateMatrixWorld();
    // Depth only: the scene order (grouped by caster kind) beats a per-tile sort by distance.
    const sortObjects = renderer.sortObjects;
    renderer.sortObjects = false;
    if (cascadeMode) drawStaticCascades(renderer);
    else drawStaticSingle(renderer);
    renderDynamicCasters(renderer, casters);
    renderer.sortObjects = sortObjects;
    publish();
    renderer.setRenderTarget(null);
    stats.milliseconds = performance.now() - startedAt + fitMilliseconds;
    timing.add(stats.milliseconds);
  };

  return {
    dispose: () => {
      removeDevHook();
      casterDepth.dispose();
      target.depthTexture?.dispose();
      target.dispose();
    },
    prepare,
    render,
    /** Shadow map strength 0..1 this frame (getSunShadowWeight of the environment). */
    setStrength: (weight: number) => { uniforms.uSunShadowWeight!.value = weight; },
    scene,
    /** R02/C07 receipt: the last shadow pass's draws and triangles. */
    stats: () => stats,
    /** R08 receipt: mean and p95 main-thread ms of the recent shadow passes. */
    timing: timing.report,
    uniforms
  };
};
