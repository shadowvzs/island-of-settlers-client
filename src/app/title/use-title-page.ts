import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useState } from "react";

import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { RunLanding } from "../../shared/campaign/run-landing";
import { translateDomainText } from "../../shared/i18n/domain";
import type { CampaignWindowPort } from "../settlement-ui/campaign-window/types";
import { TITLE_ENTRY_ICONS, TITLE_ENTRY_LABELS as ENTRY_LABELS, TITLE_LANDING_ICONS } from "./constants";
import {
  isTitleAdminEntry, titleAdminActions, type TitleEntryId, type TitleEntryState, type TitleMode
} from "./helpers";
import { TITLE_MESSAGES as M } from "./messages";
import type { TitleSession } from "./title-session";
import { useTitleSlots } from "./use-title-slots";

/** What the page shows in its panel. */
type TitleView = "campaigns" | "menu" | "settings" | "slots";
type ExitChoice = Extract<RunLanding, { kind: "exitChoice" }>;

interface TitlePageState {
  entries: readonly TitleEntryState[];
  /** The mode line in the lower left corner (`titleModeLabel`). */
  modeLabel: TitleMode;
  session: TitleSession;
}

export interface TitleAction {
  icon: string;
  id: string;
  label: string;
  onClick: () => void;
}

interface LandingHandlers {
  onChoose: (campaignId: string) => void;
  onClose: () => void;
  onNext: (campaignId: string, mapId: string) => void;
}

/**
 * The "after a map" dialog's choices (plan §7.6): Next map only for exactly one newly available map, Choose your
 * path on a fork, then Campaign selection and Exit game (already on the title page: the dialog closes).
 */
const landingActions = (
  landing: ExitChoice | null, translate: (message: typeof M.continue) => string, handlers: LandingHandlers
): TitleAction[] => {
  if (!landing) return [];
  const { campaignId, forked, nextMapId } = landing;
  const action = (id: keyof typeof TITLE_LANDING_ICONS, onClick: () => void): TitleAction =>
    ({ icon: TITLE_LANDING_ICONS[id], id, label: translate(M.landing[id]), onClick });
  return [
    ...nextMapId ? [action("nextMap", () => handlers.onNext(campaignId, nextMapId))] : [],
    ...forked ? [action("choosePath", () => handlers.onChoose(campaignId))] : [],
    action("campaignSelection", () => handlers.onChoose(campaignId)),
    action("exit", handlers.onClose)
  ];
};

/** The shown landing: the dialog after a won map, or the selection opened on the campaign (plan §7.6). */
const useLanding = (session: TitleSession, openCampaigns: (campaignId: string) => void) => {
  const [exitChoice, setExitChoice] = useState<ExitChoice | null>(null);
  useEffect(() => {
    let current = true;
    void session.landing().then(landing => {
      if (!current || !landing || landing.kind === "home") return;
      if (landing.kind === "selection") openCampaigns(landing.campaignId);
      else setExitChoice(landing);
    }, () => undefined);
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page
  }, [session]);
  return { exitChoice, setExitChoice };
};

/** Starting a map over a run on screen asks first (plan §7.4 step 3); the answer starts or keeps it. */
const useAbandonGuard = (session: TitleSession) => {
  const [pending, setPending] = useState<CampaignMap | null>(null);
  const port = useMemo((): CampaignWindowPort | null => {
    const base = session.port;
    if (!base || !session.hasSavedGame) return base;
    return { ...base, start: async map => { setPending(map); return ""; } };
  }, [session]);
  return { pending, port, setPending };
};

/**
 * The title page's state (GS3b): which panel shows, the landing dialog, the abandon question and the busy line of
 * a starting map. The session owns every rule; the page only forwards the player's choices.
 */
export const useTitlePage = ({ entries, modeLabel, session }: TitlePageState) => {
  const { i18n } = useLingui();
  const [view, setView] = useState<TitleView>("menu");
  const [campaignId, setCampaignId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const openCampaigns = (id?: string) => { setCampaignId(id); setView("campaigns"); };
  const landing = useLanding(session, openCampaigns);
  const abandon = useAbandonGuard(session);
  const run = async (start: () => Promise<true | string>) => {
    setBusy(true);
    const result = await start().catch(() => "");
    setBusy(false);
    if (result !== true) setStatus(translateDomainText(result, i18n));
  };
  const slots = useTitleSlots(session, () => setView("slots"));
  const actions: Record<TitleEntryId, () => void> = {
    campaigns: () => openCampaigns(),
    continue: slots.onContinue,
    load: slots.onLoad,
    multiplayer: () => undefined,
    newGame: slots.onNewGame,
    settings: () => setView("settings"),
    ...titleAdminActions(location)
  };
  const menuEntries = entries.map(entry => ({
    disabled: entry.disabled,
    icon: TITLE_ENTRY_ICONS[entry.id],
    id: entry.id,
    label: i18n._(ENTRY_LABELS[entry.id]),
    title: entry.reason ? i18n._(M[entry.reason]) : i18n._(ENTRY_LABELS[entry.id]),
    onClick: actions[entry.id]
  }));
  const confirmAbandon = () => {
    const map = abandon.pending;
    if (!map) return;
    void run(() => session.port?.start(map) ?? Promise.resolve("")).then(() => abandon.setPending(null));
  };
  return {
    abandonActions: [
      { icon: "apply", id: "abandon", label: i18n._(M.abandon.confirm), onClick: confirmAbandon },
      { icon: "cancel", id: "cancel", label: i18n._(M.cancel), onClick: () => abandon.setPending(null) }
    ] satisfies TitleAction[],
    abandonOpen: abandon.pending !== null,
    backShown: view !== "menu",
    busy: busy || slots.slotBusy,
    campaignId,
    campaignPort: abandon.port,
    adminEntries: menuEntries.filter(entry => isTitleAdminEntry(entry.id)),
    entries: menuEntries.filter(entry => !isTitleAdminEntry(entry.id)),
    landingActions: landingActions(landing.exitChoice, message => i18n._(message), {
      onChoose: id => { landing.setExitChoice(null); openCampaigns(id); },
      onClose: () => landing.setExitChoice(null),
      onNext: (id, mapId) => { void run(() => session.startMap(id, mapId)); }
    }),
    modeText: i18n._(M.mode[modeLabel]),
    newGameActions: slots.newGameActions,
    newGameOpen: slots.newGameOpen,
    slotControls: session.slotControls,
    status: status || slots.slotStatus,
    text: {
      abandonQuestion: i18n._(M.abandon.question),
      back: i18n._(M.back),
      heading: i18n._(M.heading),
      landing: i18n._(M.landing.heading),
      menu: i18n._(M.menu),
      newGameQuestion: slots.newGameQuestion
    },
    view,
    onBack: () => setView("menu")
  };
};

export type TitlePageModel = ReturnType<typeof useTitlePage>;
