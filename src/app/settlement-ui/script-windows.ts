import { HARBOUR_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { MainPanelView } from "./main-panel/main-panel";
import type { SettlementUiSnapshot } from "./types";

/** Settlement windows a map script may open, bring to front or close (trigger design §5.2.9, TRG9). */
export type SettlementScriptWindow =
  | "colonyTracker" | "expeditionPlanner" | "gemShop" | "market" | "overview" | "talents" | "tradeOffice";

/** The script's thin adapter over the settlement windows; every opener reuses the window's own open path. */
export interface SettlementScriptWindows {
  close: (window: SettlementScriptWindow) => void;
  closeBuildingDetails: () => void;
  closeMainPanel: (view: MainPanelView) => void;
  closeMessages: () => void;
  closeQuests: () => void;
  /** UI-only building details: camera focus + details panel, never the recorded `select` (rev M16). */
  focusBuildingDetails: (uid: number) => boolean;
  /** Shows the main panel view and raises it; never toggles it closed. */
  focusMainPanelView: (view: MainPanelView) => boolean;
  open: (window: SettlementScriptWindow) => boolean;
  /** The inbox, on this mail when it is listed. */
  openMessages: (mailId: string | null) => void;
  /** The quest book, on this quest when it is listed (opener token). */
  openQuests: (questId: string | null) => void;
}

interface ClosableWindow {
  close: () => void;
  open: () => void;
}

export interface SettlementScriptWindowParts {
  colonyPlanner?: { close: () => void; openFor: (uid: number) => void };
  colonyTracker: { setCollapsed: (collapsed: boolean) => boolean };
  detailsWindow: { close: () => void };
  focusBuildingDetails: (uid: number) => boolean;
  gemShop: ClosableWindow;
  mainPanel: {
    focusView: (view: MainPanelView) => boolean; hide: () => void; isShowing: (view: MainPanelView) => boolean;
  };
  marketWindow: ClosableWindow;
  messageWindow: ClosableWindow & { openWith: (request: { mailId: string | null }) => void };
  questWindow: ClosableWindow & { openWith: (request: { questId: string | null }) => void };
  snapshot: () => SettlementUiSnapshot;
  summaryWindow: ClosableWindow;
  talentsWindow: ClosableWindow;
  tradeOffice?: ClosableWindow;
  /** Trading is for the home island only. */
  tradeAllowed: () => boolean;
}

/** The first own completed harbour: the expedition planner's subject. */
const ownHarbourUid = (snapshot: SettlementUiSnapshot) => {
  const harbour = snapshot.buildings?.find(building =>
    building.type === HARBOUR_TYPE_ID && !building.hostile && building.completed !== false);
  return harbour ? Number(harbour.id) : null;
};

const plainWindow = (parts: SettlementScriptWindowParts, window: SettlementScriptWindow) => {
  switch (window) {
    case "gemShop": return parts.gemShop;
    case "market": return parts.marketWindow;
    case "overview": return parts.summaryWindow;
    case "talents": return parts.talentsWindow;
    case "tradeOffice": return parts.tradeAllowed() ? parts.tradeOffice : undefined;
    default: return undefined;
  }
};

const openSpecial = (parts: SettlementScriptWindowParts, window: SettlementScriptWindow) => {
  if (window === "colonyTracker") return parts.colonyTracker.setCollapsed(false);
  const harbour = ownHarbourUid(parts.snapshot());
  if (harbour === null || !parts.colonyPlanner) return false;
  parts.colonyPlanner.openFor(harbour);
  return true;
};

/** Builds the script adapter from the settlement UI's own windows (no new visibility state, CODING-RULES §4). */
export const createSettlementScriptWindows = (parts: SettlementScriptWindowParts): SettlementScriptWindows => ({
  close: window => {
    if (window === "colonyTracker") parts.colonyTracker.setCollapsed(true);
    else if (window === "expeditionPlanner") parts.colonyPlanner?.close();
    else plainWindow(parts, window)?.close();
  },
  closeBuildingDetails: () => parts.detailsWindow.close(),
  closeMainPanel: view => {
    if (parts.mainPanel.isShowing(view)) parts.mainPanel.hide();
  },
  closeMessages: () => parts.messageWindow.close(),
  closeQuests: () => parts.questWindow.close(),
  focusBuildingDetails: parts.focusBuildingDetails,
  focusMainPanelView: view => parts.mainPanel.focusView(view),
  open: window => {
    const plain = plainWindow(parts, window);
    if (plain) {
      plain.open();
      return true;
    }
    if (window === "colonyTracker" || window === "expeditionPlanner") return openSpecial(parts, window);
    return false;
  },
  openMessages: mailId => parts.messageWindow.openWith({ mailId }),
  openQuests: questId => parts.questWindow.openWith({ questId })
});
