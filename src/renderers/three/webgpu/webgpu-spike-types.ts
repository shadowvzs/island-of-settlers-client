import type { Camera, Scene } from "three";
import type { RenderTarget } from "three/webgpu";

import type { RendererChoice } from "../../../render-common/renderer-choice";
import type { AsyncCompileStats } from "./async-pipeline-compiler";
import type { PipelineTrackerStats } from "./pipeline-tracker";
import type { SunShadowSetup, SunShadowSourceTarget } from "./sun-shadow-pass";

export type WebGpuSpikeMode = Exclude<RendererChoice, "webgl">;

export interface WebGpuSpikeStats {
  adapter: string;
  /** G-W5: render objects that stayed hidden until their pipeline compiled between frames. */
  asyncCompile: AsyncCompileStats;
  calls: number;
  compileMs: number;
  gpuMs: number;
  memoryBytes: number;
  mode: WebGpuSpikeMode;
  /** G-W5: node builds/programs/pipelines during and after the prewarm, first frames' CPU ms. */
  pipelines: PipelineTrackerStats;
  /** Draw signatures the prewarm compiled (one representative each). */
  prewarmRepresentatives: number;
  substitutions: Record<string, number>;
  /** C-1, last frame: sun shadow draws, renders, CPU ms and casters without a depth twin. */
  sunShadow: { calls: number; milliseconds: number; renders: number; skipped: Record<string, number> };
  triangles: number;
}

export interface WebGpuPresenterInput {
  /** The canvas whose context the WebGL setup renderer holds (the output overlays it). */
  canvas: HTMLCanvasElement;
  /** `webgpu-gl` forces the node renderer's WebGL2 backend (TSL overhead on the real GPU). */
  forceWebGL: boolean;
}

/**
 * The WG-0 spike presenter: renders the game's existing scene graph through `WebGPURenderer`
 * with stand-in node materials. It is a measurement harness, not the production renderer.
 */
export interface WebGpuSpikePresenter {
  readonly mode: WebGpuSpikeMode;
  beginFrame(): void;
  /** C-1: the WebGL sun shadow pass's scissored clear of one atlas tile. */
  clearSunShadow(target: SunShadowSourceTarget): void;
  /** Compiles a tagged exploration scene (sky, cloud pass) after porting its materials. */
  compile(scene: Scene, camera: Camera): Promise<unknown>;
  dispose(): void;
  endFrame(): void;
  /** The loading screen is gone: later node builds and pipelines count as visible hitches. */
  finishPrewarm(): void;
  /** Replaces materials and compiles the static scenes before the first drawn frame. */
  prepare(scenes: readonly Scene[], camera: Camera): Promise<number>;
  /**
   * Compiles every scene drawn so far (buildings, workers, effects arrive after `prepare`), hidden
   * variants included; the loading screen still covers it.
   */
  prewarmPresented(camera: Camera): Promise<void>;
  /** `renderTarget` is the game's WebGL render target for the possessed cloud passes. */
  render(scene: Scene, camera: Camera, renderTarget?: RenderTarget | null): void;
  /** C-1: one caster draw of the WebGL sun shadow pass, redirected into the WebGPU atlas twin. */
  renderSunShadow(scene: Scene, camera: Camera, target: SunShadowSourceTarget): void;
  resize(width: number, height: number, pixelRatio: number): void;
  /** The possessed eye's auto-exposure weight (0 strategic/cinematic: fixed exposure). */
  setEyeAdaptation(weight: number): void;
  /** Changes the post chain's feature set; the chain rebuilds on the next frame. */
  setPostQuality(settings: Partial<import("../../webgpu/tsl/post/post-chain").TslPostSettings>): void;
  /** C-1: the sun shadow caster scene and shared receiver uniforms (before `prepare`). */
  setSunShadows(setup: SunShadowSetup): void;
  /** Stop re-traversing for late-created objects; the measured frames contain node submission only. */
  settle(): void;
  stats(): WebGpuSpikeStats;
  /** Exposed for the bench: the last frames' CPU submit and GPU times. */
  frameTimings(): { cpu: readonly number[]; gpu: readonly number[] };
  /**
   * Dev tool (`tools/webgpu/tsl-scope-check.ts`): the generated shaders of the next draw that uses
   * the named node material (for example `wg:sky`).
   */
  shaderOf(materialName: string): Promise<import("./presenter-hooks").GeneratedShaders>;
}

export type CreateWebGpuSpikePresenter =
  (input: WebGpuPresenterInput) => Promise<WebGpuSpikePresenter | null>;
