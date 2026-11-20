import type { IUniform } from "three";
import { positionLocal, vec4 } from "three/tsl";
import {
  AlwaysDepth,
  type ArrayCamera,
  type Camera,
  DoubleSide,
  type Light,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RenderTarget,
  Scene,
  type Side,
  type Texture,
  UnsignedByteType,
  type Vector4,
  WebGPUCoordinateSystem,
  type WebGPURenderer
} from "three/webgpu";

import { createSunDepthMaterial, createTslPropDepthMaterial, createTslRockDepthMaterial } from
  "../../webgpu/tsl/sun-depth";
import { sunShadowAtlasOf } from "../../webgpu/tsl/sun-shadow-atlas";
import { SHADOW_CASTER_LAYER, SHADOW_NEAR_CASTER_LAYER } from "../shadow-cascades";
import { prewarmPipelines } from "./pipeline-prewarm";

/** The WebGL atlas target the sun shadow pass draws: its tile rectangle and depth texture. */
export interface SunShadowSourceTarget {
  depthTexture: Texture | null;
  height: number;
  viewport: Vector4;
  width: number;
}

export interface SunShadowSetup {
  /** The WebGL pass's static caster scene (rocks, plants, buildings, animals). */
  scene: Scene;
  /** The shared shadow uniforms (`uShadowMap` keys the WebGPU atlas twin). */
  uniforms: Record<string, IUniform>;
}

interface Renderable extends Object3D {
  isMesh?: boolean;
}

/** Undefined: the caster has no depth twin on the node renderer and is not drawn (counted). */
export type SunDepthChoice = Material | undefined;

const isNodeMaterial = (material: Material) => (material as { isNodeMaterial?: boolean }).isNodeMaterial === true;
const isShaderMaterial = (material: Material) => (material as { isShaderMaterial?: boolean }).isShaderMaterial === true;

/**
 * The instanced plant/tree casters (prop sun-depth twins) draw by default. DEV opt-out
 * `?wgPropCasters=0` drops them for A/B cost runs (their device loss was the interleaved attribute
 * release, `interleaved-attribute-release.ts`).
 */
const isPropCasterOptOut = () => import.meta.env.DEV && typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("wgPropCasters") === "0";

/** WebGL depth (-1..1 after the projection) to WebGPU depth (0..1): z' = (z + w) / 2. */
const WEBGPU_DEPTH_REMAP = new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

type MaterialHolder = Object3D & { material: Material | Material[] };

/**
 * `compileAsync` draws objects with their own materials (not through the per-draw hook): the
 * casters wear their depth materials for the compile; casters without a twin leave its layers.
 * The returned restore puts back every material and layer mask.
 */
export const wearDepthMaterials = (scene: Object3D,
  materialFor: (object: Object3D, source: Material) => SunDepthChoice) => {
  const worn: { layers: number; material: Material | Material[]; object: MaterialHolder }[] = [];
  scene.traverse(object => {
    const holder = object as MaterialHolder;
    const { material } = holder;
    if (material === undefined) return;
    const sources = Array.isArray(material) ? material : [material];
    const depth = sources.map(source => materialFor(object, source));
    worn.push({ layers: object.layers.mask, material, object: holder });
    if (depth.some(choice => choice === undefined)) object.layers.mask = 0;
    else holder.material = Array.isArray(material) ? depth as Material[] : depth[0]!;
  });
  return () => {
    for (const { layers, material, object } of worn) {
      object.material = material;
      object.layers.mask = layers;
    }
  };
};

/** A full-tile quad at the far plane: clears one atlas tile (a WebGPU clear always takes the whole target). */
const createTileClear = () => {
  const material = new MeshBasicNodeMaterial({ colorWrite: false, depthFunc: AlwaysDepth, side: DoubleSide });
  material.vertexNode = vec4(positionLocal.xy, 1, 1);
  material.name = "wg:sun-shadow-clear";
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  // The clear draws through the proxy camera, which keeps the last tile's layers (the moving
  // casters' layer only after a dynamic draw): on every layer, so no tile keeps stale depth.
  quad.layers.enableAll();
  const scene = new Scene().add(quad);
  scene.matrixWorldAutoUpdate = false;
  return { dispose: () => { quad.geometry.dispose(); material.dispose(); }, scene };
};

/**
 * C-1: the WebGL sun shadow pass (three-shadows.ts) drawn by the node renderer. The game keeps
 * fitting the light cameras, scheduling the far cascade and publishing the receiver uniforms; each
 * of its tile clears and caster draws into the WebGL atlas is redirected here and drawn into the
 * WebGPU twin with the same camera, tile and depth convention. Casters get depth twins of their
 * WebGL depth materials (prop sway, leaf alpha, season/winter drop, fog hiding).
 */
