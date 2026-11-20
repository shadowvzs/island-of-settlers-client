import {
  CanvasTexture,
  DataTexture,
  Group,
  type Object3D,
  Sprite,
  SpriteMaterial,
  Texture
} from "three";

import type { ExplorationSmokeAdapter } from "../../../app/exploration/contracts";
import type { ExplorationSmokeFrame } from "../../../render-common/exploration/exploration-frame";

/** Pale blue-white wisps; deliberately not the faction-coloured military death smoke. */
export const EXPLORATION_SMOKE_COLORS = {
  arrival: 0xd9f1ff,
  departure: 0xc9e6ff
} as const;

export const EXPLORATION_SMOKE_DURATION_MS = 1_100;
export const EXPLORATION_SMOKE_MAX_PARTICLES = 40;
export const PRESENTATION_SMOKE_SEED = 0x5eed1c3;

export interface ExplorationSmokeParticle {
  opacity: number;
  rotation: number;
  scale: number;
  x: number;
  y: number;
  z: number;
}

export interface ExplorationSmokeSample {
  active: boolean;
  count: number;
  kind: ExplorationSmokeFrame["kind"];
  particles: readonly ExplorationSmokeParticle[];
  progress: number;
  origin: { x: number; y: number; z: number };
}

export interface ExplorationSmokeModelOptions {
  durationMs?: number;
  maxParticles?: number;
  maxRadius?: number;
  maxRise?: number;
  now?: () => number;
  seed?: number;
}

interface SmokeParameters {
  angle: number;
  lift: number;
  phase: number;
  radius: number;
  size: number;
  spin: number;
  wobble: number;
}

