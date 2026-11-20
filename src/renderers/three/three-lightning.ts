import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3
} from "three";

import { CLOUD_HEIGHT } from "../../render-common/shaders/cloud-glsl";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { airBoltPaths, type BoltPoint, groundBoltPaths } from "./lightning-paths";

/** The bolt flickers this long (seconds); a ground strike's impact glow lasts a little longer. */
const BOLT_SECONDS = .42;
const IMPACT_SECONDS = .62;
/** A cinematic ground strike stays drawn this long (seconds), also in a dry sky (the renderer's forced window). */
export const GROUND_STRIKE_SECONDS = IMPACT_SECONDS;
/** Ribbon half widths: weather bolt core/glow, ground strike core/glow (a longer, closer channel). */
const AIR_WIDTHS = [.055, .25] as const;
const GROUND_WIDTHS = [.085, .34] as const;
/** Impact glow: radius, inner ring radius and its brightness, ring segments, lift above the surface. */
const IMPACT_RADIUS = 3.2;
const IMPACT_INNER_RADIUS = .9;
const IMPACT_INNER_LIGHT = .5;
const IMPACT_SEGMENTS = 14;
const IMPACT_LIFT = .08;

type Surface = (x: number, z: number) => number;

/**
 * A ground-hugging radial glow (centre bright, rim dark: additive vertex colours) whose vertices follow the
 * surface, so it lights a slope or the water around the struck point without a decal pass or a light.
 */
