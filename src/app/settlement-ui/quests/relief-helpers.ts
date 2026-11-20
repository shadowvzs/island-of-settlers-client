import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import type { DailyQuest } from "../../../shared/progression/daily-quests";
import type { ReliefQuestStatus } from "../../../shared/progression/relief-quests";
import { formatWareCount } from "../helpers";
import { reliefStory } from "./relief-stories";

export type ReliefQuestUiStatus = ReliefQuestStatus & { available?: number; payable?: boolean };
const STAGE_MESSAGES = {
  "awaiting-aid": msg({ id: "quest.relief.stage.awaiting", message: "Awaiting aid" }),
  "paid-awaiting-ship": msg({ id: "quest.relief.stage.paid", message: "Paid · awaiting ship" }),
  loading: msg({ id: "quest.relief.stage.loading", message: "Loading aid" }),
  departing: msg({ id: "quest.relief.stage.departing", message: "Ship departing" }),
  "ready-to-claim": msg({ id: "quest.relief.stage.ready", message: "Ready to claim" }),
  completed: msg({ id: "quest.relief.stage.completed", message: "Completed" }),
  returned: msg({ id: "quest.relief.stage.returned", message: "Aid returned" })
};
const COPY = {
  returned: msg({ id: "quest.relief.returnedHint", message: "The colony expired before the relief ship left. Your aid was returned and no reward was claimed." }),
  returnedPayment: msg({ id: "quest.relief.stage.returned", message: "Aid returned" }),
  closed: msg({ id: "quest.relief.closed", message: "Closed" }),
  claim: msg({ id: "quest.relief.claim", message: "Claim reward" }),
  pay: msg({ id: "quest.relief.pay", message: "Pay aid" }),
  payment: msg({ id: "quest.relief.payment", message: "Aid requested" }),
  paid: msg({ id: "quest.relief.paymentPaid", message: "Aid paid" }),
  loaded: msg({ id: "quest.relief.loaded", message: "Loaded: {loaded} / {amount}" }),
  wait: msg({ id: "quest.relief.wait", message: "The reward becomes available after the ship has loaded all aid and left the map." }),
  collect: msg({ id: "quest.relief.collect", message: "A neutral relief ship will collect these wares from a suitable harbour." }),
  ready: msg({ id: "quest.relief.readyHint", message: "The relief ship has left with your aid. Your reward is ready to claim." }),
  completed: msg({ id: "quest.relief.completedHint", message: "Your aid is on its way to the village. Reward claimed." }),
  hide: msg({ id: "quest.relief.hideImage", message: "Hide illustration" }),
  show: msg({ id: "quest.relief.showImage", message: "Show illustration" })
};
const BLOCKERS = {
  "Claim the completed relief rewards before sending more aid": msg({ id: "quest.relief.blocker.claimPrevious", message: "Claim the completed relief rewards before sending more aid." }),
  "This colony has expired and cannot accept a new aid payment": msg({ id: "quest.relief.blocker.expired", message: "This colony has expired and cannot accept a new aid payment." }),
  "Visit the collection island to finish its other voyages before collecting aid": msg({ id: "quest.relief.blocker.otherVoyages", message: "Visit the collection island to finish its other voyages before collecting aid." }),
  "The filed island changed outside its relief journal; visit it before collecting aid": msg({ id: "quest.relief.blocker.sourceChanged", message: "Visit the collection island once to continue collecting its aid." }),
  "The archived relief journal is invalid; paid custody is retained until its proof is repaired": msg({ id: "quest.relief.blocker.invalidJournal", message: "This collection is paused. Your paid aid remains reserved." }),
  "An overdue legacy colony shipment needs reconciliation before native relief": msg({ id: "quest.relief.blocker.legacyOverdue", message: "Visit this colony once to continue collecting its aid." }),
  "The filed colony has unjournalled historical shipments; a verified handover is required": msg({ id: "quest.relief.blocker.legacyOverdue", message: "Visit this colony once to continue collecting its aid." }),
  "The archived relief proof must be verified before more work continues": msg({ id: "quest.relief.blocker.proofWaiting", message: "Waiting for the server to verify this island’s relief shipment." }),
  "The relief collection is waiting on its owning island": msg({ id: "quest.relief.blocker.owningIsland", message: "The relief ship is waiting on the collection island." }),
  "The paid aid storage is no longer available": msg({ id: "quest.relief.blocker.storageGone", message: "The paid aid storage is no longer available" }),
  "The interrupted aid delivery is waiting for reachable wares": msg({ id: "quest.relief.blocker.interrupted", message: "The interrupted aid delivery is waiting for reachable wares" }),
  "Travel to the collection island to continue its relief ship": msg({ id: "quest.relief.blocker.travel", message: "Travel to the collection island to continue its relief ship" }),
  "No completed harbour can collect enough reachable aid wares": msg({ id: "quest.relief.blocker.noHarbour", message: "No completed harbour can collect enough reachable aid wares" }),
  "The paid collection harbour is no longer available": msg({ id: "quest.relief.blocker.harbourGone", message: "The paid collection harbour is no longer available" }),
  "The relief ship is waiting for a clear sea approach": msg({ id: "quest.relief.blocker.approach", message: "The relief ship is waiting for a clear sea approach" }),
  "Carriers are bringing the paid aid to the harbour": msg({ id: "quest.relief.blocker.carriers", message: "Carriers are bringing the paid aid to the harbour" }),
  "The relief ship is waiting for a free harbour berth": msg({ id: "quest.relief.blocker.berth", message: "The relief ship is waiting for a free harbour berth" }),
  "The loaded relief ship's departure is not confirmed": msg({ id: "quest.relief.blocker.departure", message: "The loaded relief ship's departure is not confirmed" })
} as const;
const blockerText = (text: string | undefined, i18n?: I18n) => {
  if (!text) return undefined;
  const descriptor = BLOCKERS[text as keyof typeof BLOCKERS];
  if (descriptor) return translateMessage(i18n, descriptor);
  return translateDomainText(text, i18n);
};

