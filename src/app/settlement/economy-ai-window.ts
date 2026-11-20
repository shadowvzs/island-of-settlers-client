import { createDefaultPolicy, createLazyReactWindow, type LazyWindowView } from "../components/lazy-react-window";
import { createExternalStore } from "../components/ui-store";
import { createDevelopmentTool } from "../settings/development/development-tool";
import type { EconomyAiSessionOptions } from "./economy-ai-debug/session";

import "./economy-ai-window.css";

const ECONOMY_AI_LABEL = "Economy AI";
const ECONOMY_AI_TITLE = "Why each computer faction builds, waits or backs off (goal scores, planner, maintain).";
const ECONOMY_AI_ICON_URL = new URL("../../../assets/ui-icons/ai/develop.webp", import.meta.url).href;

/**
 * Development tools > Economy > Economy AI (enemy economy AI plan §3.4, EAI3d): the A16-style "why" window of the
 * computer factions' economy AI. Only this opener is created with the development tools; the panel, its probe
 * recorder, its polling and its map marks load on the first open and run only while the window is open.
 */
export const createEconomyAiWindow = (options: Omit<EconomyAiSessionOptions, "open">) => {
  const open = createExternalStore(false);
  /** The default open/close rules, publishing the open state the live session follows. */
  const policy = (view: LazyWindowView) => {
    const base = createDefaultPolicy(view);
    return {
      ...base,
      close: () => { base.close(); open.set(false); },
      handleKey: (key: string) => {
        const handled = base.handleKey(key);
        if (handled) open.set(false);
        return handled;
      },
      open: () => { base.open(); open.set(true); }
    };
  };
  const economyAiWindow = createLazyReactWindow({
    className: "economy-ai-window", container: options.viewport, contentClassName: "economy-ai-window__body",
    heading: ECONOMY_AI_LABEL, id: "economy-ai-title",
    load: async () =>
      (await import("./economy-ai-debug/mount-economy-ai-panel")).createEconomyAiPanelMount({ ...options, open }),
    policy
  });
  const tool = createDevelopmentTool({
    hasPopup: "dialog", icon: ECONOMY_AI_ICON_URL, label: ECONOMY_AI_LABEL,
    registerButton: economyAiWindow.registerOpener, title: ECONOMY_AI_TITLE, onClick: economyAiWindow.open
  });
  return { ...economyAiWindow, tool };
};