const impactGeometry = (point: BoltPoint, surface: Surface) => {
  const positions: number[] = [point.x, surface(point.x, point.z) + IMPACT_LIFT, point.z];
  const colors: number[] = [1, 1, 1];
  const indices: number[] = [];
  for (const [radius, light] of [[IMPACT_INNER_RADIUS, IMPACT_INNER_LIGHT], [IMPACT_RADIUS, 0]] as const) {
    for (let segment = 0; segment < IMPACT_SEGMENTS; segment++) {
      const angle = (segment / IMPACT_SEGMENTS) * Math.PI * 2;
      const x = point.x + Math.cos(angle) * radius, z = point.z + Math.sin(angle) * radius;
      positions.push(x, surface(x, z) + IMPACT_LIFT, z);
      colors.push(light, light, light);
    }
  }
  for (let segment = 0; segment < IMPACT_SEGMENTS; segment++) {
    const next = (segment + 1) % IMPACT_SEGMENTS;
    const inner = 1 + segment, innerNext = 1 + next;
    const outer = 1 + IMPACT_SEGMENTS + segment, outerNext = 1 + IMPACT_SEGMENTS + next;
    indices.push(0, innerNext, inner, inner, innerNext, outerNext, inner, outerNext, outer);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  return geometry;
};

/** The bolt's flicker at `age` seconds: a bright first hit, then a fast shimmer. */
const flickerAt = (age: number) => .55 + Math.sin(age * 95) * .25 + (age < .08 ? .3 : 0);

/** The ground flash: full at the hit, then a quick fall-off, shimmering with the bolt while it lasts. */
const impactLightAt = (age: number) => {
  const fade = (1 - age / IMPACT_SECONDS) ** 2;
  if (age > BOLT_SECONDS) return fade;
  return fade * (.7 + flickerAt(age) * .3);
};

/**
 * World-space lightning. A weather strike is a jagged, branching arc that ends in the air (its original look);
 * a cinematic ground strike (CIN6, owner 2026-11-11) runs from the cloud base down to its point with a brief
 * impact glow on the ground or water, so low shots and Minimal frame it. Three additive draws at most, no pass.
 */
export const createThreeLightning = (world: WorldData) => {
  const root = new Group();
  root.name = "lightning";
  root.visible = false;
  const material = new MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const glowMaterial = material.clone();
  glowMaterial.color.setHex(0x6ea9ff);
  const impactMaterial = new MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    polygonOffsetUnits: -2, vertexColors: true });
  const core = new Mesh(new BufferGeometry(), material);
  const glow = new Mesh(new BufferGeometry(), glowMaterial);
  const impact = new Mesh(new BufferGeometry(), impactMaterial);
  core.frustumCulled = glow.frustumCulled = impact.frustumCulled = false;
  core.renderOrder = glow.renderOrder = 8;
  impact.renderOrder = 7;
  root.add(impact, glow, core);
  let startedAt: number | undefined;
  let grounded = false;
  const next = new Vector3(), side = new Vector3(), view = new Vector3();
  const surface: Surface = (x, z) => Math.max(world.seaLevel, sampleSmooth(world, world.heights, x, z));

  /** Several root-like paths share one ribbon geometry (one draw for core, one for glow). */
  const ribbon = (paths: readonly (readonly Vector3[])[], camera: Camera, width: number) => {
    const positions: number[] = [], indices: number[] = [];
    for (const points of paths) {
      const offset = positions.length / 3;
      for (let index = 0; index < points.length; index++) {
        const current = points[index]!;
        const neighbour = points[Math.min(points.length - 1, index + 1)]!;
        next.subVectors(neighbour, current).normalize();
        view.subVectors(camera.position, current).normalize();
        side.crossVectors(next, view).normalize().multiplyScalar(width * (1 - index / points.length * .6));
        positions.push(current.x - side.x, current.y - side.y, current.z - side.z,
          current.x + side.x, current.y + side.y, current.z + side.z);
        if (index > 0) {
          const base = offset + index * 2;
          indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  const show = (paths: Vector3[][], camera: Camera, time: number, [coreWidth, glowWidth]: readonly number[]) => {
    core.geometry.dispose(); glow.geometry.dispose();
    core.geometry = ribbon(paths, camera, coreWidth!);
    glow.geometry = ribbon(paths, camera, glowWidth!);
    root.visible = core.visible = glow.visible = true;
    impact.visible = grounded;
    material.opacity = 1;
    glowMaterial.opacity = .22;
    impactMaterial.opacity = grounded ? 1 : 0;
    startedAt = time;
  };

  /** Weather bolt; `spread`: random offset around `centre` (world units), 0 strikes exactly there. */
  const strike = (camera: Camera, centre: BoltPoint, time: number, spread = 18) => {
    const x = Math.max(0, Math.min(world.cellsX - 1, centre.x + (Math.random() - .5) * spread));
    const z = Math.max(0, Math.min(world.cellsZ - 1, centre.z + (Math.random() - .5) * spread));
    grounded = false;
    show(airBoltPaths({ x, z }, sampleSmooth(world, world.heights, x, z), Math.random), camera, time, AIR_WIDTHS);
  };

  /** Cinematic strike that reaches the ground (or the water surface) exactly at `point`, with its impact glow. */
  const strikeGround = (camera: Camera, point: BoltPoint, time: number) => {
    const x = Math.max(0, Math.min(world.cellsX - 1, point.x));
    const z = Math.max(0, Math.min(world.cellsZ - 1, point.z));
    impact.geometry.dispose();
    impact.geometry = impactGeometry({ x, z }, surface);
    grounded = true;
    show(groundBoltPaths({ x, z }, surface(x, z), CLOUD_HEIGHT, Math.random), camera, time, GROUND_WIDTHS);
  };

  const clear = () => {
    startedAt = undefined;
    grounded = false;
    root.visible = false;
    material.opacity = glowMaterial.opacity = impactMaterial.opacity = 0;
  };

  const update = (time: number) => {
    if (startedAt === undefined) {
      root.visible = false;
      return;
    }
    const age = time - startedAt;
    if (age > (grounded ? IMPACT_SECONDS : BOLT_SECONDS)) {
      clear();
      return;
    }
    const bolt = age <= BOLT_SECONDS;
    const flicker = bolt ? Math.max(0, flickerAt(age)) : 0;
    core.visible = glow.visible = bolt;
    material.opacity = flicker;
    glowMaterial.opacity = flicker * .22;
    impactMaterial.opacity = grounded ? impactLightAt(age) : 0;
  };

  /**
   * Shader prewarm (CIN6): a loading frame draws the idle layer with every material at zero opacity (empty or
   * transparent geometry, no visible pixel), so the first strike compiles nothing. The next update hides it.
   */
  const warm = () => {
    if (startedAt !== undefined) return;
    root.visible = core.visible = glow.visible = impact.visible = true;
  };

  return {
    clear,
    dispose: () => {
      core.geometry.dispose(); glow.geometry.dispose(); impact.geometry.dispose();
      material.dispose(); glowMaterial.dispose(); impactMaterial.dispose();
      root.removeFromParent();
    },
    root,
    strike,
    strikeGround,
    update,
    warm
  };
};
