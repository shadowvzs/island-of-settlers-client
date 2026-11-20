import {
  BufferGeometry, CanvasTexture, DataTexture, DoubleSide, Float32BufferAttribute,
  Group, type IUniform, LOD, Mesh, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking,
  RGBAFormat, SRGBColorSpace, Vector2
} from "three";

import { NOISE_GLSL } from "../../../render-common/shaders/common-glsl";
import { WIND_GLSL } from "../../../render-common/shaders/prop-glsl";
import {
  createFlaxDryingData, createFlaxStubbleData, createGrainStubbleData, createWheatMeshData, type FieldCrop,
  wheatRandom
} from "../../../render-common/wheat-field";
import {
  createWheatSoilData, FIELD_ROW_SPACING, fieldRowOffset, wheatSoilPixel, wheatSoilRelief
} from "../../../render-common/wheat-soil";
import type { FieldState, SettlementFieldFrame } from "../../../shared/settlement/settlement-field-cycles";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import type { WorldData } from "../../../shared/world/world-data";

/** Wheat uses a fraction of tree sway: stalks should lean, not thrash. */
/** Which flax presentation a field state uses: standing crop, drying stooks or cut stubble. */
export const flaxFieldVisibility = (state: FieldState) => ({
  drying: state === "drying",
  plants: state !== "stubble" && state !== "drying",
  stubble: state === "stubble"
});

export const WHEAT_WIND_SCALE = 0.5;
/** Extra local bounds for the shared gust so storm sway is not culled. */
export const WHEAT_WIND_MARGIN = 0.34;

export const WHEAT_WIND_SAMPLE_GLSL = `
vec2 wheatWorldXZ = modelMatrix[3].xz + position.xz;
vec2 wheatWind = windDisplacement(wheatWorldXZ, wheatPhase, wheatTime);
`;

export const WHEAT_WIND_DISPLACEMENT_GLSL = `
float wheatBend = wheatFlex * wheatGrowth;
transformed.xz += wheatWind * wheatBend * wheatBend * ${WHEAT_WIND_SCALE.toFixed(2)};
`;

export const WHEAT_NORMAL_GLSL = `
float wheatSlope = 2.0 * wheatGrowth * wheatGrowth * wheatFlex * ${WHEAT_WIND_SCALE.toFixed(2)};
objectNormal = normalize(vec3(
  objectNormal.x,
  objectNormal.y - dot(wheatWind * wheatSlope, objectNormal.xz),
  objectNormal.z
));
`;

const WHEAT_WIND_HEADER = `
uniform vec2 uWind;
${NOISE_GLSL}
${WIND_GLSL}
`;

const createWheatTexture = (card: boolean) => {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  if (!card) {
    ctx.fillStyle = "#e8ead4"; ctx.fillRect(0, 0, 128, 256);
    for (let x = 0; x < 128; x++) {
      ctx.strokeStyle = x % 9 ? "rgba(87,96,54,.05)" : "rgba(87,96,54,.22)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 4, 256); ctx.stroke();
    }
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = `rgba(110,116,72,${wheatRandom(i) * .12})`;
      ctx.fillRect(wheatRandom(i + 5) * 128, wheatRandom(i + 55) * 256, 1, 2);
    }
  } else {
    ctx.strokeStyle = "#d2ce8b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(64, 255); ctx.lineTo(64, 52); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const y = 218 - i * 25, side = i % 2 ? 1 : -1;
      ctx.fillStyle = i % 2 ? "#a7b752" : "#bcc86e";
      ctx.beginPath(); ctx.moveTo(64, y); ctx.quadraticCurveTo(64 + side * 35, y - 55, 64 + side * 53, y - 10);
      ctx.quadraticCurveTo(64 + side * 26, y - 21, 64, y - 4); ctx.fill();
    }
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1, y = 54 - i * 3.4;
      ctx.fillStyle = i % 2 ? "#e4d78b" : "#c3b05b";
      ctx.beginPath(); ctx.ellipse(64 + side * 5, y, 4.2, 7, side * .45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#d3c477"; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(64 + side * 7, y - 5); ctx.lineTo(64 + side * 17, y - 23); ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
};

