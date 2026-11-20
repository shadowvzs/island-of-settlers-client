import { msg } from "@lingui/core/macro";

/** Administration window copy (English source; GM-I18N adds the other languages). */
export const ADMIN_MESSAGES = {
  window: {
    denied: msg({ id: "admin.window.denied", message: "Administration is available only to administrators." }),
    loadFailed: msg({ id: "admin.window.loadFailed", message: "The settings could not be loaded: {error}" }),
    tabs: msg({ id: "admin.window.tabs", message: "Administration sections" }),
    tabMaintenance: msg({ id: "admin.window.tabMaintenance", message: "Maintenance" }),
    tabSettings: msg({ id: "admin.window.tabSettings", message: "Game settings" }),
    tabUsers: msg({ id: "admin.window.tabUsers", message: "Users" }),
    title: msg({ id: "admin.window.title", message: "Administration" })
  },
  sections: {
    features: msg({ id: "admin.sections.features", message: "Features" }),
    online: msg({ id: "admin.sections.online", message: "Online" }),
    play: msg({ id: "admin.sections.play", message: "Play" }),
    progression: msg({ id: "admin.sections.progression", message: "Progression" }),
    titleScreen: msg({ id: "admin.sections.titleScreen", message: "Title page" })
  },
  switches: {
    adventures: msg({ id: "admin.switches.adventures", message: "Adventures" }),
    autosave: msg({ id: "admin.switches.autosave", message: "Automatic saving" }),
    chat: msg({ id: "admin.switches.chat", message: "Chat" }),
    colonies: msg({ id: "admin.switches.colonies", message: "Colonies" }),
    experience: msg({ id: "admin.switches.experience", message: "XP" }),
    explorationExpeditions: msg({ id: "admin.switches.explorationExpeditions", message: "Exploring expeditions" }),
    fogOfWar: msg({ id: "admin.switches.fogOfWar", message: "Fog of war" }),
    friends: msg({ id: "admin.switches.friends", message: "Friends" }),
    guilds: msg({ id: "admin.switches.guilds", message: "Guilds" }),
    homeIsland: msg({ id: "admin.switches.homeIsland", message: "Own home island" }),
    market: msg({ id: "admin.switches.market", message: "Market" }),
    menuBeforePlay: msg({ id: "admin.switches.menuBeforePlay", message: "Show the game menu before play" }),
    playerTroopsSightOnly: msg({
      id: "admin.switches.playerTroopsSightOnly", message: "Player troops act only on what they see"
    }),
    settlementExpeditions: msg({ id: "admin.switches.settlementExpeditions", message: "Settlement expeditions" }),
    shop: msg({ id: "admin.switches.shop", message: "Shop" }),
    slots: msg({ id: "admin.switches.slots", message: "Save/Load slots" }),
    talents: msg({ id: "admin.switches.talents", message: "Talents" }),
    trade: msg({ id: "admin.switches.trade", message: "Trade office" })
  },
  fields: {
    afterMap: msg({ id: "admin.fields.afterMap", message: "After a map" }),
    afterMapCampaignSelect: msg({ id: "admin.fields.afterMapCampaignSelect", message: "Campaign selection" }),
    afterMapExitChoice: msg({ id: "admin.fields.afterMapExitChoice", message: "Ask the player" }),
    afterMapHome: msg({ id: "admin.fields.afterMapHome", message: "Home" }),
    autosaveMinutes: msg({ id: "admin.fields.autosaveMinutes", message: "Every N minutes ({min}–{max})" }),
    catchUpNote: msg({
      id: "admin.fields.catchUpNote", message: "Catch-up runs while online and skips while offline."
    }),
    fixedLevel: msg({ id: "admin.fields.fixedLevel", message: "Fixed level (1–{max})" }),
    levels: msg({ id: "admin.fields.levels", message: "Levels" }),
    levelsEarned: msg({ id: "admin.fields.levelsEarned", message: "Earned" }),
    levelsFixed: msg({ id: "admin.fields.levelsFixed", message: "Fixed" }),
    menuBeforePlayHint: msg({
      id: "admin.fields.menuBeforePlayHint",
      message: "On: players get the title menu (Continue, Settings) first. Off: a home island game starts at once."
    }),
    mode: msg({ id: "admin.fields.mode", message: "Mode" }),
    playerTroopsSightOnlyHint: msg({
      id: "admin.fields.playerTroopsSightOnlyHint",
      message: "On (fair): player soldiers target only enemies they see or that hit them. Off: unseen ones too."
    }),
    modeOffline: msg({ id: "admin.fields.modeOffline", message: "Offline" }),
    modeOnline: msg({ id: "admin.fields.modeOnline", message: "Online" }),
    rewards: msg({ id: "admin.fields.rewards", message: "Rewards" }),
    rewardsAuto: msg({ id: "admin.fields.rewardsAuto", message: "Auto (on with a home island)" }),
    rewardsOff: msg({ id: "admin.fields.rewardsOff", message: "Off" }),
    rewardsOn: msg({ id: "admin.fields.rewardsOn", message: "On" }),
    titleBackground: msg({ id: "admin.fields.titleBackground", message: "Background file" }),
    titleBackgroundHint: msg({
      id: "admin.fields.titleBackgroundHint",
      message: "A file name in the title/ folder (.webm, .mp4, .webp, .jpg, .png); empty = title-background.*"
    }),
    titleFileInvalid: msg({
      id: "admin.fields.titleFileInvalid", message: "Use a plain file name with an allowed extension, no folders."
    }),
    titleMusic: msg({ id: "admin.fields.titleMusic", message: "Music file" }),
    titleMusicHint: msg({
      id: "admin.fields.titleMusicHint", message: "A file name in the title/ folder (.ogg, .mp3); empty = title-music.*"
    })
  },
  footer: {
    applies: msg({ id: "admin.footer.applies", message: "Saved settings apply at each player's next session start." }),
    changed: msg({ id: "admin.footer.changed", message: "Revision {revision} · changed by {author} at {time}" }),
    defaultRevision: msg({ id: "admin.footer.defaultRevision", message: "Built-in default (nothing saved yet)" }),
    local: msg({ id: "admin.footer.local", message: "Local settings of this browser (no server, no history)" }),
    preset: msg({ id: "admin.footer.preset", message: "Apply the preset {name}" }),
    presetKeepsMode: msg({
      id: "admin.footer.presetKeepsMode", message: "Apply the preset {name} (the mode online/offline is kept)"
    }),
    presetOfflineSettlement: msg({ id: "admin.footer.presetOfflineSettlement", message: "Offline settlement" }),
    presetOnlineSettlement: msg({ id: "admin.footer.presetOnlineSettlement", message: "Online settlement" }),
    presetStory: msg({ id: "admin.footer.presetStory", message: "Story" }),
    reload: msg({ id: "admin.footer.reload", message: "Discard the changes and reload" }),
    save: msg({ id: "admin.footer.save", message: "Save the settings" }),
    saved: msg({ id: "admin.footer.saved", message: "Saved." }),
    unchanged: msg({ id: "admin.footer.unchanged", message: "No changes." }),
    unsaved: msg({ id: "admin.footer.unsaved", message: "Unsaved changes" })
  },
  confirm: {
    cancel: msg({ id: "admin.confirm.cancel", message: "Cancel: keep editing" }),
    intro: msg({ id: "admin.confirm.intro", message: "Saving changes the game for every player:" }),
    mapWarnings: msg({
      id: "admin.confirm.mapWarnings",
      message: "{count, plural, one {# campaign map here gains mode warnings.} other {# campaign maps here gain mode warnings.}}"
    }),
    save: msg({ id: "admin.confirm.save", message: "Save anyway" }),
    title: msg({ id: "admin.confirm.title", message: "Confirm the settings change" })
  },
  users: {
    ban: msg({ id: "admin.users.ban", message: "Ban {name}" }),
    empty: msg({ id: "admin.users.empty", message: "No accounts." }),
    lastSeen: msg({ id: "admin.users.lastSeen", message: "Last seen" }),
    name: msg({ id: "admin.users.name", message: "Name" }),
    never: msg({ id: "admin.users.never", message: "never" }),
    note: msg({
      id: "admin.users.note", message: "The first {limit} accounts. A ban signs the player out everywhere."
    }),
    reload: msg({ id: "admin.users.reload", message: "Reload the accounts" }),
    role: msg({ id: "admin.users.role", message: "Role" }),
    serverOnly: msg({ id: "admin.users.serverOnly", message: "Accounts exist only on a server." }),
    status: msg({ id: "admin.users.status", message: "Status" }),
    unban: msg({ id: "admin.users.unban", message: "Unban {name}" })
  }
} as const;
