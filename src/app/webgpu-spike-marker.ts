import type { RendererChoice } from "../render-common/renderer-choice";

/**
 * Dev-only marker for a stored `island.renderer` choice (WG-0): the hidden setting is applied on
 * every reload without a query string, so the spike must never be silently sticky. Player builds
 * never load this module.
 */
export const showWebGpuSpikeMarker = (choice: Exclude<RendererChoice, "webgl">) => {
  const markerId = "webgpu-spike-marker";
  if (typeof document === "undefined" || document.getElementById(markerId) !== null) return;
  const marker = document.createElement("div");
  marker.id = markerId;
  marker.className = "webgpu-spike-marker";
  marker.textContent = `WebGPU spike: ${choice}`;
  marker.title = "Stored island.renderer choice; reload with ?renderer=webgl to clear";
  (document.getElementById("viewport") ?? document.body).append(marker);
};
