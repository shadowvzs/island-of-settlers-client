import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translateMessage } from "../../../shared/i18n/translate";

/** Copy that is either source text (tests/logs) or a Lingui descriptor resolved in the active locale. */
export type DevelopmentText = string | MessageDescriptor;

export const resolveDevelopmentText = (i18n: Parameters<typeof translateMessage>[0], text: DevelopmentText) =>
  typeof text === "string" ? text : translateMessage(i18n, text);

/** Development tools panel, debug sections and development-only action copy. */
export const DEVELOPMENT_MESSAGES = {
  panel: {
    categories: msg({ id: "development.panel.categories", message: "Development categories" }),
    title: msg({ id: "development.panel.title", message: "Development tools" })
  },
  group: {
    appearance: msg({ id: "settings.appearance.title", message: "Appearance" }),
    diagnostics: msg({ id: "development.group.diagnostics", message: "Diagnostics" }),
    economy: msg({ id: "development.group.economy", message: "Economy" }),
    military: msg({ id: "development.group.military", message: "Military" }),
    world: msg({ id: "settings.world.title", message: "World" })
  },
  tool: {
    createShip: msg({ id: "development.tool.createShip", message: "Create ship" }),
    addCoins: msg({ id: "development.tool.addCoins", message: "Add {count} gold coins" }),
    addUnit: msg({ id: "development.tool.addUnit", message: "Add a random military unit to the HQ" }),
    buildAll: msg({ id: "development.tool.buildAll", message: "Build every building" }),
    clearSaves: msg({ id: "development.tool.clearSaves", message: "Clear saves" }),
    exportGame: msg({ id: "development.tool.exportGame", message: "Export game" }),
    exportMap: msg({ id: "development.tool.exportMap", message: "Export map" }),
    exportReproduction: msg({
      id: "development.tool.exportReproduction", message: "Export reproduction report"
    }),
    exportScene: msg({ id: "development.tool.exportScene", message: "Export full scene" }),
    upgradeRoads: msg({ id: "development.tool.upgradeRoads", message: "Upgrade owned roads" }),
    fillOutputs: msg({ id: "development.tool.fillOutputs", message: "Fill all outputs" }),
    grantGems: msg({ id: "development.tool.grantGems", message: "Grant {count} gems" }),
    handCart: msg({ id: "development.tool.handCart", message: "Get a hand cart" }),
    importGame: msg({ id: "development.tool.importGame", message: "Import game" }),
    importScene: msg({ id: "development.tool.importScene", message: "Import full scene" }),
    mapEditor: msg({ id: "development.tool.mapEditor", message: "Map editor" }),
    openAdministration: msg({
      id: "development.tool.openAdministration", message: "Administration (game settings, users)"
    }),
    openEditor: msg({ id: "development.tool.openEditor", message: "Open map editor" }),
    mapGenerator: msg({ id: "development.tool.mapGenerator", message: "Map generator" }),
    npcTraders: msg({ id: "development.tool.npcTraders", message: "NPC traders" }),
    playerLevel: msg({ id: "development.tool.playerLevel", message: "Player level +{levels}" }),
    playScene: msg({ id: "development.tool.playScene", message: "Play full scene" }),
    raiseBuilding: msg({ id: "development.tool.raiseBuilding", message: "Raise building level on click" }),
    recreateDatabase: msg({ id: "development.tool.recreateDatabase", message: "Recreate database" }),
    recordReproduction: msg({
      id: "development.tool.recordReproduction", message: "Record reproduction"
    }),
    recordScene: msg({ id: "development.tool.recordScene", message: "Record / stop full scene" }),
    removeFog: msg({ id: "development.tool.removeFog", message: "Remove fog" }),
    resetCarriers: msg({ id: "development.tool.resetCarriers", message: "Reset carriers" }),
    spawnEnemy: msg({ id: "development.tool.spawnEnemy", message: "Spawn enemy on click" }),
    testAdventure: msg({ id: "development.tool.testAdventure", message: "Test adventure" }),
    testColony: msg({ id: "development.tool.testColony", message: "Test colony expedition" }),
    testSkirmish: msg({
      id: "development.tool.testSkirmish", message: "Test skirmish (three hostile soldiers)"
    })
  },
  title: {
    upgradeRoads: msg({ id: "development.title.upgradeRoads",
      message: "Upgrade every owned public road on this island by one tier, free. Granite roads stay unchanged." }),

    createShip: msg({ id: "development.title.createShip",
      message: "Click clear, deep sea to create one owned ship. Escape or the button turns it off." }),
    addCoins: msg({
      id: "development.title.addCoins", message: "Adds gold coins to the headquarters for testing."
    }),
    addUnit: msg({
      id: "development.title.addUnit",
      message: "Adds one soldier of a random type and rank (one your nation can recruit) to the home building's garrison, ready for military buildings."
    }),
    buildAll: msg({
      id: "development.title.buildAll",
      message: "Places one finished building of every type on the nearest valid plots near the headquarters, each joined to the road network. Types without a plot (mines need a surveyed deposit) are listed."
    }),
    clearSaves: msg({
      id: "development.title.clearSaves",
      message: "Deletes every local browser save and, when signed in, this account's cloud saves. Accounts and authored maps stay."
    }),
    unavailableDebug: msg({
      id: "development.title.unavailableDebug", message: "Available after the settlement has loaded."
    }),
    exportGame: msg({ id: "development.title.exportGame", message: "Export the current game as a JSON file." }),
    exportMap: msg({
      id: "development.title.exportMap",
      message: "Download the current island as a canonical .island map file for the editor."
    }),
    exportReproduction: msg({
      id: "development.title.exportReproduction",
      message: "Download the starting game, timed settlement commands and final state."
    }),
    exportScene: msg({
      id: "development.title.exportScene", message: "Download the bounded captured visual snapshots as JSON."
    }),
    fillOutputs: msg({
      id: "development.title.fillOutputs",
      message: "Fills completed owned producers with their current product up to the real shelf capacity. Uses the normal cart queues; shipyard launches are excluded."
    }),
    grantGems: msg({
      id: "development.title.grantGems", message: "Adds gems to the player for testing the gem shop."
    }),
    handCart: msg({
      id: "development.title.handCart",
      message: "Gives one finished hand cart to the storage nearest the headquarters with room (at most 4 per storage, carts on the road included)."
    }),
    importGame: msg({ id: "development.title.importGame", message: "Import a game save from a JSON file." }),
    importScene: msg({
      id: "development.title.importScene", message: "Validate and open a full-scene JSON replay in a separate viewer."
    }),
    mapEditor: msg({
      id: "development.title.mapEditor", message: "Toggle the experimental map editor panel."
    }),
    openEditor: msg({
      id: "development.title.openEditor",
      message: "Open the standalone map editor in a separate window."
    }),
    npcTraders: msg({
      id: "development.title.npcTraders",
      message: "Toggle: NPC buyers fill your own trade offers by fairness (bid factor 0.65). Off: offers stay open. Fill times count only while it is on, also during offline catch-up of an island."
    }),
    playerLevel: msg({
      id: "development.title.playerLevel",
      message: "Adds up to ten player levels using the normal XP curve, capped at the maximum level. New colony discoveries use the resulting level; existing islands keep their resource pair."
    }),
    playScene: msg({
      id: "development.title.playScene", message: "Open isolated snapshot playback; leaves the game unchanged."
    }),
    raiseBuilding: msg({
      id: "development.title.raiseBuilding",
      message: "Toggle: each click on a building raises its level by 1 now (no cost, no builder), up to its maximum level. Escape or this button turns it off."
    }),
    recreateDatabase: msg({
      id: "development.title.recreateDatabase",
      message: "DESTRUCTIVE: on a development host, truncates every account, save, market and social table and recreates an empty database. Local browser data is cleared too."
    }),
    recordReproduction: msg({
      id: "development.title.recordReproduction",
      message: "Record settlement commands from a saved starting point on this island."
    }),
    recordScene: msg({
      id: "development.title.recordScene",
      message: "Opt-in 10 Hz visual snapshots, editor changes and island transitions; 64 MiB limit."
    }),
    removeFog: msg({
      id: "development.title.removeFog", message: "Permanently reveal the current island."
    }),
    resetCarriers: msg({
      id: "development.title.resetCarriers",
      message: "Instantly returns every land carrier to its nearest completed storehouse. Carried wares, tools and hand-cart cargo are added to that storehouse's stock."
    }),
    spawnEnemy: msg({
      id: "development.title.spawnEnemy",
      message: "Toggle: each left click on the map spawns one random enemy soldier (nearest reachable ground). Escape or this button turns it off."
    }),
    testAdventure: msg({
      id: "development.title.testAdventure",
      message: "Grants a harbour, ships and veteran troops if missing, then starts an easy adventure with normal voyages: troops land by gangway on an island with no buildings, only enemy field camps."
    }),
    testColony: msg({
      id: "development.title.testColony",
      message: "Grants a harbour, ships, troops, crew and supplies if missing, then starts an easy colony with normal voyages, ore shipments and a 14-day lease: it lands at a harbour, with ore mines and garrisoned enemy forts."
    }),
    testSkirmish: msg({
      id: "development.title.testSkirmish",
      message: "Opt-in small fixture: deploy soldiers first. Up to three reachable enemies; finish existing opponents before another test."
    }),
    unavailableExport: msg({
      id: "development.title.unavailableExport", message: "Export is available in a running game."
    }),
    unavailableImport: msg({
      id: "development.title.unavailableImport", message: "Import is available in a running game."
    })
  },
  toast: {
    deploySoldiers: msg({
      id: "development.toast.deploySoldiers",
      message: "Deploy soldiers onto clear land first; finish existing opponents before another test."
    }),
    developmentOnly: msg({
      id: "development.toast.developmentOnly", message: "Development tools are available only to administrators."
    }),
    recordingReproduction: msg({
      id: "development.toast.recordingReproduction",
      message: "Recording reproduction. Export the report when the problem appears."
    }),
    reproductionExported: msg({
      id: "development.toast.reproductionExported",
      message: "Reproduction report exported. Recording stopped."
    }),
    mapExported: msg({ id: "development.toast.mapExported", message: "Map exported as an .island file." }),
    savesCleared: msg({ id: "development.toast.savesCleared", message: "Saves cleared. Reloading…" }),
    databaseRecreated: msg({
      id: "development.toast.databaseRecreated", message: "Database recreated. Reloading…"
    }),
    startRecordingFirst: msg({
      id: "development.toast.startRecordingFirst", message: "Start recording a reproduction first"
    }),
    testSkirmishSpawned: msg({
      id: "development.toast.testSkirmishSpawned", message: "Test skirmish: {count} hostile soldiers spawned."
    })
  },
  section: {

    debugVisibility: msg({ id: "development.section.debugVisibility", message: "Debug visibility" }),
    expeditionDiscovery: msg({
      id: "development.section.expeditionDiscovery", message: "Expedition discovery"
    }),
    islandTheme: msg({ id: "development.section.islandTheme", message: "Island theme" }),
    month: msg({ id: "development.section.month", message: "Month" }),
    revealOre: msg({
      id: "development.section.revealOre", message: "Reveal ore deposits"
    }),
    themeNote: msg({
      id: "development.section.themeNote",
      message: "A theme also restyles the current adventure or colony, preserving troops, buildings and progress. On the home island it applies to new Test adventure and Test colony voyages."
    }),
    workerColour: msg({ id: "development.section.workerColour", message: "Worker colour" }),
    workers: msg({ id: "settlement.summary.workers", message: "Workers" })
  },
  month: {
    april: msg({ id: "development.month.april", message: "April" }),
    august: msg({ id: "development.month.august", message: "August" }),
    december: msg({ id: "development.month.december", message: "December" }),
    february: msg({ id: "development.month.february", message: "February" }),
    january: msg({ id: "development.month.january", message: "January" }),
    july: msg({ id: "development.month.july", message: "July" }),
    june: msg({ id: "development.month.june", message: "June" }),
    march: msg({ id: "development.month.march", message: "March" }),
    may: msg({ id: "development.month.may", message: "May" }),
    november: msg({ id: "development.month.november", message: "November" }),
    october: msg({ id: "development.month.october", message: "October" }),
    realCalendar: msg({ id: "development.month.realCalendar", message: "Real calendar" }),
    september: msg({ id: "development.month.september", message: "September" })
  },
  theme: {
    desert: msg({ id: "settlement.climate.desert", message: "Desert" }),
    forest: msg({ id: "settlement.climate.forest", message: "Forest" }),
    seasonal: msg({ id: "development.theme.seasonal", message: "Seasonal 90/10 selection" }),
    swamp: msg({ id: "settlement.climate.swamp", message: "Swamp" }),
    tropical: msg({ id: "settlement.climate.tropical", message: "Tropical" }),
    winter: msg({ id: "settlement.climate.winter", message: "Winter" })
  },
  color: {
    black: msg({ id: "development.color.black", message: "Black" }),
    blue: msg({ id: "development.color.blue", message: "Blue" }),
    brown: msg({ id: "development.color.brown", message: "Brown" }),
    green: msg({ id: "development.color.green", message: "Green" }),
    red: msg({ id: "development.color.red", message: "Red" }),
    white: msg({ id: "development.color.white", message: "White" }),
    yellow: msg({ id: "development.color.yellow", message: "Yellow" })
  },
} as const;
