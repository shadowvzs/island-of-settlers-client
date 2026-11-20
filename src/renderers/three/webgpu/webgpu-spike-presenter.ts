import { attribute, dot, positionWorld, texture, uv, vec3, vec4 } from "three/tsl";
import {
  type BufferGeometry,
  type Camera,
  Color,
  HalfFloatType,
  LinearFilter,
  LineBasicNodeMaterial,
  type Material,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Object3D,
  PointsNodeMaterial,
  RenderTarget,
  RGBAFormat,
  type Scene,
  SpriteNodeMaterial,
  type Texture,
  Vector2,
  WebGPURenderer
} from "three/webgpu";

import { applyBuildingMaterialExtensions } from "../../webgpu/tsl/buildings";
import {
  createTslPostChain, isPostAntialiasOptOut, type TslPostChain, type TslPostSettings
} from "../../webgpu/tsl/post/post-chain";
import { createShipClothNodes } from "../../webgpu/tsl/ship-cloth";
import { setSunShadowUniforms, sunShadowReceiverOf, syncSunShadowUniforms } from "../../webgpu/tsl/sun-shadow";
import { SunShadowedStandardNodeMaterial } from "../../webgpu/tsl/sun-shadow-lighting";
import { type WaterPassInputs } from "../../webgpu/tsl/water";
import { createAsyncPipelineCompiler } from "./async-pipeline-compiler";
import { createDrawObject } from "./webgpu-spike-draw-object";
import { createMaterialPorting } from "./webgpu-spike-material-porter";
import { createScenePasses } from "./webgpu-spike-scene-passes";
import { createIdlePipelinePrewarm } from "./idle-pipeline-prewarm";
import { createInstanceMatrixVariants } from "./instance-matrix-variants";
import { releaseInterleavedAttributesWithBuffer } from "./interleaved-attribute-release";
import { createPipelineTracker } from "./pipeline-tracker";
import { createShaderRequests, prewarmScenePrepasses, renderScenePrepasses } from "./presenter-hooks";
import { spikeCategoryOf } from "./spike-categories";
import { colorOf, type CopyTexture, syncStandInMaps, textureOf } from "./stand-in-map";
import { createSunShadowPass } from "./sun-shadow-pass";
import { createVertexBufferPacker } from "./vertex-buffer-packing";
import {
  type CreateWebGpuSpikePresenter,
  type WebGpuSpikePresenter,
  type WebGpuSpikeStats
} from "./webgpu-spike-types";

/**
 * WG-0 measurement harness. The WebGL renderer still builds and updates the real scene; this
 * presenter draws that same scene through `WebGPURenderer` with stand-in node materials, so the
 * draw count, geometry and instancing stay comparable. It is not a production renderer.
 */

const CLEAR_COLOR = 0x0b2238;
const DEFAULT_COLOR = 0x9aa0a6;
const MAX_FRAME_SAMPLES = 240;
/**
 * WG-0 stand-ins are colour-only: native WebGPU rejected a few game atlases in `writeTexture`,
 * and the measurement needs the same draw count, not the source pixels.
 */
const COPY_TEXTURES = false;
/** Road DataTextures are small and use the standard uv; other atlases stay colour-only. */
const COPY_ROAD_TEXTURES = true;

const BUILDING_SURFACE_COLORS: Record<string, number> = {
  bark: 0x8e806a,
  cloth: 0xb7a58b,
  iron: 0x655e54,
  plaster: 0xd4b987,
  planks: 0xd2c0a3,
  roof: 0xa65a3a,
  "roof-shingles": 0x8b8170,
  "roof-thatch": 0xc6a85c,
  rope: 0xb4a47f,
  stone: 0xcbc5b3,
  wood: 0xa89985
};

