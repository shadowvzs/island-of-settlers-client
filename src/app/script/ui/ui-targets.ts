import type {
  ResolvedUiTarget
} from "../../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import type { SettingsSection, UiTargetKind } from "../../../../../island-of-settlers-shared/src/script/types/ui";
import type {
  SettlementScriptWindow, SettlementScriptWindows
} from "../../settlement-ui/script-windows";

type TargetOf<K extends UiTargetKind> = Extract<ResolvedUiTarget, { kind: K }>;

/** One target's thin adapter: `open` shows it or brings it to front (never toggles); `close` hides it. */
export interface UiOpener<K extends UiTargetKind = UiTargetKind> {
  close: (target: TargetOf<K>) => void;
  /** False when refused (gone building, no harbour, not on this island); the caller logs it. */
  open: (target: TargetOf<K>) => boolean;
}

export type UiTargetOpeners = { readonly [K in UiTargetKind]: UiOpener<K> };

/** The opener of a resolved target (the mapped registry indexed by a union kind). */
export const openerOf = (openers: UiTargetOpeners, target: ResolvedUiTarget) =>
  openers[target.kind] as unknown as UiOpener;

/** Windows outside the settlement UI (corner settings, menu shortcuts, inventory). */
export interface UiTargetPorts {
  inventory: { close: () => void; open: () => void };
  language: { close: () => void; open: () => void };
  settings: { close: () => void; open: (section?: SettingsSection) => void };
  /** The settlement UI's script adapter; undefined before the HUD exists (every opener then refuses). */
  windows: () => SettlementScriptWindows | undefined;
}

const always = (action: () => void) => () => {
  action();
  return true;
};

const settlementWindow = <K extends UiTargetKind>(
  ports: UiTargetPorts, window: SettlementScriptWindow
): UiOpener<K> => ({
  close: () => ports.windows()?.close(window),
  open: () => ports.windows()?.open(window) ?? false
});

const refused: UiOpener<"terrainSurvey"> = { close: () => {}, open: () => false };

/**
 * The one registry of script UI targets (trigger design §6.10): `openers[target.kind]`, each a thin adapter over
 * the feature's own open/focus function, so no feature gains visibility state (CODING-RULES §4). The terrain survey
 * window shows a chosen map point and has no point to open on, so it is refused.
 */
export const createUiTargetOpeners = (ports: UiTargetPorts): UiTargetOpeners => ({
  building: {
    close: () => ports.windows()?.closeBuildingDetails(),
    open: ({ handle }) => handle?.space === "building" && (ports.windows()?.focusBuildingDetails(handle.id) ?? false)
  },
  colonyTracker: settlementWindow(ports, "colonyTracker"),
  expeditionPlanner: settlementWindow(ports, "expeditionPlanner"),
  fleet: {
    close: () => ports.windows()?.closeMainPanel("ships"),
    open: () => ports.windows()?.focusMainPanelView("ships") ?? false
  },
  gemShop: settlementWindow(ports, "gemShop"),
  inventory: { close: ports.inventory.close, open: always(ports.inventory.open) },
  language: { close: ports.language.close, open: always(ports.language.open) },
  mainPanel: {
    close: ({ view }) => ports.windows()?.closeMainPanel(view),
    open: ({ view }) => ports.windows()?.focusMainPanelView(view) ?? false
  },
  market: settlementWindow(ports, "market"),
  messages: {
    close: () => ports.windows()?.closeMessages(),
    open: ({ mailId }) => {
      ports.windows()?.openMessages(mailId ?? null);
      return Boolean(ports.windows());
    }
  },
  overview: settlementWindow(ports, "overview"),
  quests: {
    close: () => ports.windows()?.closeQuests(),
    open: ({ questId }) => {
      ports.windows()?.openQuests(questId);
      return Boolean(ports.windows());
    }
  },
  settings: { close: ports.settings.close, open: target => always(() => ports.settings.open(target.section))() },
  talents: settlementWindow(ports, "talents"),
  terrainSurvey: refused,
  tradeOffice: settlementWindow(ports, "tradeOffice")
});
