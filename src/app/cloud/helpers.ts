import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { CloudSaveStatus } from "../save-store/remote-save-store";
import type { SaveSlot, ServerFull } from "../save-store/save-api-client";
import { CLOUD_MESSAGES } from "./messages";
import type { VerificationState } from "./verification-status";

export const SLOT_NUMBERS = [1, 2, 3] as const;

export const getCloudFailedLead = (reason: string, i18n?: I18n) =>
  translateMessage(i18n, CLOUD_MESSAGES.cloudFailedLead, { reason });

export const QUEUE_RETRY_MS = 15_000;

export const getServerFullLead = ({ active, capacity, position }: ServerFull, i18n?: I18n) =>
  translateMessage(i18n, CLOUD_MESSAGES.serverFullLead, { active, capacity, position });

export const getSlotsLead = (displayName: string, i18n?: I18n) =>
  translateMessage(i18n, CLOUD_MESSAGES.slotsLead, { displayName });

export const describeSlot = (slotNo: number, slot: SaveSlot | undefined, i18n?: I18n) => {
  if (!slot) return translateMessage(i18n, CLOUD_MESSAGES.slotEmpty, { slotNo });
  if (slot.revision === 0) return translateMessage(i18n, CLOUD_MESSAGES.slotNoIsland, { name: slot.name, slotNo });
  return translateMessage(i18n, CLOUD_MESSAGES.slotNamed, { name: slot.name, slotNo });
};

const formatTime = (time: number, i18n?: I18n) => new Date(time).toLocaleString(i18n?.locale);

export const getRestoreLead = (localSavedAt: number, serverSavedAt: number | null, i18n?: I18n) => {
  const serverState = serverSavedAt === null
    ? translateMessage(i18n, CLOUD_MESSAGES.restoreServerEmpty)
    : translateMessage(i18n, CLOUD_MESSAGES.restoreServerSaved, {
      serverTime: formatTime(serverSavedAt, i18n)
    });
  return translateMessage(i18n, CLOUD_MESSAGES.restoreLead, {
    localTime: formatTime(localSavedAt, i18n), serverState
  });
};

const STATUS_MESSAGES = {
  conflict: CLOUD_MESSAGES.status.conflict,
  failed: CLOUD_MESSAGES.status.failed,
  offline: CLOUD_MESSAGES.status.offline,
  saved: CLOUD_MESSAGES.status.saved,
  saving: CLOUD_MESSAGES.status.saving,
  "taken-over": CLOUD_MESSAGES.status.takenOver
} as const;

/** The status line of the cloud save indicator, and whether it warns. */
export const getCloudStatusView = (status: CloudSaveStatus | null, now: number, i18n?: I18n) => {
  if (!status) return null;
  const seconds = status.kind === "offline"
    ? Math.max(1, Math.ceil((status.retryAt - now) / 1000)) : 0;
  const text = seconds
    ? translateMessage(i18n, CLOUD_MESSAGES.status.offlineRetry, { seconds })
    : translateMessage(i18n, STATUS_MESSAGES[status.kind]);
  return { text, warning: status.kind !== "saved" && status.kind !== "saving" };
};

/** The verification hint beside the save line: the server's newest verified revision, its flag and pending state. */
export const getVerificationView = (state: VerificationState | null, i18n?: I18n) => {
  if (!state || state.revision === null || state.revision === 0) return null;
  if (state.flag) return { text: translateMessage(i18n, CLOUD_MESSAGES.verification.flagged) };
  if (state.verifiedRevision === null)
    return { text: translateMessage(i18n, CLOUD_MESSAGES.verification.notVerified) };
  if (state.pending) return { text: translateMessage(i18n, CLOUD_MESSAGES.verification.pending) };
  return { text: translateMessage(i18n, CLOUD_MESSAGES.verification.verified) };
};
