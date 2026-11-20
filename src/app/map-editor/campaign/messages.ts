import { msg } from "@lingui/core/macro";

/** Campaign mode of the editor (C6): labels, actions, confirmations and status copy (en source, hu in the PO). */
export const CAMPAIGN_EDITOR_MESSAGES = {
  check: {
    categories: {
      other: msg({ id: "campaignEditor.check.categories.other", message: "Settings" }),
      path: msg({ id: "campaignEditor.check.categories.path", message: "Campaign paths" }),
      reference: msg({ id: "campaignEditor.check.categories.reference", message: "Broken references" }),
      reward: msg({ id: "campaignEditor.check.categories.reward", message: "Rewards" }),
      script: msg({ id: "campaignEditor.check.categories.script", message: "Script" }),
      translation: msg({ id: "campaignEditor.check.categories.translation", message: "Missing translations" })
    },
    coverage: msg({
      id: "campaignEditor.check.coverage", message: "Checked: the campaign and {checked} of {total} maps."
    }),
    errors: msg({ id: "campaignEditor.check.errors", message: "{count, plural, one {# error} other {# errors}}" }),
    openMapEditor: msg({ id: "campaignEditor.check.openMapEditor", message: "Open the map in the map editor" }),
    openScript: msg({ id: "campaignEditor.check.openScript", message: "Open the script editor at this item" }),
    openTab: msg({ id: "campaignEditor.check.openTab", message: "Go to: {tab}" }),
    path: {
      actor: msg({ id: "campaignEditor.check.path.actor", message: "Actor \"{name}\"" }),
      edge: msg({ id: "campaignEditor.check.path.edge", message: "Path \"{name}\"" }),
      exit: msg({ id: "campaignEditor.check.path.exit", message: "Exit \"{name}\"" }),
      homeReward: msg({ id: "campaignEditor.check.path.homeReward", message: "Home reward \"{name}\"" }),
      map: msg({ id: "campaignEditor.check.path.map", message: "Map \"{name}\"" }),
      quest: msg({ id: "campaignEditor.check.path.quest", message: "Quest \"{name}\"" }),
      speaker: msg({ id: "campaignEditor.check.path.speaker", message: "Speaker \"{name}\"" }),
      trigger: msg({ id: "campaignEditor.check.path.trigger", message: "Trigger \"{name}\"" }),
      variable: msg({ id: "campaignEditor.check.path.variable", message: "Variable \"{name}\"" })
    },
    rawPath: msg({ id: "campaignEditor.check.rawPath", message: "{target}\nField path: {path}" }),
    run: msg({ id: "campaignEditor.check.run", message: "Check the whole campaign" }),
    warnings: msg({
      id: "campaignEditor.check.warnings", message: "{count, plural, one {# warning} other {# warnings}}"
    })
  },
  textTable: {
    cell: msg({ id: "campaignEditor.textTable.cell", message: "{field} ({language})" }),
    exitName: msg({ id: "campaignEditor.textTable.exitName", message: "Exit {position}: name" }),
    missingCount: msg({ id: "campaignEditor.textTable.missingCount", message: "{count} missing" }),
    nothingMissing: msg({ id: "campaignEditor.textTable.nothingMissing", message: "No translation is missing." }),
    onlyMissing: msg({ id: "campaignEditor.textTable.onlyMissing", message: "Only missing" }),
    questText: msg({ id: "campaignEditor.textTable.questText", message: "Quest {subject}: text" }),
    questTitle: msg({ id: "campaignEditor.textTable.questTitle", message: "Quest {subject}: title" }),
    speakerName: msg({ id: "campaignEditor.textTable.speakerName", message: "Speaker {position}: name" }),
    speakLine: msg({ id: "campaignEditor.textTable.speakLine", message: "{subject}: line {position}" }),
    textColumn: msg({ id: "campaignEditor.textTable.textColumn", message: "Text" }),
    undo: msg({ id: "campaignEditor.textTable.undo", message: "Undo the last text edit" })
  },
  actions: {
    addMap: msg({ id: "campaignEditor.actions.addMap", message: "Add map" }),
    addSpeaker: msg({ id: "campaignEditor.actions.addSpeaker", message: "Add speaker (choose its portrait)" }),
    backToMapEditor: msg({ id: "campaignEditor.actions.backToMapEditor", message: "Map editor" }),
    cancel: msg({ id: "campaignEditor.actions.cancel", message: "Cancel" }),
    check: msg({ id: "campaignEditor.actions.check", message: "Check" }),
    closePreview: msg({ id: "campaignEditor.actions.closePreview", message: "Close preview" }),
    create: msg({ id: "campaignEditor.actions.create", message: "New campaign" }),
    delete: msg({ id: "campaignEditor.actions.delete", message: "Delete" }),
    deleteCampaign: msg({ id: "campaignEditor.actions.deleteCampaign", message: "Delete campaign" }),
    deleteMap: msg({ id: "campaignEditor.actions.deleteMap", message: "Delete map" }),
    list: msg({ id: "campaignEditor.actions.list", message: "Add to order" }),
    markDraft: msg({ id: "campaignEditor.actions.markDraft", message: "Back to draft" }),
    markReady: msg({ id: "campaignEditor.actions.markReady", message: "Save as Ready" }),
    moveDown: msg({ id: "campaignEditor.actions.moveDown", message: "Move {name} down" }),
    moveUp: msg({ id: "campaignEditor.actions.moveUp", message: "Move {name} up" }),
    openMap: msg({ id: "campaignEditor.actions.openMap", message: "Open map" }),
    preview: msg({ id: "campaignEditor.actions.preview", message: "Preview" }),
    remove: msg({ id: "campaignEditor.actions.remove", message: "Remove" }),
    removeImage: msg({ id: "campaignEditor.actions.removeImage", message: "Remove image" }),
    rename: msg({ id: "campaignEditor.actions.rename", message: "Rename" }),
    save: msg({ id: "campaignEditor.actions.save", message: "Save" }),
    syncWithServer: msg({ id: "campaignEditor.actions.syncWithServer", message: "Sync with the server" }),
    translate: msg({ id: "campaignEditor.actions.translate", message: "Translations of {field}" }),
    unlist: msg({ id: "campaignEditor.actions.unlist", message: "Remove {name} from the order" }),
    upload: msg({ id: "campaignEditor.actions.upload", message: "Upload image" }),
    uploadFor: msg({ id: "campaignEditor.actions.uploadFor", message: "Upload image: {field}" })
  },
  badges: {
    draft: msg({ id: "campaignEditor.badges.draft", message: "Draft" }),
    ready: msg({ id: "campaignEditor.badges.ready", message: "Ready" }),
    serverConnected: msg({ id: "campaignEditor.badges.serverConnected", message: "Server" }),
    serverFailed: msg({ id: "campaignEditor.badges.serverFailed", message: "Sync failed" }),
    serverNone: msg({ id: "campaignEditor.badges.serverNone", message: "Local only" }),
    unsaved: msg({ id: "campaignEditor.badges.unsaved", message: "Unsaved changes" })
  },
  confirm: {
    deleteCampaignTitle: msg({
      id: "campaignEditor.confirm.deleteCampaignTitle", message: "Delete the campaign \"{name}\"?"
    }),
    deleteImages: msg({
      id: "campaignEditor.confirm.deleteImages", message: "{count, plural, one {# image} other {# images}}"
    }),
    deleteIntro: msg({ id: "campaignEditor.confirm.deleteIntro", message: "This permanently deletes:" }),
    deleteMapFiles: msg({
      id: "campaignEditor.confirm.deleteMapFiles", message: "{count, plural, one {# map file} other {# map files}}"
    }),
    deleteMapRecords: msg({
      id: "campaignEditor.confirm.deleteMapRecords", message: "{count, plural, one {# map} other {# maps}}"
    }),
    deleteMapSaveNote: msg({
      id: "campaignEditor.confirm.deleteMapSaveNote", message: "Unsaved campaign changes are saved first."
    }),
    deleteMapTitle: msg({ id: "campaignEditor.confirm.deleteMapTitle", message: "Delete the map \"{name}\"?" }),
    deleteUndo: msg({ id: "campaignEditor.confirm.deleteUndo", message: "This cannot be undone." }),
    discard: msg({ id: "campaignEditor.confirm.discard", message: "Discard the unsaved changes of this campaign?" }),
    newName: msg({ id: "campaignEditor.confirm.newName", message: "Name of the new campaign (English):" }),
    rename: msg({ id: "campaignEditor.confirm.rename", message: "New English name of the campaign:" })
  },
  expressions: {
    angry: msg({ id: "campaignEditor.expressions.angry", message: "Angry" }),
    happy: msg({ id: "campaignEditor.expressions.happy", message: "Happy" }),
    neutral: msg({ id: "campaignEditor.expressions.neutral", message: "Neutral (required)" }),
    surprised: msg({ id: "campaignEditor.expressions.surprised", message: "Surprised" }),
    worried: msg({ id: "campaignEditor.expressions.worried", message: "Worried" })
  },
  fields: {
    artworkConfirmed: msg({
      id: "campaignEditor.fields.artworkConfirmed",
      message: "Uploads are our own or licence-clean artwork"
    }),
    availableFrom: msg({ id: "campaignEditor.fields.availableFrom", message: "Available from (UTC date)" }),
    availableUntil: msg({ id: "campaignEditor.fields.availableUntil", message: "Available until (UTC date, inclusive)" }),
    description: msg({ id: "campaignEditor.fields.description", message: "Description" }),
    minimumLevel: msg({ id: "campaignEditor.fields.minimumLevel", message: "Minimum player level (0: none)" }),
    name: msg({ id: "campaignEditor.fields.name", message: "Name" }),
    side: msg({ id: "campaignEditor.fields.side", message: "Panel side" }),
    sideLeft: msg({ id: "campaignEditor.fields.sideLeft", message: "Left" }),
    sideRight: msg({ id: "campaignEditor.fields.sideRight", message: "Right" }),
    storyImage: msg({ id: "campaignEditor.fields.storyImage", message: "Story image" }),
    storyText: msg({ id: "campaignEditor.fields.storyText", message: "Text" }),
    storyTitle: msg({ id: "campaignEditor.fields.storyTitle", message: "Title" })
  },
  gameMode: {
    launch: {
      empty: msg({
        id: "campaignEditor.gameMode.launch.empty",
        message: "Nothing ships yet: pick the wares, settlers and soldiers an expedition must bring."
      }),
      pickerTitle: msg({ id: "campaignEditor.gameMode.launch.pickerTitle", message: "Add wares and people" }),
      selected: msg({ id: "campaignEditor.gameMode.launch.selected", message: "Required cargo" }),
      soldierCap: msg({ id: "campaignEditor.gameMode.launch.soldierCap", message: "Soldier cap (0: none)" }),
      soldierCapHint: msg({
        id: "campaignEditor.gameMode.launch.soldierCapHint",
        message: "Most player soldiers on the map; soldiers above it wait in the reserve at home."
      }),
      title: msg({
        id: "campaignEditor.gameMode.launch.title",
        message: "{count, plural, =0 {Launch cargo (empty)} one {Launch cargo (# line)} other {Launch cargo (# lines)}}"
      }),
      titleHint: msg({
        id: "campaignEditor.gameMode.launch.titleHint",
        message: "What an expedition from the home island must ship to start this map."
      })
    },
    rewardNotes: {
      none: msg({
        id: "campaignEditor.gameMode.rewardNotes.none",
        message: "The game settings pay no rewards. Stored reward lines kept: {count}."
      }),
      wallet: msg({
        id: "campaignEditor.gameMode.rewardNotes.wallet",
        message: "Without a home island only gems and XP are paid. Hidden home-bound lines kept: {count}."
      })
    },
    warnings: {
      campaignMapHomeUnlock: msg({
        id: "campaignEditor.gameMode.warnings.homeUnlock",
        message: "No home island: unlock conditions on home goods or buildings are ignored ({count})."
      }),
      campaignMapNoLaunchCargo: msg({
        id: "campaignEditor.gameMode.warnings.noLaunchCargo",
        message: "Home island mode: the launch cargo has no settlers and no soldiers, the expedition would land empty."
      }),
      campaignMapNoRewards: msg({
        id: "campaignEditor.gameMode.warnings.noRewards",
        message: "Home island mode: this map gives no victory rewards."
      })
    }
  },
  notes: {
    emptyList: msg({ id: "campaignEditor.notes.emptyList", message: "No campaign yet. Create the first one." }),
    mapFile: msg({ id: "campaignEditor.notes.mapFile", message: "Map file slot: {slot}" }),
    mapNode: msg({ id: "campaignEditor.notes.mapNode", message: "Map {position}: {name}" }),
    mapView: msg({
      id: "campaignEditor.notes.mapView",
      message: "Drag a node onto the image (arrow keys nudge it). Arrows follow the paths; a ring marks a campaign end."
    }),
    memoryStorage: msg({
      id: "campaignEditor.notes.memoryStorage",
      message: "Browser storage is blocked: changes last only until this page closes."
    }),
    serverNone: msg({
      id: "campaignEditor.notes.serverNone",
      message: "Server sync needs the online service and an administrator sign-in. Campaigns stay in this browser."
    }),
    noImage: msg({ id: "campaignEditor.notes.noImage", message: "No campaign image yet: upload one (owner art only)." }),
    noMapSelected: msg({ id: "campaignEditor.notes.noMapSelected", message: "Select a map in the order first." }),
    noMaps: msg({ id: "campaignEditor.notes.noMaps", message: "The campaign has no maps yet." }),
    noSelection: msg({ id: "campaignEditor.notes.noSelection", message: "Select or create a campaign." }),
    noSpeakers: msg({ id: "campaignEditor.notes.noSpeakers", message: "No speakers yet." }),
    readyEdits: msg({
      id: "campaignEditor.notes.readyEdits",
      message: "This campaign is Ready: saved changes are checked again and return it to draft if they fail."
    }),
    translationMissing: msg({ id: "campaignEditor.notes.translationMissing", message: "Missing: {languages}" }),
    unlisted: msg({ id: "campaignEditor.notes.unlisted", message: "Maps of this campaign outside the order" }),
    uploadLimits: msg({
      id: "campaignEditor.notes.uploadLimits",
      message: "PNG, JPEG or WebP; stored as WebP of at most 1024 px and 300 KB."
    })
  },
  sections: {
    campaigns: msg({ id: "campaignEditor.sections.campaigns", message: "Campaigns" }),
    details: msg({ id: "campaignEditor.sections.details", message: "Details" }),
    epilogue: msg({ id: "campaignEditor.sections.epilogue", message: "Epilogue (victory)" }),
    intro: msg({ id: "campaignEditor.sections.intro", message: "Intro (map start)" }),
    mapSettings: msg({ id: "campaignEditor.sections.mapSettings", message: "Selected map" }),
    maps: msg({ id: "campaignEditor.sections.maps", message: "Maps" }),
    mapView: msg({ id: "campaignEditor.sections.mapView", message: "Campaign map" }),
    order: msg({ id: "campaignEditor.sections.order", message: "Play order" }),
    rewards: msg({ id: "campaignEditor.sections.rewards", message: "Rewards" }),
    speakers: msg({ id: "campaignEditor.sections.speakers", message: "Speakers" }),
    story: msg({ id: "campaignEditor.sections.story", message: "Story" }),
    translations: msg({ id: "campaignEditor.sections.translations", message: "Translations" }),
    tabs: msg({ id: "campaignEditor.sections.tabs", message: "Campaign sections" }),
    title: msg({ id: "campaignEditor.sections.title", message: "Campaign editor" }),
    validation: msg({ id: "campaignEditor.sections.validation", message: "Ready check" })
  },
  status: {
    checked: msg({ id: "campaignEditor.status.checked", message: "{errors} errors, {warnings} warnings." }),
    conflict: msg({
      id: "campaignEditor.status.conflict",
      message: "The campaign changed elsewhere; it was reloaded. Repeat your last change."
    }),
    deleted: msg({ id: "campaignEditor.status.deleted", message: "Deleted \"{name}\"." }),
    failed: msg({ id: "campaignEditor.status.failed", message: "The campaign storage refused the change: {reason}" }),
    imageTooDetailed: msg({
      id: "campaignEditor.status.imageTooDetailed",
      message: "The image does not fit 300 KB even at half size; simplify it."
    }),
    imageTooLarge: msg({ id: "campaignEditor.status.imageTooLarge", message: "The file is larger than 20 MB." }),
    imageUnreadable: msg({
      id: "campaignEditor.status.imageUnreadable",
      message: "The image could not be read or converted to WebP."
    }),
    mapFileMissing: msg({
      id: "campaignEditor.status.mapFileMissing",
      message: "Open the map in the map editor and save it before marking it Ready."
    }),
    mapReady: msg({ id: "campaignEditor.status.mapReady", message: "The map \"{name}\" is Ready." }),
    needsArtworkConfirmation: msg({
      id: "campaignEditor.status.needsArtworkConfirmation",
      message: "Confirm that the upload is our own or licence-clean artwork first."
    }),
    notReady: msg({
      id: "campaignEditor.status.notReady",
      message: "Not Ready: fix the errors listed in the Ready check."
    }),
    ready: msg({ id: "campaignEditor.status.ready", message: "The campaign is Ready." }),
    returnedToDraft: msg({
      id: "campaignEditor.status.returnedToDraft",
      message: "Saved, but the Ready check failed: the campaign is a draft again."
    }),
    saved: msg({ id: "campaignEditor.status.saved", message: "Saved." }),
    syncConflicts: msg({
      id: "campaignEditor.status.syncConflicts",
      message: "{summary} Changed on both sides, the newest revision was kept: {names}."
    }),
    syncFailed: msg({ id: "campaignEditor.status.syncFailed", message: "The server sync failed: {reason}" }),
    syncKeptLocal: msg({ id: "campaignEditor.status.syncKeptLocal", message: "\"{name}\" (this browser's copy)" }),
    syncKeptServer: msg({ id: "campaignEditor.status.syncKeptServer", message: "\"{name}\" (the server's copy)" }),
    syncNeedsSave: msg({
      id: "campaignEditor.status.syncNeedsSave", message: "Save or discard your changes before syncing."
    }),
    syncUnchanged: msg({
      id: "campaignEditor.status.syncUnchanged", message: "This browser and the server already hold the same campaigns."
    }),
    synced: msg({
      id: "campaignEditor.status.synced",
      message: "Synced with the server: {sent} sent, {received} received, {removed} deleted."
    }),
    uploaded: msg({ id: "campaignEditor.status.uploaded", message: "Image stored ({width} × {height}, {size})." })
  },
  validation: {
    campaign: msg({ id: "campaignEditor.validation.campaign", message: "Campaign" }),
    empty: msg({ id: "campaignEditor.validation.empty", message: "Run Check or Save as Ready to list problems." }),
    error: msg({ id: "campaignEditor.validation.error", message: "Error" }),
    passed: msg({ id: "campaignEditor.validation.passed", message: "No problems found." }),
    warning: msg({ id: "campaignEditor.validation.warning", message: "Warning" })
  }
};