/** Minimal flax cards: thin blue-green stems, narrow leaves and blue five-petal flowers. */
const createFlaxCardTexture = () => {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 128, 256);
  for (const [x, lean, height] of [[42, -9, 206], [64, 0, 232], [87, 8, 212]] as const) {
    context.strokeStyle = "#73824a"; context.lineWidth = 2.4;
    context.beginPath(); context.moveTo(x, 255); context.quadraticCurveTo(x + lean * .3, 128, x + lean, 255 - height);
    context.stroke();
    for (let leaf = 0; leaf < 3; leaf++) {
      const y = 214 - leaf * 34, side = leaf % 2 ? 1 : -1;
      context.fillStyle = leaf % 2 ? "#607c47" : "#728a50";
      context.beginPath(); context.moveTo(x, y);
      context.quadraticCurveTo(x + side * 20, y - 24, x + side * 28, y - 4);
      context.quadraticCurveTo(x + side * 14, y - 10, x, y - 2); context.fill();
    }
    for (let flower = 0; flower < 2; flower++) {
      const flowerY = 255 - height + 3 + flower * 12, flowerX = x + lean + (flower ? 6 : -4);
      for (let petal = 0; petal < 5; petal++) {
        const angle = petal / 5 * Math.PI * 2;
        context.fillStyle = petal % 2 ? "#5d78c8" : "#7189d6";
        context.beginPath();
        context.ellipse(flowerX + Math.cos(angle) * 5, flowerY + Math.sin(angle) * 5, 4.2, 2.6,
          angle, 0, Math.PI * 2); context.fill();
      }
      context.fillStyle = "#d7d08a";
      context.beginPath(); context.arc(flowerX, flowerY, 1.8, 0, Math.PI * 2); context.fill();
    }
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
};

/**
 * Tidy field rows on the plot soil (ground-palette-4: the plain round soil read as a dirt stain): lit ridges and
 * shaded furrows along world z at the ground's furrow spacing, fading out where a furrow is smaller than a pixel.
 */
const FIELD_SOIL_ROWS_GLSL = `
  diffuseColor.a *= smoothstep(0.0, 0.8, soilOpacity);
  float rowFade = 1.0 - smoothstep(0.06, 0.16, fwidth(soilRowX));
  float rowProfile = smoothstep(-0.7, 0.85, sin(soilRowX * ${(Math.PI * 2 / FIELD_ROW_SPACING).toFixed(4)}));
  diffuseColor.rgb *= mix(0.95, mix(0.5, 1.5, rowProfile), rowFade);`;

const createSoilTexture = () => {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const index = (y * 512 + x) * 4, color = wheatSoilPixel(x, y);
    pixels.data.set([...color, 255], index);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
};

