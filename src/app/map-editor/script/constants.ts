import type { ContentKind } from "@shared/catalog";

/** Constants of the map editor's Script workspace (trigger editor and actor panel, lane TRG11). */

/** Id prefixes of `MapScript.nextIds` counters: ids are `<prefix>-<n>` and never reused. */
export const SCRIPT_ID_PREFIXES = {
  actor: "actor",
  folder: "folder",
  region: "region",
  reward: "reward",
  trigger: "trigger",
  variable: "var"
} as const;

/** Base of the fallback random script uid (letters and digits) when `crypto.randomUUID` is missing. */
export const RANDOM_ID_RADIX = 36;

/** Step ids inside one action list: `s<n>`. */
export const STEP_ID_PREFIX = "s";

/** A region made by "pick on map": a circle of this radius (cells) around the clicked point. */
export const PICKED_REGION_RADIUS = 4;

/** "Pick on map" binds the nearest authored object within this distance (cells), like the Units selection. */
export const PICK_OBJECT_DISTANCE = 5;

/** Undo steps of script edits kept by the workspace. */
export const SCRIPT_UNDO_LIMIT = 100;

/** Default timeout of a "wait until done" step (seconds). */
export const DEFAULT_WAIT_TIMEOUT_SECONDS = 60;

/** Default bound of a `forEach` loop. */
export const DEFAULT_FOR_EACH_MAX = 64;

/** The loop variable name a new `forEach` / `forRange` step uses. */
export const DEFAULT_LOOP_NAME = "item";

/** Filter of the trigger list. */
export const TRIGGER_LIST_FILTERS = ["all", "errors", "disabled"] as const;
export type TriggerListFilter = (typeof TRIGGER_LIST_FILTERS)[number];

/** Clipboard payload marker (copy/paste across triggers and maps, design §13.2). */
export const SCRIPT_CLIPBOARD_FORMAT = "island-of-settlers-script-clipboard";

/** Concurrency choices of the Advanced section, in display order. */
export const TRIGGER_CONCURRENCY = ["queue", "parallel", "ignore"] as const;

/** Human player faction (Player 1) and the highest player slot offered in player pickers. */
export const HUMAN_FACTION = 0;
export const PLAYER_SLOTS_OFFERED = 8;

/** Event groups of the "+ event" list (design §5.1 sections), each listing catalogue kinds. */
export const EVENT_GROUPS = {
  engine: [
    "mapStarted", "elapsedTime", "periodic", "clockHour", "calendarMoment", "scriptUpdated", "timerExpired",
    "variableChanged", "questActivated", "questSucceeded", "questFailed", "questClaimed", "questExpired",
    "sequenceStarted", "sequenceFinished", "sequenceSkipped", "actionOutcome", "playerDefeated", "victoryReached"
  ],
  units: [
    "actorAppeared", "actorGone", "actorKilled", "actorDamaged", "enteredRegion", "leftRegion", "cameNear",
    "cameNearMoving", "soldierRecruited", "soldierPromoted", "settlerBorn", "jobAssigned", "toolReceived",
    "enteredBuilding", "leftBuilding", "garrisoned", "leftGarrison", "boardedShip", "disembarked", "warePickedUp",
    "warePutDown", "wareDelivered", "actorClicked", "scoutLooked", "commanderIncapacitated", "commanderRecovered",
    "seenByPlayer"
  ],
  buildings: [
    "constructionPlaced", "constructionCompleted", "buildingUpgraded", "buildingDestroyed", "wareProduced",
    "outputPickedUp", "buildingOccupied", "catapultFired", "catapultHit", "catapultMissed", "bridgeCompleted",
    "bridgeStepped", "stockReached"
  ],
  trade: ["wareBought", "wareSold", "tradeDeliveryArrived"],
  ships: [
    "shipDeparted", "shipStopped", "shipReachedRegion", "shipDocked", "actorUnloaded", "wareLoaded", "wareUnloaded",
    "shipLeftMap", "shipSunk"
  ],
  nature: [
    "treeCut", "treeGrowthStage", "treePlanted", "stonePickedUp", "depositMined", "shellPickedUp", "animalKilled",
    "animalCollected", "animalGrewUp", "presentationSpawned", "presentationClipDone", "presentationDespawned"
  ],
  colony: [
    "colonyConquered", "colonyDefeated", "colonyAbandoned", "factionBuildingStarted", "factionBuildingCompleted",
    "factionAttackLaunched"
  ]
} as const;
export type EventGroupId = keyof typeof EVENT_GROUPS;

/** Action groups of the "+ action" list (design §5.2 sections). */
export const ACTION_GROUPS = {
  presence: ["spawn", "appear", "fade", "despawn", "kill", "killCount", "setOwner", "hide", "setInvulnerable"],
  units: [
    "move", "teleport", "face", "lookSpyglass", "enterBuilding", "leaveBuilding", "boardShip", "disembark",
    "attack", "dealDamage", "takeDamage", "cutTree", "pickUp", "putDown", "carryInto", "loadIntoShip", "playClip",
    "speak", "release"
  ],
  buildings: [
    "constructBuilding", "openDoor", "addStock", "catapultTarget", "sail", "dock", "spawnAboard", "unload", "sink"
  ],
  world: [
    "setWeather", "timeOfDay", "lightning", "revealFog", "buildingAvailability", "enemyWave", "setCommanderLevel",
    "setFactionAi", "factionAiPause", "setFactionGoal", "highlightRegion", "spawnPresentation", "playSound",
    "playMusic", "stopMusic", "playSequence"
  ],
  quests: [
    "activateQuest", "completeQuest", "failQuest", "resetQuest", "setQuestVisible", "enableTrigger",
    "disableTrigger", "setVariable", "increaseVariable", "decreaseVariable", "arrayAppend", "arrayRemoveAt",
    "arrayClear", "storeActor", "timerStart", "timerPause", "timerResume", "timerStop"
  ],
  boards: ["showMultiboard", "hideMultiboard", "collapseMultiboard", "expandMultiboard"],
  rewards: ["sendMail", "notify", "grantMapReward", "grantHomeReward", "endMap", "colonyEnd"],
  ui: ["openUi", "closeUi", "highlightUi", "clearHighlights", "focusCamera"]
} as const;
export type ActionGroupId = keyof typeof ACTION_GROUPS;