const CATEGORY_COLORS: Record<string, number> = {
  building: 0xc2a878,
  default: DEFAULT_COLOR,
  foliage: 0x4f7a39,
  ice: 0xa9c6d2,
  rock: 0x8b8b86,
  terrain: 0x6f8a4d,
  water: 0x2e6f8e,
  worker: 0xd9c3a3
};

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * C-1: a WebGL sun shadow receiver: built-in materials hooked by `connectSunShadowReceivers` and
 * custom shaders that call `sampleSunShadow` (units, animals). Their standard stand-ins get it too.
 */
const isSunShadowReceiver = (source: Material) => source.userData.sunShadowReceiver === true ||
  (source as { fragmentShader?: string }).fragmentShader?.includes("sampleSunShadow(") === true;

/** A standard stand-in, with the sun shadow on its direct light when the source received it. */
const createStandard = (source: Material, sunVisibility: TslNode,
  parameters: ConstructorParameters<typeof MeshStandardNodeMaterial>[0]) => {
  if (sunVisibility === null || !isSunShadowReceiver(source)) return new MeshStandardNodeMaterial(parameters);
  const material = new SunShadowedStandardNodeMaterial(parameters);
  material.sunVisibility = sunVisibility;
  return material;
};

/** A plain node material with the source's colour/opacity. No custom shader is carried over. */
const createStandIn = (source: Material, object: Object3D, usedTextures: boolean, copyTexture: CopyTexture,
  sunVisibility: TslNode) => {
  const category = spikeCategoryOf(object);
  const surface = (object.userData as { buildingSurface?: unknown }).buildingSurface;
  const sourceColor = colorOf(source);
  const surfaceColor = typeof surface === "string" ? BUILDING_SURFACE_COLORS[surface] : undefined;
  const fallbackColor = surfaceColor ?? CATEGORY_COLORS[category] ?? DEFAULT_COLOR;
  const objectData = object.userData as {
    nightLampLit?: boolean; windowGlass?: boolean; windowLit?: boolean; windowShadow?: boolean;
  };
  const windowLike = objectData.windowGlass === true || objectData.windowShadow === true ||
    source.name.includes("window");
  let windowColor = 0x334b57;
  if (objectData.windowLit === true) windowColor = 0xffd98a;
  else if (objectData.windowShadow === true) windowColor = 0x202b35;
  let color = sourceColor === undefined || sourceColor === 0xffffff ? fallbackColor : sourceColor;
  if (windowLike) color = windowColor;
  // A map carries its own albedo; only an explicit non-white source tint multiplies it.
  const mapTint = sourceColor !== undefined && sourceColor !== 0xffffff ? sourceColor : 0xffffff;
  const standardSource = source as {
    aoMapIntensity?: number; bumpScale?: number; emissive?: Color; emissiveIntensity?: number;
    flatShading?: boolean; metalness?: number; normalScale?: Vector2;
    roughness?: number;
  };
  const common = {
    alphaTest: source.alphaTest,
    colorWrite: source.colorWrite,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    flatShading: standardSource.flatShading === true,
    opacity: source.opacity,
    polygonOffset: source.polygonOffset,
    polygonOffsetFactor: source.polygonOffsetFactor,
    polygonOffsetUnits: source.polygonOffsetUnits,
    side: source.side,
    transparent: source.transparent,
    vertexColors: source.vertexColors === true
  };
  const kind = object as { isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
  const materialKind = source as {
    isMeshBasicMaterial?: boolean;
    isShadowMaterial?: boolean;
    isSpriteMaterial?: boolean;
  };
  const copyMap = (key: Parameters<typeof textureOf>[1]) => {
    const texture = textureOf(source, key);
    return texture == null ? undefined : copyTexture(texture) ?? texture;
  };
  const map = copyMap("map");
  // A vertex-coloured, map-less surface carries its albedo in the mesh; multiplying the category
  // fallback (road edge stones, coloured props) darkens it on the node renderer.
  if (common.vertexColors && map == null && (sourceColor === undefined || sourceColor === 0xffffff))
    color = 0xffffff;
  // Every lit map follows the source, including premium timber/linen and pirate KTX2 atlases.
  const standardLighting = {
    aoMap: copyMap("aoMap"),
    aoMapIntensity: standardSource.aoMapIntensity ?? 1,
    bumpMap: copyMap("bumpMap"),
    bumpScale: standardSource.bumpScale ?? 1,
    emissive: standardSource.emissive?.getHex() ?? 0x000000,
    emissiveIntensity: standardSource.emissiveIntensity ?? 1,
    emissiveMap: copyMap("emissiveMap"),
    metalness: standardSource.metalness ?? 0,
    metalnessMap: copyMap("metalnessMap"),
    normalMap: copyMap("normalMap"),
    normalScale: standardSource.normalScale?.clone(),
    roughness: standardSource.roughness ?? .85,
    roughnessMap: copyMap("roughnessMap")
  };
  // A lit lamp keeps its warm emissive on the node renderer too; the building-surface branch below
  // otherwise draws a colour-only stand-in and the glow would disappear.
  const lampGlow = objectData.nightLampLit === true ? {
    emissive: standardLighting.emissive,
    emissiveIntensity: standardLighting.emissiveIntensity,
    emissiveMap: standardLighting.emissiveMap
  } : { emissive: 0x000000 };
  const uniforms = (source as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  const grass = (uniforms?.uIsGrass?.value as number | undefined) === 1;
  // A foliage-card stand-in needs the card uv and instance tint; ground decals share the prop
  // uniforms but have neither attribute, so they must not sample the leaf atlas.
  const geometry = (object as { geometry?: BufferGeometry }).geometry;
  const cardGeometry = geometry?.hasAttribute("uv") === true &&
    geometry.hasAttribute("instanceTint") === true;
  const foliageAtlas = category === "foliage" && !grass && cardGeometry
    ? uniforms?.uLeafAtlas?.value as Texture | undefined
    : undefined;
  const rockTexture = category === "rock"
    ? uniforms?.uRockTexture?.value as Texture | undefined
    : undefined;
  const roadTexture = COPY_ROAD_TEXTURES &&
    String(source.userData?.shaderKey ?? "").includes("road") &&
    map?.isTexture === true && (map as { isDataTexture?: boolean }).isDataTexture === true;
  let created: Material;
  if (rockTexture?.isTexture === true) {
    const grayscale = dot(texture(rockTexture, uv()).rgb, vec3(0.299, 0.587, 0.114));
    created = new MeshBasicNodeMaterial({ ...common, color: 0xffffff });
    (created as { colorNode?: unknown }).colorNode = vec3(grayscale.mul(0.62)) as unknown;
  } else if (foliageAtlas?.isTexture === true) {
    const atlasUv = uv();
    const card = atlasUv.x.greaterThan(-0.5);
    const leaf = texture(foliageAtlas, atlasUv);
    const tint = (attribute("color", "vec3") as any).mul(attribute("instanceTint", "vec3"));
    const shade = (attribute("normal", "vec3") as any).dot(vec3(0.35, 0.8, 0.45))
      .max(0).mul(0.65).add(0.35);
    const albedo = card.select(leaf.rgb.mul(tint).mul(vec3(0.36, 0.66, 0.30)).mul(shade),
      tint.mul(shade));
    const alpha = card.select(leaf.a, 1);
    created = new MeshBasicNodeMaterial({ ...common, alphaTest: 0.5, color: 0xffffff,
      vertexColors: false });
    (created as { colorNode?: unknown }).colorNode = vec4(albedo, alpha) as unknown;
  } else if (roadTexture) {
    created = new MeshBasicNodeMaterial({ ...common, color: 0xffffff, map });
  } else if (typeof surface === "string" && !windowLike) {
    created = createStandard(source, sunVisibility, {
      ...common,
      ...lampGlow,
      color: sourceColor === undefined || sourceColor === 0xffffff ? 0xffffff : sourceColor,
      map,
      metalness: standardLighting.metalness,
      normalMap: standardLighting.normalMap,
      roughness: standardLighting.roughness,
      roughnessMap: standardLighting.roughnessMap
    });
  } else if (kind.isPoints === true) {
    created = new PointsNodeMaterial({ ...common, color, size: (source as { size?: number }).size ?? 1 });
  } else if (kind.isLine === true) {
    created = new LineBasicNodeMaterial({ ...common, color });
  } else if (kind.isSprite === true) {
    created = new SpriteNodeMaterial({ ...common, alphaMap: copyMap("alphaMap"),
      color: map == null ? color : mapTint, map });
  } else if (materialKind.isMeshBasicMaterial === true || materialKind.isShadowMaterial === true ||
    materialKind.isSpriteMaterial === true) {
    created = new MeshBasicNodeMaterial({ ...common, alphaMap: copyMap("alphaMap"),
      color: map == null ? color : mapTint, map, transparent: source.transparent || map != null });
  } else {
    created = createStandard(source, sunVisibility, {
      ...common,
      ...standardLighting,
      alphaMap: copyMap("alphaMap"),
      color: map == null ? color : mapTint,
      map
    });
  }
  if (usedTextures && (created as { map?: Texture }).map === undefined &&
    map?.isTexture === true) (created as { map?: Texture }).map = map;
  const cloth = createShipClothNodes(source);
  if (cloth !== null && (created as { isNodeMaterial?: boolean }).isNodeMaterial === true) {
    const nodeMaterial = created as Material & { normalNode?: unknown; positionNode?: unknown };
    nodeMaterial.positionNode = cloth.positionNode;
    nodeMaterial.normalNode = cloth.normalNode;
    created.userData.syncUniforms = cloth.syncUniforms;
    created.name = "wg5:ship-cloth";
  } else created.name = `wg0:${source.type}`;
  // TSL-9 building extensions: construction clipping, hanging-decor sway, Nubian cloth wind.
  const buildingExtension = applyBuildingMaterialExtensions(created, source, object);
  if (buildingExtension !== null) {
    created.name = `wg0:${buildingExtension}`;
    created.userData.wg0Extension = buildingExtension;
  }
  created.userData.wg0StandIn = true;
  // A map present at build time is final: the late-map sync must not flatten the tint to white.
  if (map != null && (created as { map?: Texture | null }).map != null)
    created.userData.wg4MapSource = textureOf(source, "map");
  return created;
};

const sunVisibilityOf = (sunShadows: ReturnType<typeof createSunShadowPass>) => () => {
  const uniforms = sunShadows.setup?.uniforms;
  return uniforms === undefined ? null : sunShadowReceiverOf(uniforms)?.sample(positionWorld) ?? null;
};

const createAdapterName = (adapter: GPUAdapter | null) => {
  if (adapter === null) return "webgl-backend";
  const info = adapter.info;
  const name = [info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(" ");
  return name || "webgpu";
};

/** The WebGL2 backend has no per-pipeline vertex buffer cap of its own beyond the attribute limit. */
const maxVertexBuffersOf = (renderer: WebGPURenderer) => {
  const device = (renderer.backend as { device?: GPUDevice }).device;
  return device?.limits.maxVertexBuffers ?? Number.POSITIVE_INFINITY;
};

const createWebGpuSpikePresenter: CreateWebGpuSpikePresenter = async ({ canvas, forceWebGL }) => {
  let adapter: GPUAdapter | null = null;
  if (!forceWebGL) {
    const gpu = navigator.gpu;
    if (!gpu) {
      console.warn("[wg-0] navigator.gpu is unavailable; falling back to the WebGL2 renderer");
      return null;
    }
    try {
      adapter = await gpu.requestAdapter();
    } catch (error) {
      console.warn("[wg-0] requestAdapter failed; falling back to the WebGL2 renderer", error);
      return null;
    }
    if (adapter === null) {
      console.warn("[wg-0] no WebGPU adapter; falling back to the WebGL2 renderer");
      return null;
    }
  }

  const output = document.createElement("canvas");
  output.id = "webgpu-view";
  output.setAttribute("aria-hidden", "true");
  output.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
  (canvas.parentElement ?? document.body).appendChild(output);

  let renderer: WebGPURenderer;
  try {
    renderer = new WebGPURenderer({
      alpha: false,
      antialias: false,
      canvas: output,
      forceWebGL,
      trackTimestamp: !forceWebGL
    });
    await renderer.init();
  } catch (error) {
    console.warn("[wg-0] WebGPURenderer could not start; falling back to the WebGL2 renderer", error);
    output.remove();
    return null;
  }
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(CLEAR_COLOR, 1);
  renderer.setPixelRatio(1);
  renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false);

  releaseInterleavedAttributesWithBuffer(renderer);
  const packer = createVertexBufferPacker(maxVertexBuffersOf(renderer));
  const sunShadows = createSunShadowPass(renderer);
  let lastShadowStats = sunShadows.takeStats();
  const tracker = createPipelineTracker(renderer);
  const asyncCompiler = createAsyncPipelineCompiler(renderer, tracker.trackAsync);
  const presentedScenes = new Set<Scene>();
  const idlePrewarm = createIdlePipelinePrewarm({
    compiler: asyncCompiler,
    scenes: () => presentedScenes,
    skip: object => {
      const geometry = (object as { geometry?: BufferGeometry }).geometry;
      return geometry === undefined || packer.twinOf(geometry) !== null;
    }
  });
  const cpuTimes: number[] = [];
  const gpuTimes: number[] = [];
  let compileMs = 0;
  let prewarmRepresentatives = 0;
  let replaceMaterialsActive = true;
  let frameStartedAt = 0;
  let lastGpuMs = 0;
  let timestampPending = false;

  let post: TslPostChain | null = null;
  let postUniforms: Record<string, import("three").IUniform> | null = null;
  // FXAA on by default (DEV A/B opt-out `?wgAa=0`).
  let postSettings: TslPostSettings = { ambientOcclusion: "soft", antialias: !isPostAntialiasOptOut(), bloom: "on",
    exposure: true, exposureStrength: 1 };
  let eyeAdaptationWeight = 0;
  let lastCamera: Camera | null = null;
  let postBegun = false;
  const postDisabled = import.meta.env.DEV && typeof location !== "undefined"
    && new URLSearchParams(location.search).get("post") === "off";
  const devQuery = import.meta.env.DEV && typeof location !== "undefined"
    ? new URLSearchParams(location.search) : null;
  /** DEV A/B switches: `?asyncCompile=off` keeps draw-time compiles, `?idlePrewarm=off` the gate only. */
  const asyncCompileDisabled = devQuery?.get("asyncCompile") === "off";
  const idlePrewarmDisabled = asyncCompileDisabled || devQuery?.get("idlePrewarm") === "off";
  const refractionTarget = new RenderTarget(1, 1, {
    depthBuffer: false,
    format: RGBAFormat,
    generateMipmaps: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: HalfFloatType
  });
  refractionTarget.texture.name = "tsl:water-refraction";
  const waterInputs: WaterPassInputs = {
    refractionColor: uv => texture(refractionTarget.texture, uv).rgb
  };
  const materialPorting = createMaterialPorting({
    createStandIn,
    hasPostUniforms: () => postUniforms !== null,
    setPostUniforms: uniforms => { postUniforms = uniforms; },
    sunVisibility: () => sunVisibilityOf(sunShadows)(),
    waterInputs
  });
  const {
    copiedTextures, copyTextureOnce, materialTypes, overrideStandIns, portedMaterials, portedSync,
    replaceSceneMaterials, standInSources, standIns, textureCopies
  } = materialPorting;
  /** The chain starts once a ported source exposes the shared shading uniforms. */
  const ensurePost = () => {
    if (postDisabled) return null;
    if (post !== null || postUniforms === null) return post;
    post = createTslPostChain(renderer, postUniforms, postSettings);
    post.setEyeAdaptation(eyeAdaptationWeight);
    return post;
  };

  const scenePasses = createScenePasses({
    ensurePost,
    packer,
    refractionTarget,
    renderer,
    replaceSceneMaterials
  });
  /** C-3 prewarm also compiles scenes reached through the game's compile hook; keep those node-only. */
  const compileScene = renderer.compileAsync.bind(renderer);
  renderer.compileAsync = async (scene, camera, targetScene = null) => {
    replaceSceneMaterials(scene as Scene);
    return compileScene(scene, camera, targetScene);
  };

  /**
   * C-3: Three's per-draw hook draws an over-limit vertex layout through its packed twin for that one
   * draw, and gives an object drawn with a source material its node material. The per-render scene
   * traversal stays until `settle()`: stand-ins depend on the object they were made for
   * (`buildingSurface` textures), and draw-time substitution alone drew the owner town's roofs
   * untextured grey (C-3 capture), most likely through the building static batches.
   */
  const shaderRequests = createShaderRequests(renderer);

  const drawObject = createDrawObject({
    createStandIn,
    copyTextures: COPY_TEXTURES,
    instanceMatrixVariant: createInstanceMatrixVariants(),
    materials: materialPorting,
    packer,
    renderer,
    shaderRequests,
    sunShadows
  });
  renderer.setRenderObjectFunction(drawObject);

  const presenter: WebGpuSpikePresenter = {
    mode: forceWebGL ? "webgpu-gl" : "webgpu",
    beginFrame: () => {
      frameStartedAt = performance.now();
      lastShadowStats = sunShadows.takeStats();
      renderer.info.reset();
      const chain = ensurePost();
      postBegun = chain !== null;
      if (chain !== null) chain.beginScene();
      else {
        renderer.setRenderTarget(null);
        renderer.clear();
      }
    },
    clearSunShadow: sunShadows.clearTile,
    compile: async (scene: Scene, camera: Camera) => {
      replaceSceneMaterials(scene);
      const restore = packer.swapIn(scene);
      try { await renderer.compileAsync(scene, camera); }
      finally { restore(); }
      prewarmScenePrepasses(renderer, scene);
    },
    dispose: () => {
      const disposed = new Set<Material>(standIns.values());
      for (const material of standInSources.keys()) disposed.add(material);
      for (const material of disposed) material.dispose();
      for (const material of portedMaterials.values()) material?.dispose();
      portedMaterials.clear();
      portedSync.clear();
      for (const texture of copiedTextures) texture.dispose();
      copiedTextures.clear();
      textureCopies.clear();
      standIns.clear();
      overrideStandIns.clear();
      standInSources.clear();
      packer.dispose();
      idlePrewarm.dispose();
      asyncCompiler.dispose();
      sunShadows.dispose();
      setSunShadowUniforms(null);
      refractionTarget.dispose();
      post?.dispose();
      post = null;
      renderer.dispose();
      output.remove();
    },
    endFrame: () => {
      if (post !== null && lastCamera !== null) post.finish(lastCamera);
      const cpuMs = performance.now() - frameStartedAt;
      cpuTimes.push(cpuMs);
      tracker.recordFrame(cpuMs);
      asyncCompiler.endFrame();
      if (cpuTimes.length > MAX_FRAME_SAMPLES) cpuTimes.shift();
      const backend = (renderer as { backend?: { trackTimestamp?: boolean } }).backend;
      if (backend?.trackTimestamp !== true || timestampPending) return;
      timestampPending = true;
      void renderer.resolveTimestampsAsync("render").then(() => {
        const value = renderer.info.render.timestamp;
        if (!Number.isFinite(value)) return;
        lastGpuMs = value;
        gpuTimes.push(value);
        if (gpuTimes.length > MAX_FRAME_SAMPLES) gpuTimes.shift();
      }).catch(() => undefined).finally(() => { timestampPending = false; });
    },
    finishPrewarm: tracker.finishPrewarm,
    prepare: async (scenes, camera: Camera) => {
      const started = performance.now();
      scenePasses.setMainScene(scenes[0] ?? null);
      const unique = [...new Set(scenes)];
      for (const scene of unique) scenePasses.prepareScene(scene);
      const prewarm = await scenePasses.prewarmScenes(unique, camera);
      prewarmRepresentatives = prewarm.representatives;
      compileMs = performance.now() - started;
      return compileMs;
    },
    prewarmPresented: async (camera: Camera) => {
      const started = performance.now();
      const scenes = [...presentedScenes];
      for (const scene of scenes) replaceSceneMaterials(scene);
      const prewarm = await scenePasses.prewarmScenes(scenes, camera);
      const shadowCasters = await sunShadows.prewarm(scenes, packer.swapIn);
      prewarmRepresentatives = Math.max(prewarmRepresentatives, prewarm.representatives + shadowCasters);
      compileMs += performance.now() - started;
      // G-W5: objects created from now on compile between frames instead of on their first draw.
      if (!asyncCompileDisabled) asyncCompiler.enable();
      if (!idlePrewarmDisabled) idlePrewarm.start();
    },
    render: (scene: Scene, camera: Camera, renderTarget: RenderTarget | null = null) => {
      presentedScenes.add(scene);
      if (replaceMaterialsActive) replaceSceneMaterials(scene);
      for (const sync of portedSync) sync();
      for (const [standIn, source] of standInSources) syncStandInMaps(standIn, source, copyTextureOnce);
      syncSunShadowUniforms();
      lastCamera = camera;
      const chain = ensurePost();
      if (chain !== null && renderTarget === null && !postBegun) {
        chain.beginScene();
        postBegun = true;
      }
      if (scenePasses.isMainScene(scene) && renderTarget === null) scenePasses.renderRefraction(camera);
      renderer.setRenderTarget(renderTarget ?? chain?.scene.target ?? null);
      renderScenePrepasses(renderer, scene, camera);
      // The per-draw hook swaps in packed vertex layouts (`drawObject`).
      renderer.render(scene, camera);
    },
    renderSunShadow: sunShadows.render,
    resize: (width: number, height: number, pixelRatio: number) => {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      refractionTarget.setSize(Math.max(1, Math.floor(width * 0.5)),
        Math.max(1, Math.floor(height * 0.5)));
      post?.resize(width, height);
    },
    setEyeAdaptation: weight => {
      eyeAdaptationWeight = weight;
      post?.setEyeAdaptation(weight);
    },
    setPostQuality: settings => {
      postSettings = { ...postSettings, ...settings };
      post?.dispose();
      post = null;
    },
    setSunShadows: setup => {
      setSunShadowUniforms(setup.uniforms);
      sunShadows.setSetup(setup);
    },
    settle: () => { replaceMaterialsActive = false; },
    stats: (): WebGpuSpikeStats => ({
      adapter: createAdapterName(adapter),
      asyncCompile: asyncCompiler.stats(),
      calls: renderer.info.render.drawCalls,
      compileMs,
      gpuMs: lastGpuMs,
      memoryBytes: renderer.info.memory.total,
      mode: forceWebGL ? "webgpu-gl" : "webgpu",
      pipelines: tracker.stats(),
      prewarmRepresentatives,
      substitutions: Object.fromEntries(materialTypes),
      sunShadow: lastShadowStats,
      triangles: renderer.info.render.triangles
    }),
    frameTimings: () => ({ cpu: cpuTimes, gpu: gpuTimes }),
    shaderOf: shaderRequests.request
  };
  return presenter;
};

export const createWebGpuPresenter: CreateWebGpuSpikePresenter = createWebGpuSpikePresenter;