export const reliefQuestDetails = (
  quest: DailyQuest, status: ReliefQuestUiStatus | undefined, stored: number, i18n?: I18n
) => {
  if (!status) return undefined;
  const ready = status.stage === "ready-to-claim" && status.loaded === status.amount && status.departed;
  const awaiting = status.stage === "awaiting-aid";
  const returned = status.stage === "returned";
  const paid = !awaiting && !returned;
  const available = status.available ?? stored;
  const canPay = status.payable ?? available >= quest.amount;
  let hint = COPY.wait;
  if (awaiting) hint = COPY.collect;
  if (status.stage === "ready-to-claim") hint = COPY.ready;
  if (status.stage === "completed") hint = COPY.completed;
  if (returned) hint = COPY.returned;
  let action = COPY.claim;
  if (awaiting) action = COPY.pay;
  if (returned) action = COPY.closed;
  let payment = COPY.payment;
  if (paid) payment = COPY.paid;
  if (returned) payment = COPY.returnedPayment;
  return {
    ...reliefStory(quest, i18n),
    amount: quest.amount,
    blocker: blockerText(status.blocker, i18n),
    claimDisabled: !ready && !(awaiting && canPay),
    claimLabel: translateMessage(i18n, action),
    hint: translateMessage(i18n, hint),
    hideImage: translateMessage(i18n, COPY.hide),
    loaded: translateMessage(i18n, COPY.loaded, { amount: status.amount, loaded: status.loaded }),
    paymentLabel: translateMessage(i18n, payment),
    paymentText: formatWareCount(quest.amount, quest.ware),
    showImage: translateMessage(i18n, COPY.show),
    stage: status.stage,
    stageLabel: translateMessage(i18n, STAGE_MESSAGES[status.stage]),
    ware: quest.ware
  };
};
export type ReliefQuestDetails = NonNullable<ReturnType<typeof reliefQuestDetails>>;
