import {
  clamp, float, Fn, If, int, ivec2, length, max, mix, normalize, smoothstep, sqrt,
  texture, textureLoad, uint, uniform, uv, uvec3, vec2, vec3, vec4
} from "three/tsl";
import {
  type Camera,
  HalfFloatType,
  Matrix4,
  type RenderTarget,
  type Texture,
  Vector2,
  type WebGPURenderer
} from "three/webgpu";

import {
  EXPLORATION_CLOUD,
  EXPLORATION_CLOUD_JITTER_HASH,
  EXPLORATION_CLOUD_RESOLVE
} from "../../../../render-common/atmosphere/exploration-sky-constants";
import {
  advanceCloudDrift,
  cloudHistoryWeight
} from "../../../three/exploration-weather/exploration-cloud-history";
import { createPassMaterial, createQuadPass } from "../post/quad-pass";
import { createPostTarget, resizePostTarget } from "../post/targets";
import { bindMatrix, type UniformBindings } from "../uniform-bindings";
import { capCloudDisplay, type CloudNodes, skyShellDistance } from "./clouds";
import { cloudUvOfNdc, createSkyViewRay, ndcOfPassUv } from "./view-ray";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const RESOLVE = EXPLORATION_CLOUD_RESOLVE;
const HASH = EXPLORATION_CLOUD_JITTER_HASH;

/** GLSL pixelFrameHash: white per-pixel, per-frame jitter (no cross-hatch where history drops). */
export const pixelFrameHash = Fn(([pixel, frame]: [TslNode, TslNode]) => {
  const value: TslNode = uvec3(uint(pixel.x), uint(pixel.y), uint(frame)).toVar();
  value.assign(value.mul(uvec3(uint(HASH.multiplier), uint(HASH.multiplier), uint(HASH.multiplier)))
    .add(uvec3(uint(HASH.increment), uint(HASH.increment), uint(HASH.increment))));
  value.x.assign(value.x.add(value.y.mul(value.z)));
  value.y.assign(value.y.add(value.z.mul(value.x)));
  value.z.assign(value.z.add(value.x.mul(value.y)));
  value.assign(value.bitXor(value.shiftRight(uvec3(uint(16), uint(16), uint(16)))));
  value.x.assign(value.x.add(value.y.mul(value.z)));
  return float(value.x.bitAnd(uint(0xffffff))).div(16777216);
});

/** Projection times the rotation-only view: maps a world direction to last frame's clip space. */
const writeRotationViewProjection = (camera: Camera, target: Matrix4) => {
  target.copy(camera.matrixWorldInverse);
  target.elements[12] = target.elements[13] = target.elements[14] = 0;
  return target.premultiply(camera.projectionMatrix);
};

export interface TslCloudPass {
  dispose: () => void;
  /** Builds the march and resolve pipelines (they would otherwise build on the first possessed frame). */
  prewarm: (renderer: WebGPURenderer) => void;
  /** Marches and resolves this frame's clouds into the half-resolution history. */
  render: (renderer: WebGPURenderer, camera: Camera) => void;
  /** Premultiplied display colour and opacity at a sky NDC point (0 until the first render). */
  sample: (screen: TslNode) => TslNode;
}

interface PassInputs {
  bindings: UniformBindings;
  cameraAltitude: TslNode;
  clouds: CloudNodes;
  /** Whether the volumetric clouds draw this frame (cover and detail gates of the sky). */
  isActive: () => boolean;
  /** The lower layer's wind drift (`uCloudDrift`), read each render for the reprojection. */
  readDrift: () => ArrayLike<number>;
}

/**
 * TSL twin of exploration-cloud-pass.ts (TSL-3c): the cumulus march at half resolution with a
 * per-pixel, per-frame jitter, then the temporal resolve (camera-rotation and wind reprojection,
 * Catmull-Rom history, variance clip, frame-rate independent weight). Three half-float targets live
 * with the possessed sky material.
 */
