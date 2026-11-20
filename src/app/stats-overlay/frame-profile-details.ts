import { activeFrameProfiler } from "../../render-common/frame-profiler";
import { type GpuMemoryReport, readGpuMemory } from "../../render-common/gpu-memory-ledger";
import type { FrameProfileReport, PassReport } from "../../render-common/pass-ledger";

const MIB = 1024 * 1024;

const formatMs = (value: number | null) => (value === null ? "?" : value.toFixed(2));

const formatCount = (value: number) =>
  (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0));

const formatPass = ({ cpuMs, drawCalls, gpuMs, triangles }: PassReport) => {
  const gpu = gpuMs === null ? "" : ` gpu ${formatMs(gpuMs)}`;
  const draws = drawCalls > 0 ? `, ${formatCount(drawCalls)} dc ${formatCount(triangles)} tri` : "";
  return `cpu ${formatMs(cpuMs)}${gpu}${draws}`;
};

const formatMemory = ({ bufferBytes, renderbufferBytes, targetTextureBytes, textureBytes }: GpuMemoryReport) =>
  `textures ${(textureBytes / MIB).toFixed(0)} MiB, targets ${(targetTextureBytes / MIB).toFixed(0)} MiB, ` +
  `renderbuffers ${(renderbufferBytes / MIB).toFixed(0)} MiB, buffers ${(bufferBytes / MIB).toFixed(0)} MiB`;

/** Stats-overlay lines of one profiled window: frame totals, every stage/pass, GPU memory. */
export const formatFrameProfileDetails = (report: FrameProfileReport, memory: GpuMemoryReport | null) => {
  const details: Record<string, string> = {
    profileFrame: `cpu ${formatMs(report.frameCpuMs)} gpu ${formatMs(report.frameGpuMs)} ` +
      `(gpu unknown ${report.gpuUnknownFrames}/${report.frames})`
  };
  for (const pass of report.passes) details[`pass.${pass.name}`] = formatPass(pass);
  if (memory) details.gpuMemory = formatMemory(memory);
  return details;
};

/** The R01 lines while `?passes=1` profiles (rolls the profiler's window); empty otherwise. */
export const readFrameProfileDetails = (gl: object) => {
  const profiler = activeFrameProfiler();
  if (!profiler) return {};
  return formatFrameProfileDetails(profiler.rollWindow(), readGpuMemory(gl));
};

/** Bench tools read the last overlay details (counts per LOD/tier, passes) from the page. */
export const exposeProfileDetails = (details: Record<string, unknown>) => {
  (globalThis as { __profileDetails?: Record<string, unknown> }).__profileDetails = details;
};
