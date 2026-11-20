import { WORKER_COLORS, type WorkerColor } from "../../../render-common/workers/worker-colors";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { translateMessage } from "../../../shared/i18n/translate";
import type { SwatchOption } from "../../components/swatch-picker-helpers";
import type { ExternalStore } from "../../components/ui-store";
import type { MilitaryAiDebug } from "../../settlement/military-ai-debug";
import type { MilitaryDebugControls } from "../../settlement/military-debug/helpers";
import type { WeatherControls } from "../../weather-controls";
import type { ExpeditionDiscoveryDebug } from "../expedition-discovery-debug";
import { DEVELOPMENT_MESSAGES as M, type DevelopmentText } from "./messages";

/** Live state of a development tool button (published by its owner, e.g. a toggle mode). */
export interface DevelopmentToolState {
  active?: boolean;
  disabled: boolean;
  title: DevelopmentText;
}

/** A development tool rendered by the React tabs: its icon, name, click and live state. */
export interface DevelopmentTool {
  hasPopup?: "dialog";
  icon: string;
  /** Named shared IconButton artwork for new compact actions. */
  sharedIcon?: string;
  /** Extra class of the icon image (e.g. a tint). */
  iconClassName?: string;
  label: DevelopmentText;
  registerButton?: (element: HTMLButtonElement | null) => void;
  state: ExternalStore<DevelopmentToolState>;
  onClick: () => void;
  /** Changes the live state (disabled, title, active toggle). */
  update: (changes: Partial<DevelopmentToolState>) => void;
}

/** A control section of a development tab, rendered by kind. */
export type DevelopmentSection =
  | { kind: "global-appearance" }
  | { debug: ExpeditionDiscoveryDebug; kind: "expedition-discovery" }
  | { debug: ExternalStore<MilitaryAiDebug | null>; kind: "military-ai" }
  | { debug: ExternalStore<MilitaryDebugControls | null>; kind: "military-debug" }
  | { checked: boolean; kind: "reveal-ore"; onChange: (checked: boolean) => void }
  | { kind: "weather"; weather: WeatherControls }
  | { color: WorkerColor; kind: "workers"; onColorChange: (color: WorkerColor) => void;
    onNationChange: (nation: WorkerNation) => Promise<void> };

/** Named group of development actions (icon buttons) and control sections. */
export interface DevelopmentGroup {
  buttons?: readonly DevelopmentTool[];
  id: string;
  label: DevelopmentText;
  sections?: readonly DevelopmentSection[];
}

/** One development tab: groups sharing an id merged in order. */
export interface DevelopmentTab {
  buttons: DevelopmentTool[];
  id: string;
  label: DevelopmentText;
  sections: DevelopmentSection[];
}

/** Development guests keep local tools; the server-wide season is reserved for verified administrators. */
export const globalAppearanceSections = (admin: boolean | undefined): DevelopmentSection[] => {
  if (admin !== true) return [];
  return [{ kind: "global-appearance" }];
};

/** Merges groups by id (first label wins) and drops tabs left without actions or controls. */
export const mergeDevelopmentGroups = (groups: readonly DevelopmentGroup[]) => {
  const tabs = new Map<string, DevelopmentTab>();
  for (const { buttons = [], id, label, sections = [] } of groups) {
    const tab = tabs.get(id) ?? { buttons: [], id, label, sections: [] };
    tab.buttons.push(...buttons);
    tab.sections.push(...sections);
    tabs.set(id, tab);
  }
  return [...tabs.values()].filter(tab => tab.buttons.length > 0 || tab.sections.length > 0);
};

/** The tool grid of a tab; undefined when it has no tools. */
export const getToolGrid = (tools: readonly DevelopmentTool[]) => tools.length > 0 ? tools : undefined;

/** Tool button classes: the shared icon style, marked while its toggle is on. */
export const getToolClassName = (active: boolean | undefined) => active ? "settings__icon is-active" : "settings__icon";

/** Worker colour swatches of Development tools > Appearance, resolved in the active locale. */
export const getWorkerColorChoices = (i18n?: Parameters<typeof translateMessage>[0]): readonly SwatchOption<WorkerColor>[] =>
  WORKER_COLORS.map(({ hex, id }) => ({
    color: hex,
    label: translateMessage(i18n, M.color[id]),
    value: id
  }));

/** English fallback used by pure helpers and existing tests. */
export const WORKER_COLOR_CHOICES = getWorkerColorChoices();
