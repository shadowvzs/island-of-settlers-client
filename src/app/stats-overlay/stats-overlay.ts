import type { MessageDescriptor } from "@lingui/core";
import type { I18n } from "@lingui/core";

import type { FrameSummary } from "../../render-common/frame-stats";
import type { QualityLevel } from "../../render-common/quality";
import type { RendererStats } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import { runWhenIdle } from "../components/lazy-react-content";
import { createExternalStore } from "../components/ui-store";
import { createWindowFrame } from "../components/window/window-frame-controller";
import { createIconTool } from "../settings/development/development-tool";
import { getRendererString, isSoftwareRenderer } from "../settings/device-probe";
import { appendToLayer, isolatePointer } from "../window-layer";
import {
  formatStatsText, getSoftwareGlWarning, type StatsOverlayText
} from "./helpers";
import { STATS_MESSAGES as M } from "./messages";

export interface StatsOverlayOptions {
  detail: QualityLevel;
  gl: WebGL2RenderingContext;
  /** Controls help below the statistics; the default is the RTS camera help. */
  help?: MessageDescriptor;
  i18n?: I18n;
  /** Panel open at start (remembered between sessions by the caller). */
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
}

/** The frame mounts this long after the first statistics even if the main thread never idles. */
const IDLE_TIMEOUT_MS = 200;

/**
 * Info panel (frame statistics and controls help) in the settlement window style: header, close button,
 * draggable; opened from Development tools > Diagnostics (`tool`) or `toggle`. The statistics publish into a
 * store every stats tick; the React window mounts on the first open or at the first statistics (next idle
 * moment), so the `.stats-overlay pre` text the renderer test harness reads keeps updating while closed.
 */
export const createStatsOverlay = (container: HTMLElement, options: StatsOverlayOptions) => {
  const { i18n } = options;
  let helpSource: string | MessageDescriptor = options.help ?? M.help.default;
  const resolveHelp = () => typeof helpSource === "string" ? helpSource : translateMessage(i18n, helpSource);
  const text = createExternalStore<StatsOverlayText>({ help: resolveHelp(), stats: "" });
  const setVisible = (visible: boolean) => {
    tool.update({ active: visible });
    options.onVisibilityChange(visible);
  };
  const frame = createWindowFrame({
    className: "stats-overlay", heading: translateMessage(i18n, M.title), id: "stats-overlay-title",
    load: async () => (await import("./mount")).createStatsOverlayMount(text),
    onClose: () => setVisible(false), visible: options.visible
  });
  const toggle = () => {
    if (frame.isOpen()) return frame.close();
    frame.open();
    setVisible(true);
  };
  const tool = createIconTool("statistics", M.tool, toggle);
  isolatePointer(frame.root);
  // This wrapper shares the scene window stacking context.
  const layer = appendToLayer(container, frame.root, "stats-overlay-layer");
  tool.update({ active: options.visible });
  let disposed = false;
  // Headless Chrome silently falls back to SwiftShader when the GPU is unavailable: frames then cost ~700 ms
  // and look like a renderer regression, so the overlay says so. Reads the renderer's own context (a new
  // context would wait for the GPU process, busy compiling the shaders).
  const rendererName = getRendererString(options.gl);
  const glWarning = isSoftwareRenderer(rendererName) ? [getSoftwareGlWarning(i18n)] : [];
  const refreshCopy = () => {
    if (disposed) return;
    frame.setTitle(translateMessage(i18n, M.title));
    text.set({ ...text.getSnapshot(), help: resolveHelp() });
  };
  const unsubscribeLocale = i18n?.on("change", refreshCopy);
  let scheduled = false;

  const update = (summary: FrameSummary, stats: RendererStats) => {
    if (disposed) return;
    const label = (descriptor: MessageDescriptor) => translateMessage(i18n, descriptor);
    const next = formatStatsText([
      ...glWarning,
      `${label(M.label.renderer)}: ${rendererName}`,
      `${label(M.label.drawingBuffer)}: ${options.gl.drawingBufferWidth} × ${options.gl.drawingBufferHeight}`,
      `${label(M.label.browser)}: ${navigator.userAgent}`
    ], options.detail, summary, stats, i18n);
    if (next !== text.getSnapshot().stats) text.set({ ...text.getSnapshot(), stats: next });
    if (scheduled) return;
    scheduled = true;
    runWhenIdle(frame.mount, IDLE_TIMEOUT_MS);
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeLocale?.();
      frame.dispose();
      layer.remove();
    },
    tool,
    toggle,
    update,
    setHelp: (help: string | MessageDescriptor) => {
      if (disposed) return;
      helpSource = help;
      text.set({ ...text.getSnapshot(), help: resolveHelp() });
    }
  };
};
