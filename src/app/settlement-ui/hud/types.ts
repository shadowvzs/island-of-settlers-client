import type { SurveyJob } from "../../../shared/settlement/settlement-surveying";
import type { MountWindowContent } from "../../components/lazy-react-content";
import type { WindowShortcut } from "../../settings/window-shortcut";
import type { MenuEntryId } from "../main-panel/helpers";
import type { MainPanelVisibilityStore } from "../main-panel/main-panel";
import type { SettlementRoadMode } from "../types";
import type { SettlementUiStore } from "../ui-store";
import type { LauncherId } from "./helpers";

/** Commands of the settlement HUD; the settlement UI controller (index.ts) owns their rules. */
export interface SettlementHudActions {
  /** The session offers campaigns: the home island's bar shows their launcher (C8). */
  canCampaign: boolean;
  /** Road and survey tools are offered only when the caller wired surveying. */
  canSurvey: boolean;
  /** Loads the main panel's Ships view (its own chunk, on the first opening). */
  loadFleet: () => Promise<MountWindowContent>;
  /** Window shortcuts shown after the Main selection entries (their windows return focus to them). */
  menuShortcuts: readonly WindowShortcut[];
  onCancelPlacement: () => void;
  /** The main panel's close button. */
  onClosePanel: () => void;
  onFocusBuilding: (id: string) => void;
  /** The Build view's home sandbox switch (home island only, recorded `setHomeBuildingRules`). */
  onHomeSandbox: (enabled: boolean) => void;
  onLauncher: (id: LauncherId, opener?: HTMLElement) => void;
  onMenuEntry: (id: MenuEntryId) => void;
  onOpenMessages: () => void;
  onOpenQuests: () => void;
  onOpenShop: () => void;
  onOpenTalents: () => void;
  onPickBuilding: (id: number) => void;
  onRoadTool: (mode: Exclude<SettlementRoadMode, null>) => void;
  onRotate: () => void;
  onSurveyJob: (job: SurveyJob) => void;
}

/** Where the HUD renders: its root's host (player corner, status, placement, bar) and the main panel's host. */
interface SettlementHudHosts {
  hud: HTMLElement;
  mainPanel: HTMLElement;
}

export interface SettlementHudProps {
  actions: SettlementHudActions;
  hosts: SettlementHudHosts;
  panel: MainPanelVisibilityStore;
  store: SettlementUiStore;
}
