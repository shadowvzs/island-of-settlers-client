// oxlint-disable max-lines -- one feature-owned catalog keeps the Script workspace ids reviewable together.
import { msg } from "@lingui/core/macro";

/** Script workspace copy (trigger editor and actor panel; en source, hu in the PO). */
export const SCRIPT_MESSAGES = {
  workspace: {
    title: msg({ id: "mapEditor.script.title", message: "Map script" }),
    open: msg({ id: "mapEditor.script.open", message: "Open the script editor" }),
    sectionInfo: msg({
      id: "mapEditor.script.sectionInfo",
      message: "Triggers (when, if, do), actors and templates of this map. Saved in the map file with the map."
    }),
    summary: msg({
      id: "mapEditor.script.summary",
      message: "{triggers} triggers · {actors} actors · {variables} variables"
    }),
    empty: msg({ id: "mapEditor.script.empty", message: "This map has no script yet." }),
    tabs: msg({ id: "mapEditor.script.tabs", message: "Script parts" }),
    tabTriggers: msg({ id: "mapEditor.script.tab.triggers", message: "Triggers" }),
    tabActors: msg({ id: "mapEditor.script.tab.actors", message: "Actors" }),
    undo: msg({ id: "mapEditor.script.undo", message: "Undo script change" }),
    redo: msg({ id: "mapEditor.script.redo", message: "Redo script change" }),
    ready: msg({ id: "mapEditor.script.ready", message: "Ready: no errors" }),
    draft: msg({
      id: "mapEditor.script.draft",
      message: "{errors, plural, one {# error} other {# errors}} · {warnings, plural, one {# warning} other {# warnings}}: the map stays a draft until the errors are fixed"
    }),
    warningsOnly: msg({
      id: "mapEditor.script.warningsOnly",
      message: "Ready · {warnings, plural, one {# warning} other {# warnings}}"
    }),
    confirmDraftSave: msg({
      id: "mapEditor.script.confirmDraftSave",
      message: "The map script has {errors, plural, one {# error} other {# errors}}. Save the map as a draft anyway? (Open Script to see them.)"
    }),
    refused: msg({ id: "mapEditor.script.refused", message: "The map cannot be edited right now." }),
    testPlay: msg({
      id: "mapEditor.script.testPlay", message: "Test play: start this map with its script and the script log"
    }),
    testPlayErrors: msg({
      id: "mapEditor.script.testPlayErrors", message: "Fix the script errors before the test play."
    })
  },
  list: {
    search: msg({ id: "mapEditor.script.list.search", message: "Search triggers" }),
    searchPlaceholder: msg({
      id: "mapEditor.script.list.searchPlaceholder",
      message: "Name, comment, variable, text…"
    }),
    addTrigger: msg({ id: "mapEditor.script.list.addTrigger", message: "+ Trigger" }),
    addTemplate: msg({ id: "mapEditor.script.list.addTemplate", message: "+ From template" }),
    addFolder: msg({ id: "mapEditor.script.list.addFolder", message: "+ Folder" }),
    paste: msg({ id: "mapEditor.script.list.paste", message: "Paste trigger" }),
    filter: msg({ id: "mapEditor.script.list.filter", message: "Show" }),
    filterAll: msg({ id: "mapEditor.script.list.filter.all", message: "All" }),
    filterErrors: msg({ id: "mapEditor.script.list.filter.errors", message: "Errors only" }),
    filterDisabled: msg({ id: "mapEditor.script.list.filter.disabled", message: "Off only" }),
    unsorted: msg({ id: "mapEditor.script.list.unsorted", message: "Not in a folder" }),
    newTrigger: msg({ id: "mapEditor.script.list.newTrigger", message: "New trigger {number}" }),
    newFolder: msg({ id: "mapEditor.script.list.newFolder", message: "New folder {number}" }),
    folderName: msg({ id: "mapEditor.script.list.folderName", message: "Folder name" }),
    deleteFolder: msg({
      id: "mapEditor.script.list.deleteFolder",
      message: "Delete folder {name} (its triggers stay)"
    }),
    noTriggers: msg({
      id: "mapEditor.script.list.noTriggers",
      message: "No trigger yet: add one or insert a template."
    }),
    noMatches: msg({ id: "mapEditor.script.list.noMatches", message: "No trigger matches \"{query}\"." }),
    triggerOff: msg({ id: "mapEditor.script.list.triggerOff", message: "{name} (off)" }),
    errorCount: msg({
      id: "mapEditor.script.list.errorCount",
      message: "{count, plural, one {# error} other {# errors}}"
    }),
    triggers: msg({ id: "mapEditor.script.list.triggers", message: "Triggers" }),
    copyName: msg({ id: "mapEditor.script.list.copyName", message: "{name} (copy)" })
  },
  form: {
    none: msg({ id: "mapEditor.script.form.none", message: "Choose a trigger on the left, or add one." }),
    enabled: msg({ id: "mapEditor.script.form.enabled", message: "On" }),
    name: msg({ id: "mapEditor.script.form.name", message: "Name" }),
    comment: msg({ id: "mapEditor.script.form.comment", message: "Comment" }),
    folder: msg({ id: "mapEditor.script.form.folder", message: "Folder" }),
    advanced: msg({ id: "mapEditor.script.form.advanced", message: "Advanced" }),
    concurrency: msg({ id: "mapEditor.script.form.concurrency", message: "When it fires again while running" }),
    queue: msg({ id: "mapEditor.script.form.queue", message: "Queue the new run" }),
    parallel: msg({ id: "mapEditor.script.form.parallel", message: "Run in parallel" }),
    ignore: msg({ id: "mapEditor.script.form.ignore", message: "Ignore the new firing" }),
    runLimit: msg({ id: "mapEditor.script.form.runLimit", message: "Fires at most (times per map run)" }),
    runLimitHint: msg({ id: "mapEditor.script.form.runLimitHint", message: "Empty: no limit. 1: a one-shot trigger." }),
    runTriggerHint: msg({
      id: "mapEditor.script.form.runTriggerHint",
      message: "\"Run trigger\" starts a trigger directly, even when it is off, has reached its run limit or is busy; its Advanced settings (concurrency, run limit) do not apply. Its conditions are checked only when \"check conditions\" is ticked."
    }),
    when: msg({ id: "mapEditor.script.form.when", message: "When (any of)" }),
    if: msg({ id: "mapEditor.script.form.if", message: "If (all of)" }),
    do: msg({ id: "mapEditor.script.form.do", message: "Do" }),
    addEvent: msg({ id: "mapEditor.script.form.addEvent", message: "+ event" }),
    addCondition: msg({ id: "mapEditor.script.form.addCondition", message: "+ condition" }),
    addAction: msg({ id: "mapEditor.script.form.addAction", message: "+ action" }),
    pasteStep: msg({ id: "mapEditor.script.form.pasteStep", message: "Paste step" }),
    thenBranch: msg({ id: "mapEditor.script.form.then", message: "then" }),
    elseBranch: msg({ id: "mapEditor.script.form.else", message: "else" }),
    loopBody: msg({ id: "mapEditor.script.form.loopBody", message: "do" }),
    noEvents: msg({
      id: "mapEditor.script.form.noEvents",
      message: "No event: the trigger runs only when another trigger runs it."
    }),
    usedBy: msg({ id: "mapEditor.script.form.usedBy", message: "Used by: {users}" }),
    notUsed: msg({ id: "mapEditor.script.form.notUsed", message: "Not referenced elsewhere" }),
    issueCount: msg({
      id: "mapEditor.script.form.issueCount",
      message: "{errors, plural, one {# error} other {# errors}} · {warnings, plural, one {# warning} other {# warnings}}"
    }),
    explain: msg({ id: "mapEditor.script.form.explain", message: "In words" }),
    deleteTrigger: msg({ id: "mapEditor.script.form.deleteTrigger", message: "Delete trigger" }),
    copyTrigger: msg({ id: "mapEditor.script.form.copyTrigger", message: "Copy trigger" }),
    deleteRefused: msg({ id: "mapEditor.script.form.deleteRefused", message: "Delete refused: used by {users}." }),
    waitDone: msg({ id: "mapEditor.script.form.waitDone", message: "Wait until done" }),
    waitTimeout: msg({ id: "mapEditor.script.form.waitTimeout", message: "Timeout (s)" }),
    stopOnFail: msg({ id: "mapEditor.script.form.stopOnFail", message: "Stop the run when it fails" }),
    lockOrders: msg({ id: "mapEditor.script.form.lockOrders", message: "Player cannot override" }),
    checkConditions: msg({ id: "mapEditor.script.form.checkConditions", message: "Check its conditions" }),
    waitForRun: msg({ id: "mapEditor.script.form.waitForRun", message: "Wait for it to finish" }),
    stepComment: msg({ id: "mapEditor.script.form.stepComment", message: "Step comment" })
  },
  menu: {
    label: msg({ id: "mapEditor.script.menu.label", message: "Step actions" }),
    moveUp: msg({ id: "mapEditor.script.menu.moveUp", message: "Move up" }),
    moveDown: msg({ id: "mapEditor.script.menu.moveDown", message: "Move down" }),
    duplicate: msg({ id: "mapEditor.script.menu.duplicate", message: "Duplicate (Ctrl+D)" }),
    disable: msg({ id: "mapEditor.script.menu.disable", message: "Turn off (Ctrl+/)" }),
    enable: msg({ id: "mapEditor.script.menu.enable", message: "Turn on (Ctrl+/)" }),
    comment: msg({ id: "mapEditor.script.menu.comment", message: "Comment" }),
    copy: msg({ id: "mapEditor.script.menu.copy", message: "Copy" }),
    cut: msg({ id: "mapEditor.script.menu.cut", message: "Cut" }),
    delete: msg({ id: "mapEditor.script.menu.delete", message: "Delete" }),
    wrapIf: msg({ id: "mapEditor.script.menu.wrapIf", message: "Wrap in if" }),
    wrapForEach: msg({ id: "mapEditor.script.menu.wrapForEach", message: "Wrap in for each" }),
    invert: msg({ id: "mapEditor.script.menu.invert", message: "Swap the wording" }),
    invertHint: msg({
      id: "mapEditor.script.menu.invertHint",
      message: "Same event, the other sentence order (\"a hunter kills a deer\" or \"a deer is killed by a hunter\")."
    }),
    off: msg({ id: "mapEditor.script.menu.off", message: "off" })
  },
  add: {
    eventTitle: msg({ id: "mapEditor.script.add.eventTitle", message: "Add an event" }),
    conditionTitle: msg({ id: "mapEditor.script.add.conditionTitle", message: "Add a condition" }),
    actionTitle: msg({ id: "mapEditor.script.add.actionTitle", message: "Add an action" }),
    search: msg({ id: "mapEditor.script.add.search", message: "Search" }),
    later: msg({ id: "mapEditor.script.add.later", message: "later ({lane})" }),
    flow: msg({ id: "mapEditor.script.add.flow", message: "Flow" }),
    predicates: msg({ id: "mapEditor.script.add.predicates", message: "World and quest checks" }),
    rows: msg({ id: "mapEditor.script.add.rows", message: "Compare and groups" }),
    groups: {
      engine: msg({ id: "mapEditor.script.group.engine", message: "Map, time, variables and quests" }),
      units: msg({ id: "mapEditor.script.group.units", message: "Settlers, soldiers and commanders" }),
      buildings: msg({ id: "mapEditor.script.group.buildings", message: "Buildings and bridges" }),
      trade: msg({ id: "mapEditor.script.group.trade", message: "Trade" }),
      ships: msg({ id: "mapEditor.script.group.ships", message: "Ships and boats" }),
      nature: msg({ id: "mapEditor.script.group.nature", message: "Nature, props and wares" }),
      colony: msg({ id: "mapEditor.script.group.colony", message: "Colony and adventure" }),
      presence: msg({ id: "mapEditor.script.group.presence", message: "Presence" }),
      world: msg({ id: "mapEditor.script.group.world", message: "World and cinematics" }),
      quests: msg({ id: "mapEditor.script.group.quests", message: "Quests, triggers and variables" }),
      boards: msg({ id: "mapEditor.script.group.boards", message: "Multiboards" }),
      rewards: msg({ id: "mapEditor.script.group.rewards", message: "Mail, rewards and map end" }),
      ui: msg({ id: "mapEditor.script.group.ui", message: "Game windows" })
    }
  },
  explain: {
    whenIfDo: msg({ id: "mapEditor.script.explain.whenIfDo", message: "When {events}, if {conditions}, {actions}." }),
    whenDo: msg({ id: "mapEditor.script.explain.whenDo", message: "When {events}, {actions}." }),
    calledIfDo: msg({
      id: "mapEditor.script.explain.calledIfDo",
      message: "When another trigger runs it, if {conditions}, {actions}."
    }),
    calledDo: msg({ id: "mapEditor.script.explain.calledDo", message: "When another trigger runs it, {actions}." }),
    nothing: msg({ id: "mapEditor.script.explain.nothing", message: "nothing happens" }),
    or: msg({ id: "mapEditor.script.explain.or", message: "{first} or {second}" }),
    and: msg({ id: "mapEditor.script.explain.and", message: "{first} and {second}" }),
    sequence: msg({ id: "mapEditor.script.explain.then", message: "{first}, then {second}" }),
    not: msg({ id: "mapEditor.script.explain.not", message: "not ({condition})" }),
    group: msg({ id: "mapEditor.script.explain.group", message: "({conditions})" })
  },
  value: {
    unset: msg({ id: "mapEditor.script.value.unset", message: "choose…" }),
    any: msg({ id: "mapEditor.script.value.any", message: "any" }),
    yes: msg({ id: "mapEditor.script.value.yes", message: "yes" }),
    no: msg({ id: "mapEditor.script.value.no", message: "no" }),
    mapEdge: msg({ id: "mapEditor.script.value.mapEdge", message: "the map edge" }),
    rewards: msg({
      id: "mapEditor.script.value.rewards",
      message: "{count, plural, one {# reward} other {# rewards}}"
    }),
    unknown: msg({ id: "mapEditor.script.value.unknown", message: "unknown {id}" }),
    typeOwned: msg({ id: "mapEditor.script.value.typeOwned", message: "{type} – {owner}" }),
    inRegion: msg({ id: "mapEditor.script.value.inRegion", message: "{actor} in {region}" }),
    family: msg({ id: "mapEditor.script.value.family", message: "{name} family" }),
    familyMembers: msg({ id: "mapEditor.script.value.familyMembers", message: "{name} family ({members})" }),
    query: msg({ id: "mapEditor.script.value.query", message: "{pick} of {from}" }),
    pickAll: msg({ id: "mapEditor.script.value.pick.all", message: "all" }),
    pickFirst: msg({ id: "mapEditor.script.value.pick.first", message: "the first" }),
    pickNearest: msg({ id: "mapEditor.script.value.pick.nearest", message: "the nearest" }),
    pickRandom: msg({ id: "mapEditor.script.value.pick.random", message: "a random one" }),
    rank: msg({ id: "mapEditor.script.value.rank", message: "{type}, rank {rank}" }),
    nationType: msg({ id: "mapEditor.script.value.nationType", message: "{type} ({nation})" }),
    variableItem: msg({ id: "mapEditor.script.value.variableItem", message: "{variable}[{index}]" }),
    round: msg({ id: "mapEditor.script.value.round", message: "{mode} of" }),
    lineAmount: msg({ id: "mapEditor.script.value.lineAmount", message: "{name} ×{amount}" })
  },
  players: {
    any: msg({ id: "mapEditor.script.player.any", message: "any player" }),
    slot: msg({ id: "mapEditor.script.player.slot", message: "Player {number}" }),
    alliesOf: msg({ id: "mapEditor.script.player.alliesOf", message: "allies of Player {number}" }),
    alliesOfSelf: msg({ id: "mapEditor.script.player.alliesOfSelf", message: "Player {number} and allies" }),
    enemiesOf: msg({ id: "mapEditor.script.player.enemiesOf", message: "enemies of Player {number}" }),
    neutral: msg({ id: "mapEditor.script.player.neutral", message: "ownerless (wildlife, scenery)" }),
    humans: msg({ id: "mapEditor.script.player.humans", message: "human players" }),
    computers: msg({ id: "mapEditor.script.player.computers", message: "computer players" }),
    response: msg({ id: "mapEditor.script.player.response", message: "the triggering player" })
  },
  responses: {
    triggeringActor: msg({ id: "mapEditor.script.response.triggeringActor", message: "the triggering actor" }),
    targetActor: msg({ id: "mapEditor.script.response.targetActor", message: "the target actor" }),
    killingActor: msg({ id: "mapEditor.script.response.killingActor", message: "the attacker" }),
    enteringActor: msg({ id: "mapEditor.script.response.enteringActor", message: "the arriving actor" }),
    carriedWare: msg({ id: "mapEditor.script.response.carriedWare", message: "the carried ware" }),
    containerActor: msg({ id: "mapEditor.script.response.containerActor", message: "the building or ship" }),
    lastSpawned: msg({ id: "mapEditor.script.response.lastSpawned", message: "the last spawned actor" }),
    triggeringPlayer: msg({ id: "mapEditor.script.response.triggeringPlayer", message: "the triggering player" }),
    region: msg({ id: "mapEditor.script.response.region", message: "the event's region" }),
    ware: msg({ id: "mapEditor.script.response.ware", message: "the event's ware" }),
    amount: msg({ id: "mapEditor.script.response.amount", message: "the event's amount" }),
    building: msg({ id: "mapEditor.script.response.building", message: "the event's building" }),
    quest: msg({ id: "mapEditor.script.response.quest", message: "the event's quest" }),
    timer: msg({ id: "mapEditor.script.response.timer", message: "the event's timer" }),
    outcome: msg({ id: "mapEditor.script.response.outcome", message: "the last step's outcome" }),
    stage: msg({ id: "mapEditor.script.response.stage", message: "the growth stage" }),
    variable: msg({ id: "mapEditor.script.response.variable", message: "the changed variable's name" }),
    oldValue: msg({ id: "mapEditor.script.response.oldValue", message: "the old value" }),
    newValue: msg({ id: "mapEditor.script.response.newValue", message: "the new value" })
  },
  looks: {
    ownerNation: msg({ id: "mapEditor.script.look.ownerNation", message: "the owner's nation" }),
    nation: msg({ id: "mapEditor.script.look.nation", message: "{nation} look" }),
    pirates: msg({ id: "mapEditor.script.look.pirates", message: "pirates" }),
    bandits: msg({ id: "mapEditor.script.look.bandits", message: "bandits" })
  },
  uiTargets: {
    inventory: msg({ id: "mapEditor.script.ui.inventory", message: "the inventory" }),
    quests: msg({ id: "mapEditor.script.ui.quests", message: "the quest window" }),
    settings: msg({ id: "mapEditor.script.ui.settings", message: "the settings" }),
    language: msg({ id: "mapEditor.script.ui.language", message: "the language window" }),
    building: msg({ id: "mapEditor.script.ui.building", message: "a building's details" }),
    overview: msg({ id: "mapEditor.script.ui.overview", message: "the building overview" }),
    mainPanel: msg({ id: "mapEditor.script.ui.mainPanel", message: "the main panel" }),
    messages: msg({ id: "mapEditor.script.ui.messages", message: "the messages" }),
    talents: msg({ id: "mapEditor.script.ui.talents", message: "the talents" }),
    market: msg({ id: "mapEditor.script.ui.market", message: "the market" }),
    tradeOffice: msg({ id: "mapEditor.script.ui.tradeOffice", message: "the trade office" }),
    fleet: msg({ id: "mapEditor.script.ui.fleet", message: "the fleet" }),
    expeditionPlanner: msg({ id: "mapEditor.script.ui.expeditionPlanner", message: "the expedition planner" }),
    colonyTracker: msg({ id: "mapEditor.script.ui.colonyTracker", message: "the colony tracker" }),
    terrainSurvey: msg({ id: "mapEditor.script.ui.terrainSurvey", message: "the terrain survey" }),
    gemShop: msg({ id: "mapEditor.script.ui.gemShop", message: "the gem shop" })
  },
  audio: {
    confirmOwn: msg({
      id: "mapEditor.script.audio.confirmOwn", message: "This file is my own work or licence-free"
    }),
    limits: msg({
      id: "mapEditor.script.audio.limits", message: "OGG or MP3, at most {kilobytes} KB and {seconds} s."
    }),
    noMatches: msg({ id: "mapEditor.script.audio.noMatches", message: "Nothing here." }),
    preview: msg({ id: "mapEditor.script.audio.preview", message: "Play {name}" }),
    refusal: {
      format: msg({ id: "mapEditor.script.audio.refusal.format", message: "Only OGG and MP3 files can be uploaded." }),
      invalid: msg({ id: "mapEditor.script.audio.refusal.invalid", message: "This file cannot be read as audio." }),
      tooLarge: msg({
        id: "mapEditor.script.audio.refusal.tooLarge", message: "The file is larger than {kilobytes} KB."
      }),
      tooLong: msg({ id: "mapEditor.script.audio.refusal.tooLong", message: "The file is longer than {seconds} s." }),
      tooMany: msg({
        id: "mapEditor.script.audio.refusal.tooMany", message: "A map holds at most {count} uploaded audio files."
      }),
      totalTooLarge: msg({
        id: "mapEditor.script.audio.refusal.totalTooLarge",
        message: "The map's uploaded audio would exceed {totalKilobytes} KB in total."
      })
    },
    remove: msg({ id: "mapEditor.script.audio.remove", message: "Remove {name} from the map" }),
    search: msg({ id: "mapEditor.script.audio.search", message: "Search" }),
    stopPreview: msg({ id: "mapEditor.script.audio.stopPreview", message: "Stop {name}" }),
    tabs: msg({ id: "mapEditor.script.audio.tabs", message: "Audio categories" }),
    upload: msg({ id: "mapEditor.script.audio.upload", message: "Upload an audio file" }),
    uploadsTab: msg({ id: "mapEditor.script.audio.uploadsTab", message: "Uploaded" })
  },
  picker: {
    title: msg({ id: "mapEditor.script.picker.title", message: "Choose: {slot}" }),
    kinds: msg({ id: "mapEditor.script.picker.kinds", message: "Kinds of value" }),
    cancel: msg({ id: "mapEditor.script.picker.cancel", message: "Cancel" }),
    choose: msg({ id: "mapEditor.script.picker.choose", message: "Choose" }),
    clear: msg({ id: "mapEditor.script.picker.clear", message: "Clear (any)" }),
    tabInstance: msg({ id: "mapEditor.script.picker.tab.instance", message: "An actor" }),
    tabType: msg({ id: "mapEditor.script.picker.tab.type", message: "A type" }),
    tabFamily: msg({ id: "mapEditor.script.picker.tab.family", message: "A family" }),
    tabResponse: msg({ id: "mapEditor.script.picker.tab.response", message: "From the event" }),
    tabLocal: msg({ id: "mapEditor.script.picker.tab.local", message: "Loop item" }),
    tabValue: msg({ id: "mapEditor.script.picker.tab.value", message: "Value" }),
    tabVariable: msg({ id: "mapEditor.script.picker.tab.variable", message: "Variable" }),
    tabFunction: msg({ id: "mapEditor.script.picker.tab.function", message: "Function" }),
    tabMath: msg({ id: "mapEditor.script.picker.tab.math", message: "Math" }),
    tabCell: msg({ id: "mapEditor.script.picker.tab.cell", message: "This row" }),
    cell: {
      rowIndex: msg({ id: "mapEditor.script.picker.cell.rowIndex", message: "row number" }),
      rowItem: msg({ id: "mapEditor.script.picker.cell.rowItem", message: "the row's list item" }),
      rowLabel: msg({ id: "mapEditor.script.picker.cell.rowLabel", message: "row label" }),
      rowPlayer: msg({ id: "mapEditor.script.picker.cell.rowPlayer", message: "the row's player" })
    },
    pickOnMap: msg({ id: "mapEditor.script.picker.pickOnMap", message: "Pick on map" }),
    pickObjectHint: msg({
      id: "mapEditor.script.picker.pickObjectHint",
      message: "Click a unit, building or decoration on the map (Esc or right click cancels)."
    }),
    pickRegionHint: msg({
      id: "mapEditor.script.picker.pickRegionHint",
      message: "Click the map: a new circular region is made there (Esc or right click cancels)."
    }),
    noObjectNear: msg({
      id: "mapEditor.script.picker.noObjectNear",
      message: "No authored unit, building or decoration near the click."
    }),
    regionName: msg({ id: "mapEditor.script.picker.regionName", message: "Region {number}" }),
    nation: msg({ id: "mapEditor.script.picker.nation", message: "Nation" }),
    anyNation: msg({ id: "mapEditor.script.picker.anyNation", message: "any nation" }),
    rank: msg({ id: "mapEditor.script.picker.rank", message: "Rank" }),
    anyRank: msg({ id: "mapEditor.script.picker.anyRank", message: "any rank" }),
    owner: msg({ id: "mapEditor.script.picker.owner", message: "Owner" }),
    region: msg({ id: "mapEditor.script.picker.region", message: "In region" }),
    noRegion: msg({ id: "mapEditor.script.picker.noRegion", message: "anywhere" }),
    number: msg({ id: "mapEditor.script.picker.number", message: "Number" }),
    text: msg({ id: "mapEditor.script.picker.text", message: "Text" }),
    textLanguage: msg({ id: "mapEditor.script.picker.textLanguage", message: "Text ({language})" }),
    nothingHere: msg({ id: "mapEditor.script.picker.nothingHere", message: "Nothing to choose here yet." }),
    search: msg({ id: "mapEditor.script.picker.search", message: "Search" }),
    catalogTabs: msg({ id: "mapEditor.script.picker.catalogTabs", message: "Catalog kinds" }),
    familyMembers: msg({
      id: "mapEditor.script.picker.familyMembers",
      message: "{count, plural, one {# type} other {# types}}"
    }),
    catalogTab: {
      settlers: msg({ id: "mapEditor.script.picker.catalog.settlers", message: "Settlers" }),
      soldiers: msg({ id: "mapEditor.script.picker.catalog.soldiers", message: "Soldiers" }),
      buildings: msg({ id: "mapEditor.script.picker.catalog.buildings", message: "Buildings" }),
      ships: msg({ id: "mapEditor.script.picker.catalog.ships", message: "Ships" }),
      animals: msg({ id: "mapEditor.script.picker.catalog.animals", message: "Animals" }),
      nature: msg({ id: "mapEditor.script.picker.catalog.nature", message: "Nature" }),
      doodads: msg({ id: "mapEditor.script.picker.catalog.doodads", message: "Doodads" }),
      wares: msg({ id: "mapEditor.script.picker.catalog.wares", message: "Wares" })
    }
  },
  actors: {
    title: msg({ id: "mapEditor.script.actors.title", message: "Actors" }),
    info: msg({
      id: "mapEditor.script.actors.info",
      message: "An actor is one or more map objects the script talks about: bind objects placed on the map, or describe units the script spawns."
    }),
    addSpawn: msg({ id: "mapEditor.script.actors.addSpawn", message: "+ Spawned actor" }),
    bindPlaced: msg({ id: "mapEditor.script.actors.bindPlaced", message: "+ Placed object (pick on map)" }),
    empty: msg({ id: "mapEditor.script.actors.empty", message: "No actor yet." }),
    name: msg({ id: "mapEditor.script.actors.name", message: "Actor name (editor only)" }),
    displayName: msg({ id: "mapEditor.script.actors.displayName", message: "Name shown to players" }),
    shownAs: msg({ id: "mapEditor.script.actors.shownAs", message: "{name} — shown as “{displayName}”" }),
    placed: msg({
      id: "mapEditor.script.actors.placed",
      message: "Placed: {count, plural, one {# object} other {# objects}}"
    }),
    spawned: msg({ id: "mapEditor.script.actors.spawned", message: "Spawned: {count} × {type}" }),
    type: msg({ id: "mapEditor.script.actors.type", message: "Type" }),
    count: msg({ id: "mapEditor.script.actors.count", message: "Count" }),
    owner: msg({ id: "mapEditor.script.actors.owner", message: "Owner" }),
    place: msg({ id: "mapEditor.script.actors.place", message: "Spawn region" }),
    look: msg({ id: "mapEditor.script.actors.look", message: "Look" }),
    spawnAtStart: msg({ id: "mapEditor.script.actors.spawnAtStart", message: "Present at map start" }),
    hiddenAtStart: msg({ id: "mapEditor.script.actors.hiddenAtStart", message: "Invisible until it appears" }),
    clearOnGone: msg({ id: "mapEditor.script.actors.clearOnGone", message: "Forget it when it is gone" }),
    addObject: msg({ id: "mapEditor.script.actors.addObject", message: "Add a map object (pick on map)" }),
    removeObject: msg({ id: "mapEditor.script.actors.removeObject", message: "Remove object #{id}" }),
    object: msg({ id: "mapEditor.script.actors.object", message: "#{id} {name}" }),
    usedBy: msg({ id: "mapEditor.script.actors.usedBy", message: "Used by: {users}" }),
    unused: msg({ id: "mapEditor.script.actors.unused", message: "Not used yet" }),
    delete: msg({ id: "mapEditor.script.actors.delete", message: "Delete actor {name}" }),
    newName: msg({ id: "mapEditor.script.actors.newName", message: "Actor {number}" }),
    neutral: msg({ id: "mapEditor.script.actors.neutral", message: "nobody" }),
    otherContent: msg({
      id: "mapEditor.script.actors.otherContent",
      message: "Every object of an actor has the same type: #{id} is a different type."
    })
  },
  users: {
    actor: msg({ id: "mapEditor.script.users.actor", message: "actor “{name}”" }),
    quest: msg({ id: "mapEditor.script.users.quest", message: "quest “{name}”" }),
    reward: msg({ id: "mapEditor.script.users.reward", message: "home reward “{name}”" }),
    trigger: msg({ id: "mapEditor.script.users.trigger", message: "trigger “{name}”" }),
    variable: msg({ id: "mapEditor.script.users.variable", message: "variable “{name}”" })
  },
  templates: {
    title: msg({ id: "mapEditor.script.templates.title", message: "Insert a template" }),
    insert: msg({ id: "mapEditor.script.templates.insert", message: "Insert" }),
    cancel: msg({ id: "mapEditor.script.templates.cancel", message: "Cancel" }),
    inserted: msg({
      id: "mapEditor.script.templates.inserted",
      message: "Inserted \"{name}\"; edit the new trigger(s) as needed."
    }),
    count: msg({ id: "mapEditor.script.templates.count", message: "How many" }),
    seconds: msg({ id: "mapEditor.script.templates.seconds", message: "Seconds" }),
    board: msg({ id: "mapEditor.script.templates.board", message: "Progress board" }),
    faction: msg({ id: "mapEditor.script.templates.faction", message: "Enemy" }),
    goal: msg({ id: "mapEditor.script.templates.goal", message: "Win by" }),
    goals: {
      capture: msg({ id: "mapEditor.script.templates.goal.capture", message: "taking every enemy building" }),
      defeat: msg({ id: "mapEditor.script.templates.goal.defeat", message: "defeating every enemy soldier" })
    },
    labels: {
      killCounter: msg({ id: "mapEditor.script.templates.label.killCounter", message: "Kill counter" }),
      collectCounter: msg({ id: "mapEditor.script.templates.label.collectCounter", message: "Collect counter" }),
      areaReached: msg({ id: "mapEditor.script.templates.label.areaReached", message: "Area reached" }),
      guardLost: msg({ id: "mapEditor.script.templates.label.guardLost", message: "Guard lost" }),
      chiefFlees: msg({ id: "mapEditor.script.templates.label.chiefFlees", message: "Chief flees" }),
      fledVictory: msg({ id: "mapEditor.script.templates.label.fledVictory", message: "Fled → victory" }),
      escortedArcher: msg({ id: "mapEditor.script.templates.label.escortedArcher", message: "Escorted archer" }),
      protectedGuard: msg({ id: "mapEditor.script.templates.label.protectedGuard", message: "Protected guard" }),
      enemyChief: msg({ id: "mapEditor.script.templates.label.enemyChief", message: "Enemy chief" }),
      escapeShip: msg({ id: "mapEditor.script.templates.label.escapeShip", message: "Escape ship" }),
      goalArea: msg({ id: "mapEditor.script.templates.label.goalArea", message: "Goal area" }),
      escortStart: msg({ id: "mapEditor.script.templates.label.escortStart", message: "Escort start" }),
      escortGoal: msg({ id: "mapEditor.script.templates.label.escortGoal", message: "Escort goal" }),
      guardPost: msg({ id: "mapEditor.script.templates.label.guardPost", message: "Guard post" }),
      enemyHarbour: msg({ id: "mapEditor.script.templates.label.enemyHarbour", message: "Enemy harbour" }),
      plantCounter: msg({ id: "mapEditor.script.templates.label.plantCounter", message: "Planting counter" }),
      buildCounter: msg({ id: "mapEditor.script.templates.label.buildCounter", message: "Building counter" }),
      deadlineCounter: msg({ id: "mapEditor.script.templates.label.deadlineCounter", message: "Deadline counter" }),
      deadlineExpired: msg({ id: "mapEditor.script.templates.label.deadlineExpired", message: "Deadline passed" }),
      deadlineMet: msg({ id: "mapEditor.script.templates.label.deadlineMet", message: "Deadline met" }),
      holdEntered: msg({ id: "mapEditor.script.templates.label.holdEntered", message: "Hold: soldiers inside" }),
      holdAbandoned: msg({ id: "mapEditor.script.templates.label.holdAbandoned", message: "Hold: region abandoned" }),
      holdDone: msg({ id: "mapEditor.script.templates.label.holdDone", message: "Hold: time is up" }),
      holdArea: msg({ id: "mapEditor.script.templates.label.holdArea", message: "Held region" }),
      sellCounter: msg({ id: "mapEditor.script.templates.label.sellCounter", message: "Sale counter" }),
      aiWakeUp: msg({ id: "mapEditor.script.templates.label.aiWakeUp", message: "Enemy wakes up" }),
      aiAttackOnBuild: msg({ id: "mapEditor.script.templates.label.aiAttackOnBuild", message: "Enemy attacks" }),
      aiResume: msg({ id: "mapEditor.script.templates.label.aiResume", message: "Enemy AI resumes" }),
      aiRampUp: msg({ id: "mapEditor.script.templates.label.aiRampUp", message: "Enemy grows harder" }),
      aiDefendBorder: msg({ id: "mapEditor.script.templates.label.aiDefendBorder", message: "Enemy defends" }),
      aiBorder: msg({ id: "mapEditor.script.templates.label.aiBorder", message: "Enemy border" }),
      aiExpandAfter: msg({ id: "mapEditor.script.templates.label.aiExpandAfter", message: "Enemy expands" })
    },
    startName: msg({ id: "mapEditor.script.templates.startName", message: "{name} · start" }),
    newRegion: msg({ id: "mapEditor.script.templates.newRegion", message: "a new region at the map centre" }),
    killCounter: {
      name: msg({ id: "mapEditor.script.templates.killCounter.name", message: "Kill counter" }),
      description: msg({
        id: "mapEditor.script.templates.killCounter.description",
        message: "Counts kills of a family by Player 1's hunters; a quest completes at N."
      })
    },
    collect: {
      name: msg({ id: "mapEditor.script.templates.collect.name", message: "Collect N" }),
      description: msg({
        id: "mapEditor.script.templates.collect.description",
        message: "Counts delivered wares; a quest with progress completes at N."
      })
    },
    reachArea: {
      name: msg({ id: "mapEditor.script.templates.reachArea.name", message: "Reach area" }),
      description: msg({
        id: "mapEditor.script.templates.reachArea.description",
        message: "A quest succeeds when a unit of Player 1 enters a region."
      })
    },
    escort: {
      name: msg({ id: "mapEditor.script.templates.escort.name", message: "Escort" }),
      description: msg({
        id: "mapEditor.script.templates.escort.description",
        message: "An escorted actor must reach a region; the quest fails when it is gone."
      })
    },
    protect: {
      name: msg({ id: "mapEditor.script.templates.protect.name", message: "Protect" }),
      description: msg({
        id: "mapEditor.script.templates.protect.description",
        message: "Keep an actor alive for T seconds; the quest fails when it is gone."
      })
    },
    plantBoard: {
      name: msg({ id: "mapEditor.script.templates.plantBoard.name", message: "Plant N with a board" }),
      description: msg({
        id: "mapEditor.script.templates.plantBoard.description",
        message: "Counts trees Player 1 plants; a board shows the progress while the quest runs and hides at the claim."
      })
    },
    fleeVictory: {
      name: msg({ id: "mapEditor.script.templates.fleeVictory.name", message: "Enemy flees by ship → victory" }),
      description: msg({
        id: "mapEditor.script.templates.fleeVictory.description",
        message: "When a quest succeeds, the enemy chief boards a ship and sails off; 4 s after it left the map, victory."
      })
    },
    buildCount: {
      name: msg({ id: "mapEditor.script.templates.buildCount.name", message: "Build X buildings" }),
      description: msg({
        id: "mapEditor.script.templates.buildCount.description",
        message: "Counts finished buildings of a type; a quest completes at X, with an optional progress board."
      })
    },
    collectDeadline: {
      name: msg({ id: "mapEditor.script.templates.collectDeadline.name", message: "Collect Y by a deadline" }),
      description: msg({
        id: "mapEditor.script.templates.collectDeadline.description",
        message: "Counts produced wares against a timer; a board shows both and the quest fails when time is up."
      })
    },
    captureIsland: {
      name: msg({ id: "mapEditor.script.templates.captureIsland.name", message: "Capture the island" }),
      description: msg({
        id: "mapEditor.script.templates.captureIsland.description",
        message: "Take every enemy building or beat every enemy, then claim the quest to win; lost when Player 1 falls."
      })
    },
    holdRegion: {
      name: msg({ id: "mapEditor.script.templates.holdRegion.name", message: "Hold a region" }),
      description: msg({
        id: "mapEditor.script.templates.holdRegion.description",
        message: "A countdown runs while Player 1's soldiers stand in a region and pauses when they leave."
      })
    },
    tradeQuest: {
      name: msg({ id: "mapEditor.script.templates.tradeQuest.name", message: "Trade quest: sell N" }),
      description: msg({
        id: "mapEditor.script.templates.tradeQuest.description",
        message: "Counts wares sold at the trade office; a quest with progress completes at N."
      })
    },
    aiWakeUp: {
      name: msg({ id: "mapEditor.script.templates.aiWakeUp.name", message: "Enemy wakes up after N seconds" }),
      description: msg({
        id: "mapEditor.script.templates.aiWakeUp.description",
        message: "A sleeping computer player starts to maintain its camp after N seconds (or to develop, with the mode)."
      })
    },
    aiAttackOnBuild: {
      name: msg({ id: "mapEditor.script.templates.aiAttackOnBuild.name", message: "Enemy attacks when you build" }),
      description: msg({
        id: "mapEditor.script.templates.aiAttackOnBuild.description",
        message: "A computer player attacks once Player 1 finishes a building of a type (or a bridge, with the event)."
      })
    },
    aiPauseDuringQuest: {
      name: msg({ id: "mapEditor.script.templates.aiPauseDuringQuest.name", message: "Enemy rests during a quest" }),
      description: msg({
        id: "mapEditor.script.templates.aiPauseDuringQuest.description",
        message: "A quest of N seconds pauses a computer player's AI; it resumes when the quest succeeds or fails."
      })
    },
    aiRampUp: {
      name: msg({ id: "mapEditor.script.templates.aiRampUp.name", message: "Enemy grows harder over time" }),
      description: msg({
        id: "mapEditor.script.templates.aiRampUp.description",
        message: "A computer player starts easy, turns medium after N seconds and hard after another N."
      })
    },
    aiDefendBorder: {
      name: msg({ id: "mapEditor.script.templates.aiDefendBorder.name", message: "Enemy defends its border" }),
      description: msg({
        id: "mapEditor.script.templates.aiDefendBorder.description",
        message: "When Player 1 places a building inside a region, a computer player defends that region for N seconds."
      })
    },
    aiExpandAfter: {
      name: msg({ id: "mapEditor.script.templates.aiExpandAfter.name", message: "Enemy expands after N seconds" }),
      description: msg({
        id: "mapEditor.script.templates.aiExpandAfter.description",
        message: "After N seconds a computer player turns to expanding its settlement."
      })
    }
  }
};