export const createTslCloudPass = (inputs: PassInputs): TslCloudPass => {
  const { bindings, cameraAltitude, clouds } = inputs;
  const current = createPostTarget(1, 1, { type: HalfFloatType });
  const histories = [createPostTarget(1, 1, { type: HalfFloatType }),
    createPostTarget(1, 1, { type: HalfFloatType })];
  const passSize = uniform(new Vector2(1, 1));
  const historySize = uniform(new Vector2(1, 1));
  const frameIndex = uniform(0);
  const historyWeight = uniform(0);
  const driftDelta = uniform(new Vector2());
  const ready = uniform(0);
  const previousViewProjection = uniform(new Matrix4());
  const inverseProjection = bindMatrix(bindings, "uInverseProjection");
  const cameraWorld = bindMatrix(bindings, "uCameraWorld");
  const currentNode = texture(current.texture) as TslNode;
  const historyNode = texture(histories[0]!.texture) as TslNode;
  const resolvedNode = texture(histories[1]!.texture) as TslNode;
  const previousDrift = new Float32Array(2);
  const delta = new Float32Array(2);
  const drawingSize = new Vector2();
  let quad: ReturnType<typeof createQuadPass> | null = null;
  let lastRenderMs = -Infinity;
  let historyIndex = 0;

  const viewDirection = () => createSkyViewRay(ndcOfPassUv(uv()), inverseProjection,
    cameraWorld).direction.toVar();

  const march = createPassMaterial("wg:cloud-march", Fn(() => {
    const pixel = uv().mul(passSize).floor();
    const jitter = pixelFrameHash(pixel, frameIndex);
    return capCloudDisplay(clouds.march(viewDirection(), cameraAltitude, jitter));
  })());

  /** GLSL previousCloudDirection: the direction moved back by the wind drift at the deck. */
  const previousCloudDirection = (direction: TslNode): TslNode => {
    const result = direction.toVar();
    If(direction.y.greaterThan(0), () => {
      const distance: TslNode = skyShellDistance(direction, cameraAltitude,
        RESOLVE.reprojectionAltitude);
      If(distance.greaterThan(0).and(distance.lessThanEqual(EXPLORATION_CLOUD.marchLimit)), () => {
        const drift = vec3(driftDelta.x, 0, driftDelta.y).mul(RESOLVE.driftShare);
        result.assign(normalize(direction.mul(distance).add(drift)));
      });
    });
    return result;
  };

  /** GLSL sampleHistory: five-tap Catmull-Rom read (sharp under continuous camera motion). */
  const sampleHistory = (point: TslNode): TslNode => {
    const position: TslNode = point.mul(historySize);
    const centre = position.sub(0.5).floor().add(0.5);
    const f: TslNode = position.sub(centre);
    const w0: TslNode = f.mul(float(-0.5).add(f.mul(float(1).sub(f.mul(0.5)))));
    const w1 = float(1).add(f.mul(f).mul(float(-2.5).add(f.mul(1.5))));
    const w2 = f.mul(float(0.5).add(f.mul(float(2).sub(f.mul(1.5)))));
    const w3: TslNode = f.mul(f).mul(float(-0.5).add(f.mul(0.5)));
    const w12: TslNode = w1.add(w2);
    const uv0: TslNode = centre.sub(1).div(historySize);
    const uv3: TslNode = centre.add(2).div(historySize);
    const uv12: TslNode = centre.add(w2.div(w12)).div(historySize);
    const taps: Array<[TslNode, TslNode]> = [
      [vec2(uv12.x, uv0.y), w12.x.mul(w0.y)],
      [vec2(uv0.x, uv12.y), w0.x.mul(w12.y)],
      [uv12, w12.x.mul(w12.y)],
      [vec2(uv3.x, uv12.y), w3.x.mul(w12.y)],
      [vec2(uv12.x, uv3.y), w12.x.mul(w3.y)]
    ];
    let sum: TslNode = vec4(0);
    let weight: TslNode = float(0);
    for (const [tap, tapWeight] of taps) {
      sum = sum.add(historyNode.sample(tap).level(0).mul(tapWeight));
      weight = weight.add(tapWeight);
    }
    return max(sum.div(weight), vec4(0));
  };

  const resolve = createPassMaterial("wg:cloud-resolve", Fn(() => {
    const pixel = uv().mul(passSize).floor();
    const limit = passSize.sub(1);
    const centre = textureLoad(currentNode, ivec2(int(pixel.x), int(pixel.y))).toVar();
    let sum: TslNode = vec4(0);
    let squares: TslNode = vec4(0);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const tap = clamp(pixel.add(vec2(x, y)), vec2(0, 0), limit);
      const neighbour = textureLoad(currentNode, ivec2(int(tap.x), int(tap.y)));
      sum = sum.add(neighbour);
      squares = squares.add(neighbour.mul(neighbour));
    }
    const mean = sum.div(9).toVar();
    const deviation = sqrt(max(squares.div(9).sub(mean.mul(mean)), vec4(0))).toVar();
    const filtered = mix(centre, mean, RESOLVE.currentMeanShare).toVar();
    const result = filtered.toVar();
    // A restart never reads the history: an unwritten target must not leak into the result.
    If(historyWeight.greaterThan(0), () => {
      const direction = viewDirection();
      const previousClip = previousViewProjection.mul(vec4(previousCloudDirection(direction), 0));
      const previousUv = cloudUvOfNdc(previousClip.xy.div(max(previousClip.w, 0.0001))).toVar();
      const inside = previousClip.w.greaterThan(0)
        .and(previousUv.x.greaterThanEqual(0)).and(previousUv.y.greaterThanEqual(0))
        .and(previousUv.x.lessThanEqual(1)).and(previousUv.y.lessThanEqual(1));
      If(inside, () => {
        // Screen motion in cloud pixels: turning and drifting history keeps less weight.
        const motion = smoothstep(RESOLVE.motionStart, RESOLVE.motionEnd,
          length(previousUv.sub(uv()).mul(passSize)));
        const clipWidth = mix(RESOLVE.clipStill, RESOLVE.clipMoving, motion);
        const history = clamp(sampleHistory(previousUv),
          mean.sub(deviation.mul(clipWidth)), mean.add(deviation.mul(clipWidth)));
        result.assign(mix(filtered, history,
          historyWeight.mul(mix(1, RESOLVE.movingHistoryShare, motion))));
      });
    });
    return result;
  })());

  /** Half of the destination (the post chain's scene target) or of the drawing buffer. */
  const readHalfSize = (renderer: WebGPURenderer, destination: RenderTarget | null) => {
    if (destination) drawingSize.set(destination.width, destination.height);
    else renderer.getDrawingBufferSize(drawingSize);
    drawingSize.set(Math.max(1, Math.ceil(drawingSize.x * EXPLORATION_CLOUD.resolutionScale)),
      Math.max(1, Math.ceil(drawingSize.y * EXPLORATION_CLOUD.resolutionScale)));
  };

  /** Sizes a target written this frame; the history keeps its size (it is read by UV). */
  const fit = (target: RenderTarget) => {
    if (target.width === drawingSize.x && target.height === drawingSize.y) return;
    resizePostTarget(target, drawingSize.x, drawingSize.y);
  };

  const render = (renderer: WebGPURenderer, camera: Camera) => {
    if (!inputs.isActive()) return;
    const destination = renderer.getRenderTarget();
    quad ??= createQuadPass(renderer);
    const now = performance.now();
    historyWeight.value = cloudHistoryWeight(now - lastRenderMs);
    lastRenderMs = now;
    advanceCloudDrift(inputs.readDrift(), previousDrift, delta);
    driftDelta.value.set(delta[0]!, delta[1]!);
    frameIndex.value = (frameIndex.value + 1) % HASH.frameWrap;
    const output = histories[historyIndex]!, history = histories[1 - historyIndex]!;
    readHalfSize(renderer, destination);
    fit(current);
    fit(output);
    passSize.value.copy(drawingSize);
    historySize.value.set(history.width, history.height);
    historyNode.value = history.texture as Texture;
    try {
      quad.draw(march, current);
      quad.draw(resolve, output);
    } finally {
      renderer.setRenderTarget(destination);
    }
    writeRotationViewProjection(camera, previousViewProjection.value);
    resolvedNode.value = output.texture as Texture;
    ready.value = 1;
    historyIndex = 1 - historyIndex;
  };

  /**
   * One draw of each pass at load (into the still tiny targets; `ready` stays 0, so nothing is
   * shown). A quad `compileAsync` builds for another render object and did not spare the first
   * possessed frame its node builds.
   */
  const prewarm = (renderer: WebGPURenderer) => {
    const destination = renderer.getRenderTarget();
    quad ??= createQuadPass(renderer);
    // As in `render`: the resolve reads one history and writes the other (never the same texture).
    historyNode.value = histories[1 - historyIndex]!.texture as Texture;
    try {
      quad.draw(march, current);
      quad.draw(resolve, histories[historyIndex]!);
    } finally {
      renderer.setRenderTarget(destination);
    }
  };

  const sample = (screen: TslNode): TslNode =>
    resolvedNode.sample(cloudUvOfNdc(screen)).mul(ready);

  return {
    dispose: () => {
      current.dispose();
      for (const target of histories) target.dispose();
      march.dispose();
      resolve.dispose();
      quad?.dispose();
      quad = null;
      ready.value = 0;
      lastRenderMs = -Infinity;
    },
    prewarm,
    render,
    sample
  };
};