/** Flow steps offered with the catalogue actions (design §4.8). */
export const FLOW_STEP_KINDS = ["wait", "waitUntil", "if", "forEach", "forRange", "repeat", "runTrigger", "stop",
  "comment"] as const;
export type FlowStepKind = (typeof FLOW_STEP_KINDS)[number];

/** Condition rows offered by "+ condition" (predicates are listed separately). */
export const CONDITION_ROW_KINDS = ["compare", "bool", "any", "all", "not"] as const;

/** Content kinds of the catalog picker's tabs (owner: Settlers, Soldiers, Buildings, Ships, Doodads, Wares…). */
export const CATALOG_TABS = {
  settlers: ["settler"],
  soldiers: ["soldier", "commander", "bandit"],
  buildings: ["building"],
  ships: ["ship", "boat"],
  animals: ["animal", "critter", "fish", "whale", "bird", "butterfly"],
  nature: ["tree", "stone", "plant", "shell", "deposit"],
  doodads: ["decoration"],
  wares: ["ware"]
} as const;
export type CatalogTabId = keyof typeof CATALOG_TABS;

/** Every kind the catalog picker shows (a board row icon, a built-in quest goal's type). */
export const CATALOG_KINDS: readonly ContentKind[] = Object.values(CATALOG_TABS).flat();

/** Looks offered beside the catalog nations (owner: pirate and bandit looks). */
export const SPECIAL_LOOKS = ["pirates", "bandits"] as const;

/** The settler whose portrait stands in for jobs without their own (the building details workforce rule). */
export const SETTLER_FALLBACK_PORTRAIT = "settler:carrier";

/**
 * Catalog entries without an icon of their own that borrow a real one: a sibling entry's icon or an editor render.
 * Entries missing here and without an icon show their initial (listed in docs/plans/trg11-2026-11-11.md).
 */
export const ICON_STAND_INS: Readonly<Record<string, string>> = {
  "boat:lighter": "boat:fishingSkiff",
  "deposit:stoneBoulder": "editor-icons/doodad-large-stone.webp",
  "ship:raider": "ship:sailingShip",
  "tree:sparseBirch": "editor-icons/tree-birch.webp",
  "tree:sparseOak": "editor-icons/tree-oak.webp"
};

/**
 * A new comparison or switch condition starts with this unset operand: a variable reference that never exists, so
 * the shape stays valid, the Ready check flags it and the slot shows "choose…" until the author picks a value.
 */
export const UNSET_OPERAND_ID = "unset";

/** Languages with their own catalogue sentences besides English. */
export const HUNGARIAN = "hu";
export const GERMAN = "de";

/**
 * Icons of the workspace's compact icon buttons: keys of the editor's shared action icons (`getActionIcon`), one
 * per meaning. Delete, remove and close share the red cross; copy and paste use the document arrows.
 */
export const SCRIPT_ICONS = {
  add: "camera:plus",
  close: "action:cancel",
  copy: "action:export",
  delete: "action:cancel",
  edit: "action:credits",
  moveDown: "camera:down",
  moveLeft: "camera:left",
  moveRight: "camera:right",
  moveUp: "camera:up",
  paste: "action:import",
  pickOnMap: "action:map",
  previewPlay: "action:musicPlay",
  previewStop: "action:cancel",
  redo: "history-redo",
  remove: "action:demolish",
  testPlay: "action:musicPlay",
  undo: "history-undo",
  upload: "action:import"
} as const;

/** The audio picker's tab of the map's uploaded files, and the file types its upload accepts. */
export const AUDIO_UPLOADS_TAB_ID = "uploads";
export const AUDIO_UPLOAD_ACCEPT = ".ogg,.mp3,audio/ogg,audio/mpeg";
export const AUDIO_ASSET_ID_PREFIX = "audio-";
export type ScriptIconName = keyof typeof SCRIPT_ICONS;

/** Top-level lists whose items own issues: list name → owner prefix (`trigger:<index>` …). */
export const ISSUE_OWNER_LISTS: Readonly<Record<string, string>> = {
  actors: "actor", homeRewards: "homeReward", triggers: "trigger", variables: "variable"
};

/** Path segments that are containers, not slot names. */
export const ISSUE_CONTAINER_SEGMENTS = new Set(["actions", "args", "body", "cond", "conditions", "else", "events", "of",
  "slots", "then", "type", "variable", "actor", "family", "query", "from", "key", "kind"]);

/** Script window tabs a deep link may open, and its page query parameters. */
export const SCRIPT_LINK_TABS = ["triggers", "quests", "variables", "actors", "boards"] as const;
export type ScriptLinkTab = (typeof SCRIPT_LINK_TABS)[number];
export const SCRIPT_LINK_TAB_PARAM = "script";
export const SCRIPT_LINK_ITEM_PARAM = "scriptItem";
export const SCRIPT_LINK_PATH_PARAM = "scriptPath";

/** The tab that edits each issue owner kind (a home reward is declared on the Quests tab). */
export const ISSUE_OWNER_TABS: Readonly<Record<string, ScriptLinkTab>> = {
  actor: "actors", homeReward: "quests", quest: "quests", trigger: "triggers", variable: "variables"
};