export interface ExplorationSmokeModel {
  burst: (kind: ExplorationSmokeFrame["kind"], point: { x: number; y: number; z: number }) => ExplorationSmokeSample;
  clear: () => void;
  dispose: () => void;
  /** Advances a burst-only effect on the injected presentation clock. */
  tick: () => ExplorationSmokeSample;
  update: (frame: Readonly<ExplorationSmokeFrame> | null) => ExplorationSmokeSample;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const TAU = Math.PI * 2;

const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Own presentation PRNG. It never reads the settlement/world RNG or advances a simulation timer. */
const createPresentationRandom = (seed: number) => {
  let state = (seed >>> 0) || PRESENTATION_SMOKE_SEED;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
};

const particleCount = (kind: ExplorationSmokeFrame["kind"], maximum: number) =>
  Math.min(maximum, kind === "departure" ? 34 : 26);

/**
 * Bounded, deterministic smoke used for the arrival and departure acknowledgement. It owns no
 * simulation state, death counter, corpse, drop or gameplay RNG. The caller (or an injected
 * presentation clock) supplies progress; no render loop or timer is started here.
 */
export const createExplorationSmokeModel = (
  options: ExplorationSmokeModelOptions = {}
): ExplorationSmokeModel => {
  const maxParticles = Math.max(1, Math.floor(options.maxParticles ?? EXPLORATION_SMOKE_MAX_PARTICLES));
  const maxRadius = Math.max(0.1, options.maxRadius ?? 0.55);
  const maxRise = Math.max(0.2, options.maxRise ?? 1.8);
  const durationMs = Math.max(1, options.durationMs ?? EXPLORATION_SMOKE_DURATION_MS);
  const now = options.now ?? (() => (typeof performance === "undefined" ? Date.now() : performance.now()));
  const random = createPresentationRandom(options.seed ?? PRESENTATION_SMOKE_SEED);
  const params: SmokeParameters[] = Array.from({ length: maxParticles }, () => ({
    angle: 0, lift: 0, phase: 0, radius: 0, size: 0, spin: 0, wobble: 0
  }));
  const particles: ExplorationSmokeParticle[] = Array.from({ length: maxParticles }, () => ({
    opacity: 0, rotation: 0, scale: 0, x: 0, y: 0, z: 0
  }));
  const origin = { x: 0, y: 0, z: 0 };
  const sample: ExplorationSmokeSample = {
    active: false,
    count: 0,
    kind: "arrival",
    origin,
    particles,
    progress: 0
  };
  let active = false;
  let count = 0;
  let kind: ExplorationSmokeFrame["kind"] = "arrival";
  let progress = 0;
  let sourceKey = "";
  let lastProgress = -1;
  let startedAt = 0;
  let disposed = false;

  const generate = () => {
    count = particleCount(kind, maxParticles);
    for (let index = 0; index < count; index++) {
      const parameter = params[index]!;
      const direction = random() < 0.5 ? -1 : 1;
      parameter.angle = random() * TAU;
      parameter.lift = 0.45 + random() * 0.85;
      parameter.phase = random() * TAU;
      parameter.radius = 0.12 + random() * 0.32;
      parameter.size = 0.16 + random() * 0.22;
      parameter.spin = direction * (0.6 + random() * 0.8);
      parameter.wobble = 0.02 + random() * 0.04;
    }
  };

  const measure = () => {
    const visible = !disposed && active && progress < 1;
    sample.active = visible;
    sample.count = visible ? count : 0;
    sample.kind = kind;
    sample.origin = origin;
    sample.progress = progress;
    const fade = smooth01(progress / 0.14) * (1 - smooth01((progress - 0.52) / 0.48));
    for (let index = 0; index < maxParticles; index++) {
      const particle = particles[index]!;
      if (!visible || index >= count) {
        particle.opacity = 0;
        continue;
      }
      const parameter = params[index]!;
      const angle = parameter.angle + parameter.spin * progress * 1.35 +
        Math.sin(progress * 3 + parameter.phase) * 0.16;
      const radius = Math.min(maxRadius, parameter.radius * (0.28 + progress * 0.72));
      const rise = Math.min(maxRise, parameter.lift * progress +
        Math.sin(progress * 5 + parameter.phase) * parameter.wobble);
      const shimmer = 1 + 0.075 * Math.sin(progress * 15 + parameter.phase * 3);
      particle.x = origin.x + Math.cos(angle) * radius;
      particle.y = origin.y + Math.max(0, rise);
      particle.z = origin.z + Math.sin(angle) * radius;
      particle.scale = parameter.size * (0.6 + progress * 0.9) * shimmer;
      particle.rotation = parameter.phase + progress * 1.8 * parameter.spin;
      particle.opacity = 0.56 * fade * (0.86 + 0.14 * Math.sin(progress * 18 + parameter.phase * 2));
    }
    return sample;
  };

  const begin = (nextKind: ExplorationSmokeFrame["kind"], point: { x: number; y: number; z: number }) => {
    kind = nextKind;
    origin.x = Number.isFinite(point.x) ? point.x : 0;
    origin.y = Number.isFinite(point.y) ? point.y : 0;
    origin.z = Number.isFinite(point.z) ? point.z : 0;
    sourceKey = `${kind}:${origin.x}:${origin.y}:${origin.z}`;
    lastProgress = -1;
    progress = 0;
    startedAt = now();
    active = true;
    generate();
    return measure();
  };

  return {
    burst: (nextKind, point) => {
      if (disposed) return measure();
      lastProgress = -1;
      return begin(nextKind, point);
    },
    clear: () => {
      active = false;
      progress = 0;
      lastProgress = -1;
      sample.active = false;
      sample.count = 0;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      active = false;
      sample.active = false;
      sample.count = 0;
    },
    tick: () => {
      if (disposed || !active) return measure();
      progress = clamp01((now() - startedAt) / durationMs);
      if (progress >= 1) active = false;
      return measure();
    },
    update: frame => {
      if (disposed) return measure();
      if (!frame) {
        active = false;
        progress = 0;
        lastProgress = -1;
        sample.active = false;
        sample.count = 0;
        return sample;
      }
      const key = `${frame.kind}:${frame.x}:${frame.y}:${frame.z}`;
      const restart = !active || key !== sourceKey || lastProgress >= 0.99 ||
        frame.progress < lastProgress - 0.75;
      if (restart) begin(frame.kind, frame);
      progress = clamp01(frame.progress);
      lastProgress = progress;
      if (progress >= 1) active = false;
      return measure();
    }
  };
};

export interface ExplorationSmokeAdapterHandle extends ExplorationSmokeAdapter {
  stats: () => { active: boolean; disposed: boolean; drawn: number; pooled: number };
}

export interface ExplorationSmokeAdapterOptions {
  durationMs?: number;
  maxParticles?: number;
  now?: () => number;
  parent: Object3D;
  seed?: number;
}

/** A radial wisp when a DOM canvas exists; a solid 1x1 texture keeps headless tests allocation-only. */
const createSmokeTexture = (): Texture => {
  if (typeof document === "undefined") {
    const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const centre = size / 2;
  const core = context.createRadialGradient(centre, centre, 0, centre, centre, centre);
  core.addColorStop(0, "rgba(244,250,255,0.92)");
  core.addColorStop(.42, "rgba(214,238,255,0.52)");
  core.addColorStop(1, "rgba(190,224,255,0)");
  context.fillStyle = core;
  context.fillRect(0, 0, size, size);
  for (const [dx, dy, radius] of [[-9, -5, 12], [8, -7, 10], [-5, 9, 9], [7, 8, 8]] as const) {
    const lobe = context.createRadialGradient(centre + dx, centre + dy, 0, centre + dx, centre + dy, radius);
    lobe.addColorStop(0, "rgba(238,248,255,0.6)");
    lobe.addColorStop(1, "rgba(203,232,255,0)");
    context.fillStyle = lobe;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

/**
 * Three adapter for the frozen smoke contract. The pool is fixed-size and reused, the root sits in the
 * existing scene, and disposal releases every sprite material and the one shared texture exactly once.
 */
export const createExplorationSmokeAdapter = (
  options: ExplorationSmokeAdapterOptions
): ExplorationSmokeAdapterHandle => {
  const maxParticles = Math.max(1, Math.floor(options.maxParticles ?? EXPLORATION_SMOKE_MAX_PARTICLES));
  const model = createExplorationSmokeModel({
    durationMs: options.durationMs,
    maxParticles,
    now: options.now,
    seed: options.seed
  });
  const root = new Group();
  root.name = "exploration-smoke";
  root.visible = false;
  const texture = createSmokeTexture();
  const sprites: Sprite[] = [];
  for (let index = 0; index < maxParticles; index++) {
    const material = new SpriteMaterial({
      color: EXPLORATION_SMOKE_COLORS.arrival,
      depthWrite: false,
      map: texture,
      opacity: 0,
      transparent: true
    });
    const sprite = new Sprite(material);
    sprite.name = "exploration-smoke-wisp";
    sprite.visible = false;
    root.add(sprite);
    sprites.push(sprite);
  }
  options.parent.add(root);
  let disposed = false;
  let auto = false;

  const render = (sample: ExplorationSmokeSample) => {
    root.visible = sample.active;
    const color = EXPLORATION_SMOKE_COLORS[sample.kind];
    for (let index = 0; index < sprites.length; index++) {
      const sprite = sprites[index]!;
      const particle = sample.particles[index];
      const shown = sample.active && index < sample.count;
      sprite.visible = shown;
      if (!shown || !particle) continue;
      sprite.position.set(particle.x, particle.y, particle.z);
      sprite.scale.setScalar(particle.scale);
      sprite.material.color.setHex(color);
      sprite.material.opacity = particle.opacity;
      sprite.material.rotation = particle.rotation;
    }
  };

  return {
    burst: (kind, point) => {
      if (disposed) return;
      auto = true;
      render(model.burst(kind, point));
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      model.dispose();
      root.visible = false;
      for (const sprite of sprites) {
        sprite.material.dispose();
        sprite.removeFromParent();
      }
      sprites.length = 0;
      texture.dispose();
      root.clear();
      root.removeFromParent();
    },
    stats: () => ({
      active: root.visible,
      disposed,
      drawn: sprites.reduce((count, sprite) => count + (sprite.visible ? 1 : 0), 0),
      pooled: sprites.length
    }),
    update: (frame) => {
      if (disposed) return;
      if (frame) {
        auto = false;
        render(model.update(frame));
        return;
      }
      if (auto) {
        const sample = model.tick();
        render(sample);
        if (!sample.active) auto = false;
        return;
      }
      model.update(null);
      render({ active: false, count: 0, kind: "arrival", origin: { x: 0, y: 0, z: 0 },
        particles: [], progress: 0 });
    }
  };
};
