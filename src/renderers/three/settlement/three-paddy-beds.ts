import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, type IUniform, Matrix4, MeshStandardMaterial,
  PlaneGeometry, ShaderMaterial
} from "three";

import { NEUTRAL_HIGHLIGHTS } from "../../../render-common/highlights";
import { createPaddyDikeData, PADDY_WATER_LEVEL, type PaddyNeighbours } from "../../../render-common/props/drink-crops/paddy-dikes";
import { excludeFromAmbientOcclusion } from "../ambient-occlusion-exclusion";
import { connectCustomAtmosphere } from "../atmosphere/custom-atmosphere";

const CAPACITY = 64;
/** The water sheet ends at the inner foot of the dikes. */
const WATER_SIZE = 0.86;

const WATER_VERTEX = `
varying vec3 vWorld;
varying vec2 vBed;
void main() {
  vBed = uv;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/**
 * Shallow paddy water: muddy brown-green where it is shallow at the dikes, sky-tinted and
 * reflective in the open, a sun glint; High adds two drifting ripple layers of the island's water
 * normal texture, Minimal keeps the clean tinted gradient.
 */
const WATER_FRAGMENT = `
uniform float uHighlight;
uniform float uTime;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientSky;
#ifdef PADDY_RIPPLES
uniform sampler2D uWaterNormals;
#endif
varying vec3 vWorld;
varying vec2 vBed;
void main() {
  vec3 normal = vec3(0.0, 1.0, 0.0);
#ifdef PADDY_RIPPLES
  vec2 a = texture2D(uWaterNormals, vWorld.xz * 0.9 + vec2(uTime * 0.012, uTime * 0.007)).xy * 2.0 - 1.0;
  vec2 b = texture2D(uWaterNormals, vWorld.xz * 1.7 - vec2(uTime * 0.009, uTime * 0.013)).xy * 2.0 - 1.0;
  normal = normalize(vec3((a.x + b.x) * 0.06, 1.0, (a.y + b.y) * 0.06));
#endif
  float shore = min(min(vBed.x, 1.0 - vBed.x), min(vBed.y, 1.0 - vBed.y));
  float open = smoothstep(0.0, 0.22, shore);
  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = 0.55 + 0.45 * pow(1.0 - max(dot(normal, view), 0.0), 3.0);
  vec3 mud = vec3(0.26, 0.24, 0.12);
  vec3 sky = uAmbientSky * 0.25 + vec3(0.46, 0.6, 0.64);
  vec3 color = mix(mud, sky, fresnel * mix(0.35, 0.85, open));
  float glint = pow(max(dot(reflect(-uSunDirection, normal), view), 0.0), 120.0);
  color += uSunColor * glint * 0.6 * uHighlight;
  gl_FragColor = vec4(color, mix(0.95, 0.82, open));
}`;

const createWaterMaterial = (uniforms: Record<string, IUniform>, detailed: boolean) => {
  const ripples = detailed && uniforms.uWaterNormals?.value;
  return connectCustomAtmosphere(new ShaderMaterial({
    defines: ripples ? { PADDY_RIPPLES: "" } : {}, depthWrite: false, fragmentShader: WATER_FRAGMENT, transparent: true,
    uniforms: {
      uAmbientSky: uniforms.uAmbientSky ?? { value: [0.6, 0.7, 0.8] },
      uHighlight: uniforms.uHighlight ?? { value: NEUTRAL_HIGHLIGHTS },
      uSunColor: uniforms.uSunColor ?? { value: [1, 1, 1] },
      uSunDirection: uniforms.uSunDirection ?? { value: [0.4, 0.8, 0.4] }, uTime: uniforms.uTime ?? { value: 0 },
      ...(ripples ? { uWaterNormals: uniforms.uWaterNormals! } : {})
    },
    vertexShader: WATER_VERTEX
  }), uniforms);
};

const createDikeGeometry = (neighbours: PaddyNeighbours, detailed: boolean) => {
  const data = createPaddyDikeData(neighbours, detailed);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(data.colors, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  return geometry;
};

const createLayer = (geometry: BufferGeometry, material: ShaderMaterial | MeshStandardMaterial, shadows: boolean) => {
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = shadows;
  return mesh;
};

/**
 * Flooded rice paddies: soft earthen dikes (mud on the slopes, grass on the crest, irregular height)
 * that neighbouring paddies share, a muddy floor and the shallow water sheet. The dike geometry is
 * cached per neighbour pattern (16 at most), each drawn instanced.
 */
export const createThreePaddyBeds = (uniforms: Record<string, IUniform>, detailed: boolean) => {
  const group = new Group(); group.name = "paddy_beds";
  const materials = {
    dike: new MeshStandardMaterial({ roughness: 1, side: DoubleSide, vertexColors: true }),
    mud: new MeshStandardMaterial({ color: 0x4e3f2a, roughness: 0.6 }),
    water: excludeFromAmbientOcclusion(createWaterMaterial(uniforms, detailed))
  };
  const geometries = {
    floor: new PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2).translate(0, 0.022, 0),
    water: new PlaneGeometry(WATER_SIZE, WATER_SIZE).rotateX(-Math.PI / 2).translate(0, PADDY_WATER_LEVEL, 0)
  };
  const floors = createLayer(geometries.floor, materials.mud, detailed);
  const water = createLayer(geometries.water, materials.water, false);
  water.renderOrder = 2;
  group.add(floors, water);
  const dikes = new Map<number, { count: number; mesh: InstancedMesh }>();
  const dikeLayer = (mask: number) => {
    const known = dikes.get(mask);
    if (known) return known;
    const neighbours = { east: Boolean(mask & 1), north: Boolean(mask & 2), south: Boolean(mask & 4),
      west: Boolean(mask & 8) };
    const layer = { count: 0, mesh: createLayer(createDikeGeometry(neighbours, detailed), materials.dike, detailed) };
    layer.mesh.castShadow = detailed;
    group.add(layer.mesh); dikes.set(mask, layer);
    return layer;
  };
  const matrix = new Matrix4();
  let beds = 0, flooded = 0;

  const begin = () => { beds = 0; flooded = 0; for (const layer of dikes.values()) layer.count = 0; };
  /** A paddy at x, y, z; `neighbours` tells which sides join another paddy (shared dike there). */
  const push = (x: number, y: number, z: number, wet: boolean, neighbours: PaddyNeighbours) => {
    if (beds >= CAPACITY) return;
    matrix.makeTranslation(x, y, z);
    const mask = Number(neighbours.east) | Number(neighbours.north) << 1 | Number(neighbours.south) << 2 |
      Number(neighbours.west) << 3;
    const layer = dikeLayer(mask);
    if (layer.count < CAPACITY) layer.mesh.setMatrixAt(layer.count++, matrix);
    floors.setMatrixAt(beds++, matrix);
    if (wet) water.setMatrixAt(flooded++, matrix);
  };
  const commit = () => {
    const layers = [...[...dikes.values()].map(layer => [layer.mesh, layer.count] as const), [floors, beds] as const,
      [water, flooded] as const];
    for (const [mesh, count] of layers) {
      mesh.count = count; mesh.visible = count > 0; mesh.instanceMatrix.needsUpdate = true;
    }
  };
  const dispose = () => {
    Object.values(geometries).forEach(geometry => geometry.dispose());
    for (const layer of dikes.values()) layer.mesh.geometry.dispose();
    Object.values(materials).forEach(material => material.dispose());
  };
  return { begin, commit, dispose, group, push };
};
