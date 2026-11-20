import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { ReadableStore } from "../components/ui-store";
import type { CloudSaveStatus } from "../save-store/remote-save-store";
import type { SaveCoordinator } from "../save-store/save-coordinator";
import type { SaveStatusStore } from "../save-store/save-status";
import {
  createSessionLifecycle, type SessionLifecycle, SessionTransitionCancelled
} from "../session-lifecycle";
import type { SettlementPopupContent } from "../settlement-ui/settlement-popup";
import type { CloudSession } from "./cloud-boot";
import { CLOUD_MESSAGES } from "./messages";
import { createLevelReclaimer, type VerificationState } from "./verification-status";

type MountStatus = (viewport: HTMLElement, status: ReadableStore<CloudSaveStatus | null>,
  verification: ReadableStore<VerificationState | null>, onOpen: () => void) => Promise<() => void>;

/** The status line loads with its own small chunk. */
const mountStatusLazily: MountStatus = async (viewport, status, verification, onOpen) =>
  (await import("./mount-cloud-status")).mountCloudStatus(viewport, status, verification, onOpen);

interface CloudUiOptions {
  cloud: CloudSession;
  /** Active interface language; absent keeps the English source copy (tests and tool runs). */
  i18n?: I18n;
  /** Leaves for the start scroll (the tab keeps nothing of this session). */
  leave: () => void;
  /** The status line's mount (its React chunk by default). */
  mountStatus?: MountStatus;
  /** Where the tab closing is heard (the window by default). */
  page?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** The signed-in player's local level and server claim: rewards are re-claimed after the save verifies. */
  player?: { claimServerLevel: () => void; level: () => number };
  /** Starts this slot again from the server (a page reload); a same-slot handoff keeps the lease. */
  reload: () => void;
  /** Account or slot exit: ends the lease explicitly instead of relying only on `pagehide`. */
  releaseSession?: () => Promise<void>;
  /** The menu's save line shows the cloud state too. */
  saveStatus: Pick<SaveStatusStore, "getSnapshot" | "set">;
  saving: Pick<SaveCoordinator, "flush" | "request" | "stop">;
  /** Settles accepted saves/uploads without a stale flush before a newer save is adopted. */
  settle?: () => Promise<void>;
  showPopup: (content: SettlementPopupContent) => void;
  /** The page's one session transition guard; a same-slot load still freezes and settles first. */
  transition?: SessionLifecycle;
  viewport: HTMLElement;
}

/**
 * The signed-in player's cloud save in play: the status line, the conflict question (load the newer save, or
 * keep playing here and overwrite), the taken-over question (take the session back, or leave), the lease
 * released when the tab closes, and an upload soon after restoring an unsent local save.
 */
export const bindCloudSession = ({
  cloud, i18n, leave, mountStatus = mountStatusLazily, page = window, player, releaseSession, reload, saveStatus,
  saving, settle, showPopup, transition, viewport
}: CloudUiOptions) => {
  const t = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  const transitions = transition ?? createSessionLifecycle();
  let disposed = false;
  /** A claim capped by the verified save: only then can a later verified revision pay another level. */
  let levelClaimPending = false;
  const reclaimer = player ? createLevelReclaimer({
    claimLevel: () => { if (!disposed && levelClaimPending) player.claimServerLevel(); },
    level: player.level, status: cloud.verification
  }) : null;
  // Read the verified revision before the boot claim, so a verification that lands just after it is seen as new.
  void (reclaimer ? reclaimer.boot() : Promise.resolve(null)).catch(() => undefined)
    .finally(() => { if (!disposed) player?.claimServerLevel(); });
  const unsubscribeClaim = cloud.economy.onLevelClaim(claim => {
    levelClaimPending = claim.verifiedLevel < claim.claimedLevel;
    if (reclaimer) void reclaimer.afterUpload();
  });
  const loadNewer = async () => {
    const result = await transitions.run({
      key: "load-newer",
      run: async token => {
        // Discard-before-newer-load: settle accepted writes, never flush the old branch over the server.
        await settle?.();
        if (!token.current()) throw new SessionTransitionCancelled();
        await cloud.discardUnsent();
        if (!token.current()) throw new SessionTransitionCancelled();
        saving.stop();
        reload();
      }
    });
    if (result.ok) return;
    showPopup({ actions: [{ label: t(CLOUD_MESSAGES.actions.ok), onSelect: () => undefined }],
      message: t(result.reason === "busy" ? CLOUD_MESSAGES.messages.busy : CLOUD_MESSAGES.messages.newerFailed),
      title: t(CLOUD_MESSAGES.conflictTitle) });
  };
  const takeBack = async () => {
    if (await cloud.lease.acquire(true) !== "acquired") return;
    cloud.lost.set(false);
    cloud.store.resume();
    await saving.flush("manual");
  };
  /** Leaving a taken-over session is a slot exit, not a same-slot travel handoff. */
  const exitSlot = async () => {
    saving.stop();
    await releaseSession?.().catch(() => undefined);
    leave();
  };
  const conflict: SettlementPopupContent = {
    actions: [
      { label: t(CLOUD_MESSAGES.actions.loadNewer), onSelect: () => void loadNewer(), primary: true },
      { label: t(CLOUD_MESSAGES.actions.keepAndOverwrite),
        onSelect: () => void cloud.store.overwrite().catch(() => undefined) }
    ],
    message: t(CLOUD_MESSAGES.conflictMessage),
    title: t(CLOUD_MESSAGES.conflictTitle),
    tone: "question"
  };
  const takenOver: SettlementPopupContent = {
    actions: [
      { label: t(CLOUD_MESSAGES.actions.takeBack), onSelect: () => void takeBack(), primary: true },
      { label: t(CLOUD_MESSAGES.actions.leave), onSelect: () => void exitSlot() }
    ],
    message: t(CLOUD_MESSAGES.takenOverMessage),
    title: t(CLOUD_MESSAGES.takeOverTitle),
    tone: "question"
  };
  const openQuestion = () => {
    if (disposed) return;
    const kind = cloud.status.getSnapshot()?.kind;
    if (kind === "conflict") showPopup(conflict);
    if (kind === "taken-over" || cloud.lost.getSnapshot()) showPopup(takenOver);
  };
  const unsubscribeStatus = cloud.status.subscribe(() => {
    saveStatus.set({ ...saveStatus.getSnapshot(), cloud: cloud.status.getSnapshot() });
    if (cloud.status.getSnapshot()?.kind === "saved" && reclaimer) void reclaimer.afterUpload();
    openQuestion();
  });
  const unsubscribeLost = cloud.lost.subscribe(() => {
    if (cloud.lost.getSnapshot()) cloud.status.set({ kind: "taken-over" });
  });
  const release = (event?: PageTransitionEvent) => {
    // Back/forward-cache keeps the page and its session: `pageshow.persisted` resumes it in place.
    if (event?.persisted) return;
    cloud.markHandoff();
    void cloud.lease.release(true).catch(() => undefined);
  };
  page.addEventListener("pagehide", release);
  const unmount = mountStatus(viewport, cloud.status, cloud.verification.status, openQuestion);
  if (cloud.restored) saving.request();
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeClaim();
    unsubscribeStatus();
    unsubscribeLost();
    page.removeEventListener("pagehide", release);
    void unmount.then(run => run());
  };
};
