import { msg } from "@lingui/core/macro";

/**
 * Texts of the generated colony and adventure quest books (trigger design §8.1, lane TRG10). The books carry the
 * English source and these ids as `translationKey`s (shared `ARCHIPELAGO_TEXT_KEYS` / `ARCHIPELAGO_TEXTS_EN`; a test
 * keeps both in step); the descriptors exist so the catalogs hold the translations. `{island}` is the island name.
 */
export const ARCHIPELAGO_BOOK_MESSAGES = {
  adventureWinText: msg({
    id: "quest.adventure.win.text",
    message: "Defeat every enemy on the island before your landing party is lost."
  }),
  adventureWinTitle: msg({ id: "quest.adventure.win.title", message: "Win the adventure" }),
  colonyCancelled: msg({
    id: "notice.colony.cancelled", message: "{island} was disbanded. Its garrison sailed home."
  }),
  colonyConquerCaptureText: msg({
    id: "quest.colony.conquer.captureText", message: "Capture every enemy camp on the island."
  }),
  colonyConquerDefeatText: msg({
    id: "quest.colony.conquer.defeatText", message: "Defeat every enemy on the island."
  }),
  colonyConquerTitle: msg({ id: "quest.colony.conquer.title", message: "Conquer the island" }),
  colonyDefeated: msg({
    id: "notice.colony.defeated", message: "{island} is lost: no troops are left to hold it."
  }),
  colonyExpired: msg({
    id: "notice.colony.expired",
    message: "{island} has expired. Its remaining settlers, troops and goods returned home."
  }),
  colonyHarbourLost: msg({
    id: "notice.colony.harbourLost", message: "{island} is lost: its harbour was destroyed."
  }),
  colonyHoldText: msg({
    id: "quest.colony.hold.text",
    message: "The colony stays yours for {days} days after the conquest; then everyone sails home."
  }),
  colonyHoldTitle: msg({ id: "quest.colony.hold.title", message: "Hold the colony" })
};
