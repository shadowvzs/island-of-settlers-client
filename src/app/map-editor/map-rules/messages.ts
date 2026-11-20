import { msg } from "@lingui/core/macro";

/** Map rules section copy (editor UI; English source, other languages from the translation batch). */
export const MAP_RULES_MESSAGES = {
  catchUp: {
    inherit: msg({ id: "mapRules.catchUp.inherit", message: "Offline catch-up runs on this map (click to skip it)" }),
    off: msg({ id: "mapRules.catchUp.off", message: "Offline catch-up is skipped on this map (click to allow it)" })
  },
  experience: {
    inherit: msg({ id: "mapRules.experience.inherit", message: "Experience is earned on this map (click to stop)" }),
    off: msg({ id: "mapRules.experience.off", message: "No experience on this map (click to allow it)" })
  },
  features: {
    adventures: msg({ id: "mapRules.features.adventures", message: "Adventures" }),
    colonies: msg({ id: "mapRules.features.colonies", message: "Colonies" }),
    explorationExpeditions: msg({ id: "mapRules.features.explorationExpeditions", message: "Exploring expeditions" }),
    settlementExpeditions: msg({ id: "mapRules.features.settlementExpeditions", message: "Settlement expeditions" }),
    trade: msg({ id: "mapRules.features.trade", message: "Trade office" })
  },
  featureState: {
    gameOff: msg({ id: "mapRules.featureState.gameOff", message: "{feature}: off in the game settings" }),
    inherit: msg({ id: "mapRules.featureState.inherit", message: "{feature}: allowed (click to switch off here)" }),
    needsHome: msg({ id: "mapRules.featureState.needsHome", message: "{feature}: needs a home island" }),
    noFog: msg({ id: "mapRules.featureState.noFog", message: "{feature}: not applicable while fog of war is off" }),
    off: msg({ id: "mapRules.featureState.off", message: "{feature}: off on this map (click to allow)" })
  },
  forbidden: {
    catchUpCampaign: msg({ id: "mapRules.forbidden.catchUpCampaign", message: "Campaign maps never catch up" }),
    catchUpHome: msg({ id: "mapRules.forbidden.catchUpHome", message: "Home maps always catch up" }),
    fixedLevel: msg({ id: "mapRules.forbidden.fixedLevel", message: "Fixed level: campaign and adventure maps only" })
  },
  gameBadges: {
    gameOff: msg({ id: "mapRules.gameBadges.gameOff", message: "Off in the game settings: {names}" }),
    needsHome: msg({
      id: "mapRules.gameBadges.needsHome", message: "Trade, colonies, adventures and expeditions need a home island"
    }),
    noFog: msg({
      id: "mapRules.gameBadges.noFog", message: "Exploring expeditions: not applicable while fog of war is off"
    })
  },
  gameOff: {
    experience: msg({ id: "mapRules.gameOff.experience", message: "Experience: off in the game settings" }),
    talents: msg({ id: "mapRules.gameOff.talents", message: "Talents: off in the game settings" })
  },
  level: msg({ id: "mapRules.level", message: "Fixed level" }),
  levelHint: msg({
    id: "mapRules.levelHint",
    message: "Fixed level {min}–{max}; empty follows the game settings. Adventure maps may only lower the level."
  }),
  mode: {
    home: msg({ id: "mapRules.mode.home", message: "Home island mode" }),
    noHome: msg({ id: "mapRules.mode.noHome", message: "No home island mode" })
  },
  modeSource: {
    bundled: msg({
      id: "mapRules.modeSource.bundled", message: "The game mode comes from the game settings file of this build."
    }),
    cached: msg({
      id: "mapRules.modeSource.cached",
      message: "The game mode comes from the last game settings this browser received from the server."
    }),
    none: msg({
      id: "mapRules.modeSource.none",
      message: "No game settings were found (server, cached copy, build file): the default home island mode applies."
    }),
    pending: msg({
      id: "mapRules.modeSource.pending",
      message: "The game settings are not loaded yet: the editor shows the default home island mode."
    }),
    server: msg({ id: "mapRules.modeSource.server", message: "The game mode comes from the server's game settings." })
  },
  modeNotLoaded: msg({ id: "mapRules.modeNotLoaded", message: "Mode not loaded" }),
  names: {
    experience: msg({ id: "mapRules.names.experience", message: "Experience" }),
    talents: msg({ id: "mapRules.names.talents", message: "Talents" })
  },
  nationDefault: msg({ id: "mapRules.nationDefault", message: "Use the nation's default start stock" }),
  nationDefaultBadge: msg({ id: "mapRules.nationDefaultBadge", message: "Nation default stock" }),
  editStart: msg({ id: "mapRules.editStart", message: "Edit the start wares, settlers and soldiers" }),
  picker: {
    empty: msg({ id: "mapRules.picker.empty", message: "No settlers or soldiers: pick them from the People tab." }),
    selected: msg({ id: "mapRules.picker.selected", message: "Start setup" }),
    title: msg({ id: "mapRules.picker.title", message: "Add wares and people" })
  },
  rewardScope: {
    all: msg({ id: "mapRules.rewardScope.all", message: "Rewards on" }),
    none: msg({ id: "mapRules.rewardScope.none", message: "Rewards off" }),
    wallet: msg({ id: "mapRules.rewardScope.wallet", message: "Gems and XP rewards only" })
  },
  rewardScopeHint: {
    all: msg({ id: "mapRules.rewardScopeHint.all", message: "Rewards are paid to the home island." }),
    none: msg({
      id: "mapRules.rewardScopeHint.none",
      message: "The game pays no rewards: reward fields are hidden and keep their stored values."
    }),
    wallet: msg({
      id: "mapRules.rewardScopeHint.wallet",
      message: "Without a home island only gems and XP are paid: home-bound rewards are hidden and keep their values."
    })
  },
  rulesTitle: msg({ id: "mapRules.rulesTitle", message: "This map" }),
  startSetup: {
    expedition: msg({
      id: "mapRules.startSetup.expedition",
      message: "Used only without a home island: an expedition from home brings its cargo instead."
    }),
    inherit: msg({ id: "mapRules.startSetup.inherit", message: "The map's start setup is used (click to switch off)" }),
    off: msg({ id: "mapRules.startSetup.off", message: "No start setup: a start without a home begins empty" })
  },
  startTitle: msg({ id: "mapRules.startTitle", message: "Start setup" }),
  talents: {
    inherit: msg({ id: "mapRules.talents.inherit", message: "Talents work on this map (click to switch off)" }),
    off: msg({ id: "mapRules.talents.off", message: "No talents on this map (click to allow them)" })
  },
  title: msg({ id: "mapRules.title", message: "Map rules" }),
  warnings: {
    noRewardCoins: msg({
      id: "mapRules.warnings.noRewardCoins",
      message: "Home island mode: this map pays no reward coins home."
    }),
    noStoryStart: msg({
      id: "mapRules.warnings.noStoryStart",
      message: "No settlers or soldiers: without a home island this map could not be played."
    })
  }
};