export const createThreeWheatFields = (
  world: WorldData,
  detailed: boolean,
  uniforms?: Record<string, IUniform>,
  crop: FieldCrop = "wheat"
) => {
  const flax = crop === "flax";
  const leafTexture = createWheatTexture(false), cardTexture = createWheatTexture(true);
  const flaxCardTexture = flax ? createFlaxCardTexture() : undefined;
  const soilTexture = createSoilTexture();
  const soilMaterial = new MeshStandardMaterial({ map: soilTexture, color: 0xd9cbb0,
    bumpMap: detailed ? soilTexture : undefined, bumpScale: .018, roughness: 1,
    transparent: true, depthWrite: false });
  soilMaterial.onBeforeCompile = shader => {
    shader.vertexShader = "attribute float soilEdge; varying float soilOpacity; varying float soilRowX;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\n soilOpacity = soilEdge;\n soilRowX = (modelMatrix * vec4(transformed, 1.0)).x;");
    shader.fragmentShader = "varying float soilOpacity; varying float soilRowX;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      `#include <color_fragment>\n${FIELD_SOIL_ROWS_GLSL}`);
  };
  soilMaterial.customProgramCacheKey = () => "wheat-furrow-soil-rows";
  const fallbackNoise = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat);
  fallbackNoise.needsUpdate = true;
  const fallbackWind: IUniform = { value: new Vector2(0, 0) };
  const fallbackPhase: IUniform = { value: new Vector2(0, 0) };
  const fallbackNoiseUniform: IUniform = { value: fallbackNoise };
  const windUniform = uniforms?.uWind ?? fallbackWind;
  const windPhaseUniform = uniforms?.uWindPhase ?? fallbackPhase;
  const noiseUniform = uniforms?.uNoiseTexture ?? fallbackNoiseUniform;
  const sites = new Map<number, { root: Group; growth: { value: number }; maturity: { value: number };
    owned: Array<{ dispose(): void }>; plants: LOD; stubble?: Mesh; drying?: Mesh }>();
  const time = { value: 0 };
  const owned: Array<{ dispose(): void }> = [
    leafTexture, cardTexture, fallbackNoise, soilMaterial, soilTexture,
    ...(flaxCardTexture ? [flaxCardTexture] : [])
  ];
  const create = (frame: SettlementFieldFrame) => {
    const localOwned: Array<{ dispose(): void }> = [];
    const root = new Group(); root.name = "leafy_wheat_patch";
    const ground = sampleSmooth(world, world.heights, frame.x, frame.z);
    root.position.set(frame.x, ground + .009, frame.z);
    const soilData = createWheatSoilData(frame.id, detailed, (x, z) =>
      sampleSmooth(world, world.heights, frame.x + x, frame.z + z) - ground, frame.x);
    const soilGeometry = new BufferGeometry();
    soilGeometry.setAttribute("position", new Float32BufferAttribute(soilData.positions, 3));
    soilGeometry.setAttribute("uv", new Float32BufferAttribute(soilData.uvs, 2));
    soilGeometry.setAttribute("soilEdge", new Float32BufferAttribute(soilData.edges, 1));
    soilGeometry.setIndex(soilData.indices); soilGeometry.computeVertexNormals();
    const soil = new Mesh(soilGeometry, soilMaterial); soil.receiveShadow = detailed; root.add(soil);
    localOwned.push(soilGeometry);
    const growth = { value: .08 }, maturity = { value: 0 }, phase = { value: frame.id % 19 };
    const lod = new LOD(); root.add(lod);
    const createPlants = (full: boolean) => {
      const data = createWheatMeshData(frame.id, full, crop);
      for (let i = 0; i < data.positions.length; i += 3)
        data.positions[i + 1]! += sampleSmooth(world, world.heights,
          frame.x + data.positions[i]!, frame.z + data.positions[i + 2]!) - ground +
          wheatSoilRelief(frame.id, data.positions[i]!, data.positions[i + 2]!, frame.x);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute("color", new Float32BufferAttribute(data.colors, 3));
      geometry.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
      geometry.setAttribute("wheatFlex", new Float32BufferAttribute(data.flex, 1));
      if (!full) geometry.computeVertexNormals();
      else geometry.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
      geometry.computeBoundingSphere();
      geometry.boundingSphere!.radius += WHEAT_WIND_MARGIN;
      const leafAlpha = full ? 0 : .45;
      const cardMap = flax ? flaxCardTexture : cardTexture;
      const fullMap = flax ? undefined : leafTexture;
      const materialMap = full ? fullMap : cardMap;
      const materialAlpha = leafAlpha;
      const material = new MeshStandardMaterial({ map: materialMap,
        vertexColors: true, side: DoubleSide, roughness: .91,
        bumpMap: !flax && full ? leafTexture : undefined, bumpScale: !flax && full ? .003 : 0,
        alphaTest: materialAlpha });
      const createShaderHook = (withNormals: boolean): typeof material.onBeforeCompile => shader => {
        shader.uniforms.wheatTime = time;
        shader.uniforms.wheatGrowth = growth;
        shader.uniforms.wheatMaturity = maturity;
        shader.uniforms.wheatPhase = phase;
        shader.uniforms.uWind = windUniform;
        shader.uniforms.uWindPhase = windPhaseUniform;
        shader.uniforms.uNoiseTexture = noiseUniform;
        let vertexShader =
          `attribute float wheatFlex; uniform float wheatTime; uniform float wheatGrowth; uniform float wheatPhase;
${WHEAT_WIND_HEADER}\n` + shader.vertexShader;
        if (withNormals) {
          vertexShader = vertexShader.replace("#include <beginnormal_vertex>",
            `${WHEAT_WIND_SAMPLE_GLSL}
#include <beginnormal_vertex>
${WHEAT_NORMAL_GLSL}`);
        }
        vertexShader = vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
          transformed.y -= wheatFlex * (1.0 - wheatGrowth);
${withNormals ? "" : WHEAT_WIND_SAMPLE_GLSL}
${WHEAT_WIND_DISPLACEMENT_GLSL}`);
        shader.vertexShader = vertexShader;
        if (shader.fragmentShader.includes("#include <color_fragment>")) {
          shader.fragmentShader = "uniform float wheatMaturity;\n" + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
            float brightness = dot(diffuseColor.rgb, vec3(.25, .6, .15));
            diffuseColor.rgb = mix(diffuseColor.rgb,
              vec3(.82, .58, .16) * (brightness * .65 + .65), ${flax ? "0.0" : "wheatMaturity"});`);
        }
      };
      material.onBeforeCompile = createShaderHook(full);
      material.customProgramCacheKey = () => `wheat-wind-v2-${full}-${crop}`;
      const mesh = new Mesh(geometry, material); mesh.castShadow = detailed; mesh.receiveShadow = detailed;
      const depthMap = full ? undefined : cardMap;
      const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide,
        map: depthMap, alphaTest: leafAlpha });
      depth.onBeforeCompile = createShaderHook(false);
      depth.customProgramCacheKey = () => `wheat-depth-wind-v2-${full}-${crop}`;
      mesh.customDepthMaterial = depth;
      localOwned.push(geometry, material, depth); return mesh;
    };
    if (detailed) lod.addLevel(createPlants(true), 0);
    lod.addLevel(createPlants(false), detailed ? 18 : 0);
    const detailMesh = (data: ReturnType<typeof createFlaxStubbleData>, name: string) => {
      for (let i = 0; i < data.positions.length; i += 3)
        data.positions[i + 1]! += sampleSmooth(world, world.heights,
          frame.x + data.positions[i]!, frame.z + data.positions[i + 2]!) - ground +
          wheatSoilRelief(frame.id, data.positions[i]!, data.positions[i + 2]!, frame.x);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
      geometry.setAttribute("color", new Float32BufferAttribute(data.colors, 3));
      geometry.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
      geometry.computeBoundingSphere();
      const material = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: .94 });
      const mesh = new Mesh(geometry, material); mesh.name = name;
      mesh.castShadow = detailed; mesh.receiveShadow = detailed; root.add(mesh);
      localOwned.push(geometry, material); return mesh;
    };
    const stubbleData = flax ? createFlaxStubbleData(frame.id, detailed)
      : createGrainStubbleData(frame.id, detailed, fieldRowOffset(frame.x), FIELD_ROW_SPACING);
    const stubble = detailMesh(stubbleData, flax ? "flax_stubble" : "grain_stubble");
    const drying = flax ? detailMesh(createFlaxDryingData(frame.id, detailed), "flax_drying") : undefined;
    stubble.visible = false;
    if (drying) drying.visible = false;
    const site = { root, growth, maturity, owned: localOwned, plants: lod, stubble, drying };
    sites.set(frame.id, site); return site;
  };
  const update = (frame: SettlementFieldFrame, clock: number) => {
    time.value = clock;
    const site = sites.get(frame.id) ?? create(frame);
    const visibility = flax ? flaxFieldVisibility(frame.state)
      : { drying: false, plants: frame.state !== "stubble", stubble: frame.state === "stubble" };
    site.plants.visible = visibility.plants;
    if (site.stubble) site.stubble.visible = visibility.stubble;
    if (site.drying) site.drying.visible = visibility.drying;
    site.growth.value = Math.max(.08, Math.min(1, frame.progress * 1.6));
    site.maturity.value = Math.max(0, Math.min(1, (frame.progress - .55) / .45));
    return site.root;
  };
  const remove = (id: number) => {
    const site = sites.get(id);
    if (!site) return;
    site.root.removeFromParent();
    for (const item of site.owned) item.dispose();
    sites.delete(id);
  };
  return { update, remove, dispose: () => {
    for (const id of sites.keys()) remove(id);
    for (const item of owned) item.dispose();
  } };
};
