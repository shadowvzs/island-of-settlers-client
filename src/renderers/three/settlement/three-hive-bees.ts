import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, type IUniform,
  Matrix4, ShaderMaterial
} from "three";

import { connectCustomAtmosphere } from "../atmosphere/custom-atmosphere";

/** Bee budget per hive on High (Minimal draws no bees). */
const MAX_BEES = 40;

/**
 * One bee: a striped body (two diamonds) and two wings; `beePart` 1 marks wing tips that flap.
 * Sized for readability at the RTS camera, not botanically (a real bee would be sub-pixel).
 */
const createBeeGeometry = () => {
  const positions: number[] = [], colors: number[] = [], parts: number[] = [];
  const vertex = (x: number, y: number, z: number, color: number[], part = 0) => {
    positions.push(x, y, z); colors.push(...color); parts.push(part);
  };
  const yellow = [1, 0.74, 0.1], black = [0.1, 0.07, 0.04], wing = [0.62, 0.66, 0.7];
  const body: Array<[number, number[]]> = [[-0.016, black], [-0.006, yellow], [0.004, black], [0.012, yellow]];
  for (let segment = 0; segment < body.length - 1; segment += 1) {
    const [x0, c0] = body[segment]!, [x1] = body[segment + 1]!;
    for (const [y, z] of [[0.005, 0], [0, 0.005], [-0.005, 0], [0, -0.005]] as const) {
      vertex(x0, 0, 0, c0);
      vertex(x1, y, z, c0);
      vertex(x1, z, -y, c0);
    }
  }
  for (const side of [-1, 1]) {
    vertex(-0.002, 0.004, 0, wing); vertex(0.006, 0.005, side * 0.016, wing, 1);
    vertex(-0.008, 0.005, side * 0.014, wing, 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("beePart", new Float32BufferAttribute(parts, 1));
  return geometry;
};

const VERTEX = `
const float BEE_SIZE = 1.9;
attribute vec3 color;
attribute float beePart;
attribute vec4 beeHive;
uniform float uTime;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  float phase = beeHive.w;
  float speed = 0.9 + fract(phase * 3.1) * 0.7;
  float angle = uTime * speed + phase * 6.2832;
  float reach = 0.1 + fract(phase * 7.13) * 0.28;
  vec3 centre = beeHive.xyz + vec3(cos(angle) * reach,
    0.05 * sin(angle * 2.3 + phase * 5.0) + fract(phase * 4.7) * 0.22,
    sin(angle * 1.3) * reach * 0.8);
  vec3 heading = normalize(vec3(-sin(angle), 0.0, 1.3 * cos(angle * 1.3) * 0.8) + vec3(1e-4));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), heading));
  vec3 local = position * BEE_SIZE;
  local.y += beePart * sin(uTime * 70.0 + phase * 40.0) * 0.012;
  vec3 world = centre + heading * local.x + vec3(0.0, local.y, 0.0) + side * local.z;
  vColor = color;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FRAGMENT = `
varying vec3 vColor;
varying vec3 vWorld;
void main() { gl_FragColor = vec4(vColor, 1.0); }`;

/** Bees circling the Viking hives; their flight is computed on the GPU from the shared clock. */
export const createThreeHiveBees = (uniforms: Record<string, IUniform>, capacity = 24 * MAX_BEES) => {
  const geometry = createBeeGeometry();
  const hives = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  geometry.setAttribute("beeHive", hives);
  const material = connectCustomAtmosphere(new ShaderMaterial({ fragmentShader: FRAGMENT, side: DoubleSide,
    uniforms: { uTime: uniforms.uTime ?? { value: 0 } }, vertexShader: VERTEX }), uniforms);
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = "hive_bees"; mesh.frustumCulled = false; mesh.count = 0;
  const identity = new Matrix4();
  for (let index = 0; index < capacity; index += 1) mesh.setMatrixAt(index, identity);
  let count = 0;
  const begin = () => { count = 0; };
  /** `bees` bees around a hive entrance at x, y, z (world). */
  const push = (x: number, y: number, z: number, bees: number, seed: number) => {
    for (let bee = 0; bee < Math.min(bees, MAX_BEES) && count < capacity; bee += 1, count += 1)
      hives.array.set([x, y, z, (seed * 0.618 + bee * 0.137) % 1], count * 4);
  };
  const commit = () => { mesh.count = count; mesh.visible = count > 0; hives.needsUpdate = true; };
  const dispose = () => { geometry.dispose(); material.dispose(); };
  return { begin, commit, dispose, mesh, push };
};
