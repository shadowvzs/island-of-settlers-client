import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { landingAfterRun, type RunLanding } from "../../shared/campaign/run-landing";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SimRules } from "../../shared/settlement/sim-rules";
import type { LoadedMap } from "../../shared/world/save/map-reader";
import { browserSessionRules } from "../game-settings/browser-session-rules";
import { playsWithoutHome } from "../game-settings/session-mode";
import type { CampaignAttemptStarter } from "../settlement/campaign-run-start";
import type { CampaignWindowPortOptions } from "../settlement/campaign-window-port";
import type { CampaignChoice, CampaignWindowPort } from "../settlement-ui/campaign-window/types";
import { NO_CAMPAIGN_START } from "./constants";
import {
  choiceStatuses, parseTitleLanding, progressBeforeRun, type TitleLandingRecord, titlePlayerLevel
} from "./helpers";
import { createTitleCampaignPort } from "./title-campaign-port";
import { createTitleSlots, type TitleSlotsOptions } from "./title-slots";

/** The working slot as the title page sees it (a browser slot, or a signed-in cloud slot). */
export interface TitleSlot {
  hasSavedGame(): Promise<boolean>;
  /** A signed-in cloud slot that stores a home island game (owner Q4: untouched while there is no home). */
  holdsHomeGame?(): boolean;
  readStoryProgress?(): Promise<PlayerProgress | null>;
  writeSavedGame(save: GameSaveV1): Promise<void>;
}

/** A signed-in cloud slot without a home (ONLINE-STORY): the lease's rules and the server's attempts. */
export interface TitleServer {
  /** The lease-granted rules; a run starts only when they have no home island. */
  rules: SimRules | undefined;
  startAttempt?: CampaignAttemptStarter;
}

export interface TitleSessionOptions {
  /** The stored landing record of a run that just ended (session value), or null. */
  landingJson: string | null;
  nation: WorkerNation;
  /** Real UTC time (ms). */
  now(): number;
  /** Signed in: the server keeps the campaign progress and attempts; absent for browser slots. */
  server?: TitleServer;
  settings: GameSettings | null;
  slot: TitleSlot;
  /** Save/Load slots of the session (SAVE-SLOTS); absent while slots are off. */
  slots?: TitleSlotsOptions;
  /** Signed in, `economy` answers the server's campaign progress (the browser progress otherwise). */
  sources: Pick<CampaignWindowPortOptions, "economy" | "now" | "openRepositories" | "readMap">;
}

const choiceOf = (choices: readonly CampaignChoice[], campaignId: string) =>
  choices.find(choice => choice.campaign.id === campaignId);

/** The rules a run starts under: the lease's when signed in, else the browser's session rules (GS3a). */
const runRulesOf = ({ server, settings }: Pick<TitleSessionOptions, "server" | "settings">) =>
  server ? server.rules : browserSessionRules(settings, false);

/**
 * The title page's session (GS3b, plan §7.4, §7.5): reads the slot once, owns the campaign port and the run start
 * without a home, works out the landing of a run that just ended, and resolves `done` when the page may boot the
 * game (Continue, Load, New game, or a run written to the working slot). No world exists while it runs.
 */
export const createTitleSession = async (options: TitleSessionOptions) => {
  const { settings, slot } = options;
  const [hasSavedGame, progress] = await Promise.all([
    slot.hasSavedGame().catch(() => false), slot.readStoryProgress?.().catch(() => null) ?? null
  ]);
  let finish: () => void = () => undefined;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const slots = await createTitleSlots(options.slots, { finish: () => finish(), home: !playsWithoutHome(settings) });
  /** New game asks first when it would replace a game or reset story progress (plan §5.6). */
  const newGameAsks = hasSavedGame || progress !== null;
  const startRun = async (map: CampaignMap, loaded: LoadedMap): Promise<true | string> => {
    const rules = runRulesOf(options);
    if (!rules || rules.homeIsland) return NO_CAMPAIGN_START;
    // The run start reaches the headless simulation: it loads only when a run starts, not with the title page.
    const { startServerAttempt } = await import("../settlement/campaign-run-start");
    const attempt = await startServerAttempt(options.server?.startAttempt, map);
    if (typeof attempt === "string") return attempt;
    const { buildHomelessRunGame } = await import("../settlement/campaign-homeless-run");
    const save = await buildHomelessRunGame({
      attempt, loaded, map, nation: options.nation, now: options.now(), player: progress ?? undefined, rules
    });
    await slot.writeSavedGame(save);
    finish();
    return true;
  };
  /** The landing's "before" view reads the slot's progress before the run, never the server's current one. */
  const portFor = (record: TitleLandingRecord | null): CampaignWindowPort | null => {
    if (!settings || !playsWithoutHome(settings)) return null;
    const current = progress?.campaignProgress;
    const sources = record ? { ...options.sources, economy: undefined } : options.sources;
    return createTitleCampaignPort({
      campaignProgress: record ? progressBeforeRun(record, current) : current,
      playerLevel: titlePlayerLevel(settings, progress), settings, sources, start: startRun
    });
  };
  const port = portFor(null);
  const record = parseTitleLanding(options.landingJson);
  /** The landing of the run that just ended (plan §7.6), or null when none is pending. */
  const landing = async (): Promise<RunLanding | null> => {
    const before = portFor(record);
    if (!record || !settings || !port || !before) return null;
    const [beforeChoices, afterChoices] = await Promise.all([before.load(), port.load()]);
    return landingAfterRun(settings, record, choiceStatuses(choiceOf(beforeChoices, record.campaignId)),
      choiceStatuses(choiceOf(afterChoices, record.campaignId)));
  };
  /** The landing dialog's Next map: starts the one newly available map. */
  const startMap = async (campaignId: string, mapId: string): Promise<true | string> => {
    if (!port) return NO_CAMPAIGN_START;
    const entry = choiceOf(await port.load(), campaignId)?.maps.find(choice => choice.map.id === mapId);
    return entry ? port.start(entry.map) : NO_CAMPAIGN_START;
  };
  return {
    continueGame: slots.continueGame, done, finish, hasSavedGame, hasStoryProgress: progress !== null,
    home: !playsWithoutHome(settings), landing,
    newGame: slots.newGame, newGameAsks, port, slotControls: slots.controls, slotFacts: slots.facts,
    slotHoldsHome: slot.holdsHomeGame?.() ?? false, startMap
  };
};

export type TitleSession = Awaited<ReturnType<typeof createTitleSession>>;
