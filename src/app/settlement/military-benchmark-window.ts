import { createLazyReactWindow } from "../components/lazy-react-window";
import { createDevelopmentTool } from "../settings/development/development-tool";
import { getBenchmarkToolTitle } from "./military-benchmark/helpers";
import { measured } from "./military-mode-benchmark.json";

import "./military-benchmark-window.css";

const BENCHMARK_LABEL = "Historical military benchmark";
const BENCHMARK_ICON_URL = new URL("../../../assets/ui-icons/statistics.webp", import.meta.url).href;

/**
 * Archived observations only: this viewer never changes military behavior or performs a benchmark. Its opener
 * is a Development tools > Military tool; the window gives focus back to it on close.
 */
export const createMilitaryBenchmarkWindow = (container: HTMLElement) => {
  const benchmarkWindow = createLazyReactWindow({
    className: "military-benchmark-window", container, contentClassName: "military-benchmark-window__body",
    heading: BENCHMARK_LABEL, id: "military-benchmark-title",
    load: async () => (await import("./military-benchmark/military-benchmark-panel")).mountMilitaryBenchmarkPanel
  });
  const tool = createDevelopmentTool({
    hasPopup: "dialog", icon: BENCHMARK_ICON_URL, label: BENCHMARK_LABEL, registerButton: benchmarkWindow.registerOpener,
    title: getBenchmarkToolTitle(measured), onClick: benchmarkWindow.open
  });
  return { ...benchmarkWindow, tool };
};
