import { msg } from "@lingui/core/macro";

/** Info panel (frame statistics) copy. */
export const STATS_MESSAGES = {
  label: {
    browser: msg({ id: "stats.label.browser", message: "browser" }),
    cpu: msg({ id: "stats.label.cpu", message: "cpu" }),
    detail: msg({ id: "stats.label.detail", message: "detail" }),
    drawingBuffer: msg({ id: "stats.label.drawingBuffer", message: "drawing buffer" }),
    drawCalls: msg({ id: "stats.label.drawCalls", message: "draw calls" }),
    fps: msg({ id: "stats.label.fps", message: "fps" }),
    gpu: msg({ id: "stats.label.gpu", message: "gpu" }),
    low: msg({ id: "stats.label.low", message: "1% low" }),
    notMeasured: msg({ id: "stats.label.notMeasured", message: "not measured" }),
    renderer: msg({ id: "stats.label.renderer", message: "renderer" }),
    triangles: msg({ id: "stats.label.triangles", message: "triangles" })
  },
  copy: {
    copied: msg({ id: "stats.copy.copied", message: "Info copied" }),
    copiedTitle: msg({ id: "stats.copy.copiedTitle", message: "Copied" }),
    label: msg({ id: "stats.copy.label", message: "Copy info to clipboard" })
  },
  help: {
    default: msg({
      id: "stats.help.default",
      message: "drag / arrow keys: pan, wheel: zoom, click a tree: fell it; left-click worker: select, right-click ground: move, left-click elsewhere: deselect, C: cinematic camera"
    }),
    settlement: msg({
      id: "stats.help.settlement",
      message: "drag / arrow keys: pan, wheel: zoom, R: rotate building, Escape: cancel placement; choose buildings and roads from the bottom panel"
    })
  },
  title: msg({ id: "stats.title", message: "Info" }),
  tool: msg({ id: "stats.tool", message: "Show info" }),
  warning: {
    software: msg({
      id: "stats.warning.software", message: "WARNING: software WebGL (no GPU), timings are not valid"
    })
  }
} as const;