// eslint-disable-next-line max-lines-per-function -- one factory owns the atlas twin, cameras and caster map
export const createSunShadowPass = (renderer: WebGPURenderer) => {
  const propCasters = !isPropCasterOptOut();
  const webgpu = renderer.coordinateSystem === WebGPUCoordinateSystem;
  const proxy = new OrthographicCamera();
  proxy.matrixAutoUpdate = false;
  proxy.matrixWorldAutoUpdate = false;
  proxy.coordinateSystem = renderer.coordinateSystem;
  const clear = createTileClear();
  const targets = new Map<Texture, RenderTarget>();
  const ported = new Map<Material, Material | null>();
  const genericBySide = new Map<Side, Material>();
  const syncs = new Set<() => void>();
  const skipped = new Map<string, number>();
  const stats = { calls: 0, milliseconds: 0, renders: 0 };
  let setup: SunShadowSetup | null = null;
  /** Non-null while a shadow render runs: `override` is the dynamic casters' shared depth draw. */
  let drawing: { override: boolean } | null = null;

  const targetOf = (source: Texture) => {
    const known = targets.get(source);
    if (known !== undefined) return known;
    const depthTexture = sunShadowAtlasOf(source);
    const { height, width } = depthTexture.image as { height: number; width: number };
    // The colour attachment is never written (casters draw depth only): one byte per texel.
    const target = new RenderTarget(width, height, { depthTexture, format: RedFormat, type: UnsignedByteType });
    target.texture.name = "wg:sun-shadow-colour";
    targets.set(source, target);
    return target;
  };

  const generic = (side: Side) => {
    const known = genericBySide.get(side);
    if (known !== undefined) return known;
    const material = createSunDepthMaterial(side);
    genericBySide.set(side, material);
    return material;
  };

  const portOf = (source: Material) => {
    if (ported.has(source)) return ported.get(source) ?? undefined;
    const material = (propCasters ? createTslPropDepthMaterial(source) : null) ?? createTslRockDepthMaterial(source);
    ported.set(source, material);
    const sync = material?.userData.syncUniforms;
    if (typeof sync === "function") syncs.add(sync as () => void);
    return material ?? undefined;
  };

  const skip = (source: Material) => {
    const shader = (source as { fragmentShader?: string }).fragmentShader ?? "";
    const key = source.name || String(source.userData.shaderKey ?? "") ||
      `${source.type}:${/void main\(\) \{\s*([^\n]{0,60})/.exec(shader)?.[1] ?? shader.length}`;
    skipped.set(key, (skipped.get(key) ?? 0) + 1);
    return undefined;
  };

  /** The depth material of one caster draw (the WebGL pass's override or the caster's own twin). */
  const materialFor = (object: Object3D, source: Material): SunDepthChoice => {
    if ((object as Renderable).isMesh !== true) return undefined;
    if (drawing?.override === true) return generic(DoubleSide);
    if (isNodeMaterial(source)) return source.colorWrite === false ? source : generic(source.side);
    if (!isShaderMaterial(source)) return generic(source.side);
    return portOf(source) ?? skip(source);
  };

  /** A WebGL light camera seen through the node renderer's depth convention. */
  const aim = (camera: Camera) => {
    proxy.matrixWorld.copy(camera.matrixWorld);
    proxy.matrixWorldInverse.copy(camera.matrixWorldInverse);
    proxy.projectionMatrix.copy(camera.projectionMatrix);
    if (webgpu) proxy.projectionMatrix.premultiply(WEBGPU_DEPTH_REMAP);
    proxy.projectionMatrixInverse.copy(proxy.projectionMatrix).invert();
    proxy.layers.mask = camera.layers.mask;
  };

  /**
   * WebGL viewports start bottom-left; the node renderer's start top-left on both backends (its
   * WebGL2 backend converts them back), and the receivers sample with a flipped v.
   */
  const setTile = (target: RenderTarget, rect: Vector4) => {
    target.viewport.set(rect.x, target.height - rect.y - rect.w, rect.z, rect.w);
  };

  const withTarget = (source: SunShadowSourceTarget, draw: (target: RenderTarget) => void) => {
    if (source.depthTexture === null) return;
    const started = performance.now();
    const target = targetOf(source.depthTexture);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try { draw(target); }
    finally {
      renderer.setRenderTarget(previous);
      stats.milliseconds += performance.now() - started;
    }
  };

  /**
   * Casters are drawn through a light-free wrapper scene per source scene. Three keeps one lights
   * node per scene: drawing a lit game scene with the light camera's layers swapped its light set
   * every pass, so each object's render object was rebuilt twice a frame and a bind group still
   * used in the same pass was destroyed (lost device, first C-1 runs). WebGL avoids the same churn
   * with `createCasterSceneLights`.
   */
  const castScenes = new WeakMap<Scene, Scene>();
  /** Borrows `scene`'s non-light children (never re-parented); `release` empties the wrapper. */
  const castSceneOf = (scene: Scene) => {
    let cast = castScenes.get(scene);
    if (cast === undefined) {
      cast = new Scene();
      cast.matrixWorldAutoUpdate = false;
      castScenes.set(scene, cast);
    }
    const { children } = cast;
    for (const child of scene.children) if ((child as Light).isLight !== true) children.push(child);
    return { cast, release: () => { children.length = 0; } };
  };

  const withCastScene = <T>(scene: Scene, use: (cast: Scene) => T): T => {
    const { cast, release } = castSceneOf(scene);
    try { return use(cast); }
    finally { release(); }
  };

  const drawScene = (scene: Scene, camera: Camera, override: boolean) => {
    const callsBefore = renderer.info.render.drawCalls;
    drawing = { override };
    try { withCastScene(scene, cast => renderer.render(cast, camera)); }
    finally {
      drawing = null;
      stats.calls += renderer.info.render.drawCalls - callsBefore;
      stats.renders += 1;
    }
  };

  /** One WebGL `render(scene, camera)` into the atlas: a light camera, or the casters' array of tiles. */
  const render = (scene: Scene, camera: Camera, source: SunShadowSourceTarget) => {
    for (const sync of syncs) sync();
    const override = scene.overrideMaterial;
    scene.overrideMaterial = null;
    const array = camera as Partial<ArrayCamera>;
    const tiles: readonly Camera[] = array.isArrayCamera === true ? array.cameras! : [camera];
    try {
      withTarget(source, target => {
        for (const tile of tiles) {
          const viewport = (tile as { viewport?: Vector4 }).viewport;
          setTile(target, array.isArrayCamera === true && viewport ? viewport : source.viewport);
          aim(tile);
          drawScene(scene, proxy, override !== null);
        }
      });
    } finally {
      scene.overrideMaterial = override;
    }
  };

  /** The WebGL scissored `clear()` of one tile. */
  const clearTile = (source: SunShadowSourceTarget) => withTarget(source, target => {
    setTile(target, source.viewport);
    renderer.render(clear.scene, proxy);
  });

  const prewarmLayer = async (scenes: readonly Scene[], override: boolean,
    around: (scene: Scene) => () => void) => {
    drawing = { override };
    const borrowed = scenes.map(castSceneOf);
    try {
      return (await prewarmPipelines(renderer, borrowed.map(({ cast }) => cast), proxy, scene => {
        const restoreMaterials = wearDepthMaterials(scene, materialFor);
        const restoreLayout = around(scene);
        return () => {
          restoreLayout();
          restoreMaterials();
        };
      })).representatives;
    } finally {
      for (const { release } of borrowed) release();
      drawing = null;
    }
  };

  /** Static casters (layers 0 + near) and the presented scenes' moving casters, behind the loading screen. */
  const prewarm = async (presented: readonly Scene[], around: (scene: Scene) => () => void) => {
    const atlas = setup?.uniforms.uShadowMap?.value as Texture | null | undefined;
    if (setup === null || !atlas) return 0;
    const target = targetOf(atlas);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    target.viewport.set(0, 0, target.width, target.height);
    try {
      proxy.layers.set(0);
      proxy.layers.enable(SHADOW_NEAR_CASTER_LAYER);
      const staticCasters = await prewarmLayer([setup.scene], false, around);
      proxy.layers.set(SHADOW_CASTER_LAYER);
      return staticCasters + await prewarmLayer(presented, true, around);
    } finally {
      renderer.setRenderTarget(previous);
    }
  };

  return {
    /** True while a shadow render runs (the presenter's per-draw hook asks `materialFor`). */
    get active() { return drawing !== null; },
    clearTile,
    dispose: () => {
      clear.dispose();
      for (const target of targets.values()) target.dispose();
      for (const material of ported.values()) material?.dispose();
      for (const material of genericBySide.values()) material.dispose();
      targets.clear();
      ported.clear();
    },
    materialFor,
    prewarm,
    render,
    /** Frame stats since the last call: draws, CPU ms of the shadow renders, casters without a twin. */
    takeStats: () => {
      const taken = { ...stats, skipped: Object.fromEntries(skipped) };
      stats.calls = 0;
      stats.milliseconds = 0;
      stats.renders = 0;
      return taken;
    },
    setSetup: (next: SunShadowSetup) => { setup = next; },
    get setup() { return setup; }
  };
};

export type SunShadowPass = ReturnType<typeof createSunShadowPass>;
