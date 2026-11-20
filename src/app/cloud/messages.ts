import { msg } from "@lingui/core/macro";

/** Stable cloud-save status, slot and session-takeover chrome. Server error bodies stay untranslated. */
export const CLOUD_MESSAGES = {
  actions: {
    continueLocal: msg({ id: "cloud.actions.continueLocal", message: "Continue the local save" }),
    keepAndOverwrite: msg({
      id: "cloud.actions.keepAndOverwrite",
      message: "Keep playing here and overwrite"
    }),
    keepPlayingOffline: msg({
      id: "cloud.actions.keepPlayingOffline",
      message: "Keep playing offline as guest"
    }),
    leave: msg({ id: "cloud.actions.leave", message: "Leave" }),
    loadNewer: msg({ id: "cloud.actions.loadNewer", message: "Load the newer save" }),
    loadOnline: msg({ id: "cloud.actions.loadOnline", message: "Load the online save" }),
    ok: msg({ id: "cloud.actions.ok", message: "OK" }),
    playAsGuest: msg({ id: "cloud.actions.playAsGuest", message: "Play as guest" }),
    playAsGuestInstead: msg({
      id: "cloud.actions.playAsGuestInstead",
      message: "Play as guest instead"
    }),
    takeBack: msg({ id: "cloud.actions.takeBack", message: "Take the session back" }),
    takeOverHere: msg({ id: "cloud.actions.takeOverHere", message: "Take over here" }),
    tryAgain: msg({ id: "cloud.actions.tryAgain", message: "Try again" })
  },
  cloudFailedLead: msg({
    id: "cloud.cloudFailedLead",
    message: "{reason} Try again, or play as guest: a guest plays in this browser and uploads nothing."
  }),
  cloudFailedTitle: msg({
    id: "cloud.cloudFailedTitle",
    message: "The online save could not be opened"
  }),
  conflictMessage: msg({
    id: "cloud.conflictMessage",
    message: "Another device saved this slot after you loaded it. Load the newer save, or keep playing here and overwrite it with this game."
  }),
  conflictTitle: msg({
    id: "cloud.conflictTitle",
    message: "This save changed on another device"
  }),
  messages: {
    busy: msg({
      id: "cloud.messages.busy",
      message: "Another island change is under way. Try again in a moment."
    }),
    newerFailed: msg({
      id: "cloud.messages.newerFailed",
      message: "The newer save could not be opened. Try again, or keep playing here."
    }),
    slotCreatedElsewhere: msg({
      id: "cloud.messages.slotCreatedElsewhere",
      message: "This slot was just created elsewhere."
    })
  },
  queueNote: msg({
    id: "cloud.queueNote",
    message: "Your place is kept while this page waits; it tries again every 15 seconds."
  }),
  restoreLead: msg({
    id: "cloud.restoreLead",
    message: "This browser kept a save from {localTime} that never reached the server. {serverState} Continue the newer local save (it uploads now), or load the online one?"
  }),
  restoreServerEmpty: msg({
    id: "cloud.restoreServerEmpty",
    message: "The slot online is still empty."
  }),
  restoreServerSaved: msg({
    id: "cloud.restoreServerSaved",
    message: "The slot online was saved {serverTime}."
  }),
  restoreTitle: msg({ id: "cloud.restoreTitle", message: "Unsent progress found" }),
  serverFullLead: msg({
    id: "cloud.serverFullLead",
    message: "Server is full ({active}/{capacity}), you are #{position} in the queue."
  }),
  serverFullTitle: msg({ id: "cloud.serverFullTitle", message: "Server is full" }),
  slotDefaultName: msg({ id: "cloud.slotDefaultName", message: "Slot {slotNo}" }),
  slotEmpty: msg({
    id: "cloud.slotEmpty",
    message: "Slot {slotNo}: empty, start a new island"
  }),
  slotNamed: msg({ id: "cloud.slotNamed", message: "Slot {slotNo}: {name}" }),
  slotNoIsland: msg({ id: "cloud.slotNoIsland", message: "Slot {slotNo}: {name} (no island yet)" }),
  slotsLead: msg({
    id: "cloud.slotsLead",
    message: "Welcome, {displayName}. Each account has three save slots; pick one to continue or start a new island."
  }),
  slotsTitle: msg({ id: "cloud.slotsTitle", message: "Choose a save slot" }),
  status: {
    conflict: msg({ id: "cloud.status.conflict", message: "Not saved online: changed elsewhere" }),
    failed: msg({ id: "cloud.status.failed", message: "Not saved online: kept in this browser" }),
    offline: msg({
      id: "cloud.status.offline",
      message: "Offline: saved in this browser, retrying"
    }),
    offlineRetry: msg({
      id: "cloud.status.offlineRetry",
      message: "Offline: saved in this browser, retrying in {seconds} s"
    }),
    saved: msg({ id: "cloud.status.saved", message: "Saved online" }),
    saving: msg({ id: "cloud.status.saving", message: "Saving online…" }),
    takenOver: msg({ id: "cloud.status.takenOver", message: "Not saved online: playing elsewhere" }),
    withVerification: msg({ id: "cloud.status.withVerification", message: "{save} · {verification}" })
  },
  takenOverMessage: msg({
    id: "cloud.takenOverMessage",
    message: "This account is now playing on another device, so this one stopped saving online. Your progress here is kept in this browser."
  }),
  takeOverLead: msg({
    id: "cloud.takeOverLead",
    message: "This account is playing on another device or tab right now. Take the session over here? The other one stops saving."
  }),
  takeOverTitle: msg({ id: "cloud.takeOverTitle", message: "Playing on another device" }),
  verification: {
    flagged: msg({ id: "cloud.verification.flagged", message: "verification flagged" }),
    notVerified: msg({ id: "cloud.verification.notVerified", message: "not verified" }),
    pending: msg({ id: "cloud.verification.pending", message: "verification pending" }),
    verified: msg({ id: "cloud.verification.verified", message: "verified" })
  }
} as const;
