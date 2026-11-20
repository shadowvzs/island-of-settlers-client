import { msg } from "@lingui/core/macro";

/** Title page copy (GS3b, plan §7.5, §7.6). English only; GM-I18N fills the other catalogs. */
export const TITLE_MESSAGES = {
  abandon: {
    confirm: msg({ id: "title.abandon.confirm", message: "Abandon and start" }),
    question: msg({ id: "title.abandon.question", message: "Abandon the current map?" })
  },
  admin: {
    mapEditor: msg({ id: "title.admin.mapEditor", message: "Map editor" }),
    serverSettings: msg({ id: "title.admin.serverSettings", message: "Server settings" })
  },
  back: msg({ id: "title.back", message: "Back" }),
  campaigns: msg({ id: "title.campaigns", message: "Campaigns" }),
  cancel: msg({ id: "title.cancel", message: "Cancel" }),
  continue: msg({ id: "title.continue", message: "Continue" }),
  continueNone: msg({ id: "title.continueNone", message: "There is no game to continue" }),
  heading: msg({ id: "title.heading", message: "Island of Settlers" }),
  landing: {
    campaignSelection: msg({ id: "title.landing.campaignSelection", message: "Campaign selection" }),
    choosePath: msg({ id: "title.landing.choosePath", message: "Choose your path" }),
    exit: msg({ id: "title.landing.exit", message: "Exit game" }),
    heading: msg({ id: "title.landing.heading", message: "Map won" }),
    nextMap: msg({ id: "title.landing.nextMap", message: "Next map" })
  },
  load: msg({ id: "title.load", message: "Load" }),
  menu: msg({ id: "title.menu", message: "Title menu" }),
  mode: {
    offline: msg({ id: "title.mode.offline", message: "Offline mode" }),
    online: msg({ id: "title.mode.online", message: "Online mode" })
  },
  multiplayer: msg({ id: "title.multiplayer", message: "Multiplayer maps" }),
  multiplayerPlanned: msg({ id: "title.multiplayerPlanned", message: "Player versus player maps are planned" }),
  noSaves: msg({ id: "title.noSaves", message: "There is no saved game yet" }),
  newGame: msg({ id: "title.newGame", message: "New game" }),
  newGameConfirm: msg({ id: "title.newGameConfirm", message: "Start a new game" }),
  newGameQuestion: msg({ id: "title.newGameQuestion", message: "Start a new game? Your saved slots stay." }),
  newGameStoryQuestion: msg({
    id: "title.newGameStoryQuestion",
    message: "Start a new game? The current game's campaign progress is reset; your saved slots stay."
  }),
  slotHoldsHome: msg({
    id: "title.slotHoldsHome",
    message: "This save slot holds a home island game; switch save slot in Settings > Account"
  }),
  settings: {
    account: msg({ id: "title.settings.account", message: "Account" }),
    detail: msg({ id: "title.settings.detail", message: "Detail" }),
    detailHint: msg({ id: "title.settings.detailHint", message: "Applies when the game loads" }),
    heading: msg({ id: "title.settings.heading", message: "Settings" }),
    language: msg({ id: "title.settings.language", message: "Language" }),
    music: msg({ id: "title.settings.music", message: "Music" }),
    sound: msg({ id: "title.settings.sound", message: "Sound" })
  }
};
