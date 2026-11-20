import type { I18n } from "@lingui/core";

import type {
  ScriptMailEffect, ScriptUiEffect
} from "../../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import { createScriptMail } from "../../../shared/progression/inbox-mails";
import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import { HUMAN_FACTION } from "../../../shared/world/scenario-players";
import type { AudioUploadLookup } from "../../audio/audio-refs";
import { createIslandScriptAudio } from "../../audio/island-script-audio";
import { regionCenter } from "../../campaign/cinematics/helpers";
import { isHudScopeHidden } from "../../hud-scope/hud-scope";
import type { SettlementPopupContent } from "../../settlement-ui/settlement-popup";
import { publishMultiboards } from "../multiboard/multiboard-store";
import {
  colonyLostPopup, createColonyNoticeStorage, lostColonies, rememberColonies, type SeenColony
} from "./colony-lost-notice";
import { COLONY_SEEN_SYNC_TICKS, SCRIPT_UI_LOG, WAITING_SYNC_TICKS } from "./constants";
import { mountHighlightLayer } from "./highlight-layer";
import { createHighlightStore } from "./highlight-store";
import { createScriptPresentation } from "./script-presentation";
import { clickedUiAnchor } from "./ui-anchors";
import { createUiTargetOpeners, type UiTargetPorts } from "./ui-targets";

type ScriptUiSimulation = Pick<SettlementSimulation, "buildings" | "observeTicks" | "script" |
  "scriptSnapshot" | "scriptUiAck" | "scriptWaitingHighlights" | "takeScriptUiEffects">;

export interface IslandScriptUiOptions extends Omit<UiTargetPorts, "windows"> {
  /** Audio uploaded with the played map (`world.audioAssets`); absent: only catalog audio plays. */
  audioUploads?: AudioUploadLookup;
  camera: { centerX: number; centerZ: number };
  /** Conquered colonies on screen now (the colony-lost notice); absent without an archipelago. */
  colonies?: () => readonly SeenColony[];
  deliverMails: (mails: ReturnType<typeof createScriptMail>[]) => void;
  homeSeed: number;
  i18n?: I18n;
  /** The island a mail is sent from ("" on the home island). */
  islandName: () => string;
  showPopup: (content: SettlementPopupContent) => void;
  simulation: ScriptUiSimulation;
  windows: UiTargetPorts["windows"];
}

/** Camera focus: a building or unit handle, else a region's centre (the non-cinematic "Show me" jump). */
const focusCameraOn = (
  options: IslandScriptUiOptions, effect: Extract<ScriptUiEffect, { kind: "focusCamera" }>
) => {
  const { camera, simulation } = options;
  const building = effect.actor?.space === "building"
    ? simulation.buildings().find(entry => entry.uid === effect.actor!.id) : undefined;
  const region = effect.region ? simulation.scriptSnapshot()?.script.regions.find(entry => entry.id === effect.region)
    : undefined;
  const point = building ?? (region && regionCenter(region, () => 0));
  if (!point) return;
  camera.centerX = point.x;
  camera.centerZ = point.z;
};

/** Login check for colonies the server dropped silently; then keeps the remembered list current. */
const createColonyNotices = (options: IslandScriptUiOptions) => {
  const colonies = options.colonies;
  if (!colonies) return () => {};
  const storage = createColonyNoticeStorage(options.homeSeed);
  let memory = storage.read();
  const current = colonies();
  const lost = lostColonies(memory, current);
  if (lost.length) options.showPopup(colonyLostPopup(lost, options.i18n));
  memory = rememberColonies(memory, current, lost);
  storage.write(memory);
  return () => {
    memory = rememberColonies(memory, colonies(), []);
    storage.write(memory);
  };
};

/**
 * The island's map-script presentation (TRG9): drains the engine outbox after each tick into the UI target
 * registry and the highlight overlay, re-derives waiting highlights and publishes multiboards at the 0.5 s UI
 * cadence, records `scriptUiAck` when the player clicks a highlighted control, and shows the colony-lost notice.
 */
export const createIslandScriptUi = (options: IslandScriptUiOptions) => {
  const { simulation } = options;
  const highlights = createHighlightStore();
  const log = (line: string) => console.info(SCRIPT_UI_LOG, line);
  const audio = createIslandScriptAudio(options.audioUploads, log);
  const presentation = createScriptPresentation({
    acknowledge: effectId => simulation.scriptUiAck(effectId),
    deliverMail: (mail: ScriptMailEffect) => options.deliverMails([createScriptMail(mail, options.islandName())]),
    focusCamera: effect => focusCameraOn(options, effect),
    highlights,
    hudHidden: () => isHudScopeHidden(),
    log,
    now: () => performance.now(),
    openers: createUiTargetOpeners(options),
    playAudio: audio.apply
  });
  const host = document.createElement("div");
  host.className = "script-highlight-host";
  document.body.append(host);
  const unmount = mountHighlightLayer(host, highlights);
  const syncColonies = createColonyNotices(options);
  let ticks = 0;
  const publish = () => {
    const engine = simulation.script()?.engine;
    presentation.syncWaiting(simulation.scriptWaitingHighlights());
    publishMultiboards(engine?.multiboardSnapshots(HUMAN_FACTION) ?? [], engine?.script.scriptUid ?? "");
  };
  const stopTicks = simulation.observeTicks(() => {
    ticks += 1;
    presentation.receive(simulation.takeScriptUiEffects());
    presentation.update();
    if (ticks % WAITING_SYNC_TICKS === 0) publish();
    if (ticks % COLONY_SEEN_SYNC_TICKS === 0) syncColonies();
  });
  const onClick = (event: MouseEvent) => {
    if (highlights.list().length === 0) return;
    const anchor = clickedUiAnchor(event.target);
    if (anchor) presentation.click(anchor);
  };
  document.addEventListener("click", onClick, { capture: true });
  publish();
  // Review hook (dev builds only): drive effects and the notice without a map script (captures, TRG9 review).
  if (import.meta.env.DEV) (window as Window & { __scriptUi?: unknown }).__scriptUi = {
    highlights, presentation, showColonyLost: (lost: SeenColony[]) => options.showPopup(colonyLostPopup(lost,
      options.i18n))
  };
  return {
    highlights,
    presentation,
    dispose: () => {
      stopTicks();
      document.removeEventListener("click", onClick, { capture: true });
      syncColonies();
      audio.dispose();
      publishMultiboards([], "");
      unmount();
      host.remove();
    }
  };
};

export type IslandScriptUi = ReturnType<typeof createIslandScriptUi>;
