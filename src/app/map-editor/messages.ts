// oxlint-disable max-lines -- one feature-owned catalog keeps IDs and Hungarian drafts reviewable together.
import type { I18n, MessageDescriptor, Values } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translateMessage } from "../../shared/i18n/translate";

/** Copy that is either source text (tests, logs) or a descriptor resolved in the active locale. */
export type EditorText = string | MessageDescriptor | EditorMessage;

export type EditorValue = boolean | number | string | MessageDescriptor | EditorMessage;

export interface EditorMessage {
  descriptor: MessageDescriptor;
  values?: Record<string, EditorValue>;
}

/** A message descriptor with the values of this occurrence (resolved only at render/draw time). */
export const editorMessage = (
  descriptor: MessageDescriptor, values?: Record<string, EditorValue>
): EditorMessage => (values ? { descriptor, values } : { descriptor });

const isEditorMessage = (value: unknown): value is EditorMessage =>
  typeof value === "object" && value !== null && "descriptor" in value;

const isMessageDescriptor = (value: unknown): value is MessageDescriptor =>
  typeof value === "object" && value !== null && !isEditorMessage(value) &&
  ("id" in value || "message" in value);

/** The English source of a text, used where stable labels drive icon inference or automation. */
export const editorTextSource = (value: EditorText): string => {
  if (typeof value === "string") return value;
  const descriptor = isEditorMessage(value) ? value.descriptor : value;
  return descriptor.message ?? descriptor.id;
};

/** Resolve nested message values in the active locale before interpolating the complete message. */
const resolveValues = (i18n: I18n | undefined, values: EditorMessage["values"]) => {
  if (!values) return undefined;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key, isEditorMessage(value) || isMessageDescriptor(value) ? resolveEditorText(i18n, value) : value
  ])) as Values;
};

/** Resolve a text in the active locale; plain strings (shared diagnostics) pass through unchanged. */
export const resolveEditorText = (i18n: I18n | undefined, value: EditorText | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (isEditorMessage(value)) return translateMessage(i18n, value.descriptor, resolveValues(i18n, value.values));
  return translateMessage(i18n, value);
};

/** Map editor panel, tool, status and overlay copy; resolved in the active Lingui locale. */
export const MAP_EDITOR_MESSAGES = {
  catapultInspector: {
    total: msg({ id: "mapEditor.catapultInspector.total", message: "Total stones" }),
    invalid: msg({ id: "mapEditor.catapultInspector.invalid", message: "Check whole-number counts, stone capacity and the required Heavy soldier." }),
    title: msg({ id: "mapEditor.catapultInspector.title", message: "Selected Catapult" }),
    roof: msg({ id: "mapEditor.catapultInspector.roof", message: "Stones on roof" }),
    ground: msg({ id: "mapEditor.catapultInspector.ground", message: "Stones below" }),
    apply: msg({ id: "mapEditor.catapultInspector.apply", message: "Apply Catapult changes" }),
    cancel: msg({ id: "mapEditor.catapultInspector.cancel", message: "Cancel Catapult changes" }),
    help: msg({ id: "mapEditor.catapultInspector.help", message: "One civilian porter is created separately. A nonempty crew needs a Heavy soldier. Roof capacity: 2 stones; total capacity: 6 stones." })
  },
  actions: {
    addPatrolPoint: msg({ id: "mapEditor.actions.addPatrolPoint", message: "Add patrol waypoint" }),
    apply: msg({ id: "mapEditor.actions.apply", message: "Apply" }),
    applyCoast: msg({
      id: "mapEditor.actions.applyCoast",
      message: "Apply previewed coast reshape"
    }),
    applyDecoration: msg({ id: "mapEditor.actions.applyDecoration", message: "Apply decoration transform" }),
    applyDepositAmount: msg({ id: "mapEditor.actions.applyDepositAmount", message: "Apply deposit amount" }),
    applyDepositMaterial: msg({ id: "mapEditor.actions.applyDepositMaterial", message: "Apply deposit material" }),
    applyFeature: msg({ id: "mapEditor.actions.applyFeature", message: "Apply feature position and size" }),
    applyMapTime: msg({ id: "mapEditor.actions.applyMapTime", message: "Apply map time and weather" }),
    applyRiverSize: msg({ id: "mapEditor.actions.applyRiverSize", message: "Apply river width/depth" }),
    applyRules: msg({ id: "mapEditor.actions.applyRules", message: "Apply scenario rules" }),
    publishStarter: msg({
      id: "mapEditor.actions.publishStarter",
      message: "Publish as shared starter map"
    }),
    rollbackStarter: msg({
      id: "mapEditor.actions.rollbackStarter",
      message: "Roll back the shared starter to this revision"
    }),
    applySelectedEnemy: msg({
      id: "mapEditor.actions.applySelectedEnemy",
      message: "Apply selected enemy settings"
    }),
    cancelCoastPreview: msg({
      id: "mapEditor.actions.cancelCoastPreview",
      message: "Cancel coast reshape preview"
    }),
    cancelIdentityRecovery: msg({
      id: "mapEditor.actions.cancelIdentityRecovery",
      message: "Cancel original identity recovery"
    }),
    cancelRoadStart: msg({ id: "mapEditor.actions.cancelRoadStart", message: "Cancel road start" }),
    cancelSavedSeed: msg({
      id: "mapEditor.actions.cancelSavedSeed",
      message: "Cancel saved-seed regeneration"
    }),
    captureBaseline: msg({
      id: "mapEditor.actions.captureBaseline",
      message: "Capture named terrain restore baseline"
    }),
    clearContour: msg({
      id: "mapEditor.actions.clearContour",
      message: "Clear generated contour selection"
    }),
    clearPatrol: msg({ id: "mapEditor.actions.clearPatrol", message: "Clear unit patrol" }),
    drawConnectedRiver: msg({
      id: "mapEditor.actions.drawConnectedRiver",
      message: "Draw connected river"
    }),
    drawInfrastructure: msg({
      id: "mapEditor.actions.drawInfrastructure",
      message: "Draw selected infrastructure"
    }),
    eraseRiverAtClick: msg({
      id: "mapEditor.actions.eraseRiverAtClick",
      message: "Erase river/waterfalls at click"
    }),
    hideInspection: msg({ id: "mapEditor.actions.hideInspection", message: "Cancel or hide inspection" }),
    hideNavigation: msg({ id: "mapEditor.actions.hideNavigation", message: "Hide navigation overlay" }),
    hideOriginalSource: msg({
      id: "mapEditor.actions.hideOriginalSource",
      message: "Hide original source outline"
    }),
    inspectConnectivity: msg({
      id: "mapEditor.actions.inspectConnectivity",
      message: "Inspect island connectivity and economy space"
    }),
    inspectFishingShore: msg({
      id: "mapEditor.actions.inspectFishingShore",
      message: "Inspect local fishing shore and casts"
    }),
    inspectNavigation: msg({
      id: "mapEditor.actions.inspectNavigation",
      message: "Inspect navigation at view centre"
    }),
    moveDeposit: msg({ id: "mapEditor.actions.moveDeposit", message: "Move selected deposit" }),
    moveRiverMouth: msg({ id: "mapEditor.actions.moveRiverMouth", message: "Move selected mouth" }),
    moveRiverSource: msg({ id: "mapEditor.actions.moveRiverSource", message: "Move selected source" }),
    moveSelected: msg({ id: "mapEditor.actions.moveSelected", message: "Move selected" }),
    moveSelectedDecoration: msg({
      id: "mapEditor.actions.moveSelectedDecoration",
      message: "Move selected decoration to click"
    }),
    moveSelectedHq: msg({
      id: "mapEditor.actions.moveSelectedHq",
      message: "Move selected HQ or landing"
    }),
    moveSelectedWaypoint: msg({
      id: "mapEditor.actions.moveSelectedWaypoint",
      message: "Move selected waypoint"
    }),
    moveSelectedContour: msg({
      id: "mapEditor.actions.transformContour",
      message: "Move / resize selected contour"
    }),
    normalTime: msg({ id: "mapEditor.actions.normalTime", message: "Use normal time and weather" }),
    paintBiome: msg({ id: "mapEditor.actions.paintBiome", message: "Paint selected biome" }),
    localBiomeTree: msg({
      id: "mapEditor.actions.localBiomeTree",
      message: "Place tree for local biome"
    }),
    nextOriginalSource: msg({
      id: "mapEditor.actions.nextOriginalSource",
      message: "Next overlapping original source"
    }),
    placeDecoration: msg({ id: "mapEditor.actions.placeDecoration", message: "Place decoration on map" }),
    placeStoneDeposit: msg({
      id: "mapEditor.actions.placeStoneDeposit",
      message: "Place {stone} deposit"
    }),
    placeEnemyBuilding: msg({
      id: "mapEditor.actions.placeEnemyBuilding",
      message: "Place enemy building"
    }),
    placeEnemyGroup: msg({ id: "mapEditor.actions.placeEnemyGroup", message: "Place enemy group" }),
    placeHq: msg({ id: "mapEditor.actions.placeHq", message: "Place HQ" }),
    placeLanding: msg({ id: "mapEditor.actions.placeLanding", message: "Place landing" }),
    playMap: msg({ id: "mapEditor.actions.playMap", message: "Play authored map" }),
    previewCoast: msg({
      id: "mapEditor.actions.previewCoast",
      message: "Preview coast reshape at view centre"
    }),
    recoverIdentities: msg({
      id: "mapEditor.actions.recoverIdentities",
      message: "Recover original identities from exact saved recipe"
    }),
    refreshFeatures: msg({ id: "mapEditor.actions.refreshFeatures", message: "Refresh feature list" }),
    refreshOre: msg({ id: "mapEditor.actions.refreshOre", message: "Refresh ore quantities" }),
    regenerateContour: msg({
      id: "mapEditor.actions.regenerateContour",
      message: "Regenerate selected contour interior from saved seed recipe"
    }),
    regrowBrush: msg({
      id: "mapEditor.actions.regrowBrush",
      message: "Regrow vegetation within view-centred brush"
    }),
    regrowContour: msg({
      id: "mapEditor.actions.regrowContour",
      message: "Regrow vegetation within selected contour"
    }),
    removeDecoration: msg({
      id: "mapEditor.actions.removeDecoration",
      message: "Remove selected decoration"
    }),
    removeDeposit: msg({ id: "mapEditor.actions.removeDeposit", message: "Remove selected deposit" }),
    removeFeature: msg({ id: "mapEditor.actions.removeFeature", message: "Remove selected feature" }),
    removeHarbour: msg({
      id: "mapEditor.actions.removeHarbour",
      message: "Remove harbour reservation"
    }),
    removeRoads: msg({ id: "mapEditor.actions.removeRoads", message: "Remove all authored roads" }),
    removeSelected: msg({ id: "mapEditor.actions.removeSelected", message: "Remove selected" }),
    removeSelectedHq: msg({
      id: "mapEditor.actions.removeSelectedHq",
      message: "Remove selected HQ or landing"
    }),
    removeSelectedRiver: msg({
      id: "mapEditor.actions.removeSelectedRiver",
      message: "Remove selected river and waterfalls"
    }),
    removeWaypoint: msg({
      id: "mapEditor.actions.removeWaypoint",
      message: "Remove selected waypoint"
    }),
    restoreBaseline: msg({
      id: "mapEditor.actions.restoreBaseline",
      message: "Restore selected contour to captured baseline"
    }),
    retryRebuild: msg({ id: "mapEditor.actions.retryRebuild", message: "Retry map rebuild" }),
    rotateSelected: msg({ id: "mapEditor.actions.rotateSelected", message: "Rotate selected" }),
    rotateSelectedHq: msg({ id: "mapEditor.actions.rotateSelectedHq", message: "Rotate selected HQ" }),
    selectAtCentre: msg({
      id: "mapEditor.actions.selectAtCentre",
      message: "Select original source at view centre"
    }),
    selectContourAtCentre: msg({
      id: "mapEditor.actions.selectContourAtCentre",
      message: "Select generated contour at view centre"
    }),
    selectDecoration: msg({
      id: "mapEditor.actions.selectDecoration",
      message: "Select decoration on map"
    }),
    selectHq: msg({ id: "mapEditor.actions.selectHq", message: "Select HQ or landing" }),
    selectOnMap: msg({ id: "mapEditor.actions.selectOnMap", message: "Select on map" }),
    setDepositAmount: msg({
      id: "mapEditor.actions.setDepositAmount",
      message: "Set deposit amount"
    }),
    setDepositMaterial: msg({
      id: "mapEditor.actions.setDepositMaterial",
      message: "Set deposit material"
    }),
    setOrePerCell: msg({ id: "mapEditor.actions.setOrePerCell", message: "Set ore per cell" }),
    setOreTotal: msg({ id: "mapEditor.actions.setOreTotal", message: "Set exact total ore" }),
    shapeFishingLake: msg({
      id: "mapEditor.actions.shapeFishingLake",
      message: "Shape fishing lake habitat"
    }),
    shapeFishingSea: msg({
      id: "mapEditor.actions.shapeFishingSea",
      message: "Shape fishing sea habitat"
    }),
    showLinks: msg({
      id: "mapEditor.actions.showLinks",
      message: "Show/hide selected patrol links"
    }),
    showOriginalSource: msg({
      id: "mapEditor.actions.showOriginalSource",
      message: "Show selected original source"
    }),
    switchToAdventure: msg({
      id: "mapEditor.actions.switchToAdventure",
      message: "Switch scenario to adventure"
    }),
    traceBakedRiver: msg({
      id: "mapEditor.actions.traceBakedRiver",
      message: "Adopt baked river by tracing its channel"
    }),
    transformContour: msg({
      id: "mapEditor.actions.transformContour",
      message: "Move / resize selected contour"
    }),
    validateBeforePlay: msg({
      id: "mapEditor.actions.validateBeforePlay",
      message: "Validate before Play"
    }),
    validatePatrol: msg({ id: "mapEditor.actions.validatePatrol", message: "Validate patrol links" }),
    undo: msg({ id: "mapEditor.actions.undo", message: "Undo (Ctrl+Z)" }),
    redo: msg({ id: "mapEditor.actions.redo", message: "Redo (Ctrl+Y / Ctrl+Shift+Z)" }),
    deleteSlot: msg({ id: "mapEditor.actions.deleteSlot", message: "Delete this saved map" }),
    loadFile: msg({ id: "mapEditor.actions.loadFile", message: "Load map file" }),
    loadSlot: msg({ id: "mapEditor.actions.loadSlot", message: "Load this map" }),
    newSlot: msg({ id: "mapEditor.actions.newSlot", message: "Save in the browser (new slot)" }),
    overwriteSlot: msg({ id: "mapEditor.actions.overwriteSlot", message: "Overwrite with the current map" }),
    backToCampaign: msg({ id: "mapEditor.actions.backToCampaign", message: "Back to the campaign editor" }),
    saveCampaignMap: msg({ id: "mapEditor.actions.saveCampaignMap", message: "Save campaign map" }),
    saveFile: msg({ id: "mapEditor.actions.saveFile", message: "Save main world (World01.smap)" })
  },
  brush: {
    size: msg({ id: "mapEditor.brush.size", message: "Brush size" }),
    sizeLevel: msg({ id: "mapEditor.brush.sizeLevel", message: "{size} cells" }),
    strength: msg({ id: "mapEditor.brush.strength", message: "Brush strength" }),
    strengthLevel: msg({ id: "mapEditor.brush.strengthLevel", message: "{percent} %" }),
    title: msg({ id: "mapEditor.brush.title", message: "Brush" })
  },
  captions: {
    apply: msg({ id: "mapEditor.captions.apply", message: "Apply" }),
    applyRules: msg({ id: "mapEditor.captions.applyRules", message: "Apply rules" }),
    applyToSelected: msg({ id: "mapEditor.captions.applyToSelected", message: "Apply to selected" }),
    cancel: msg({ id: "mapEditor.captions.cancel", message: "Cancel" }),
    cancelRecovery: msg({ id: "mapEditor.captions.cancelRecovery", message: "Cancel recovery" }),
    cancelStart: msg({ id: "mapEditor.captions.cancelStart", message: "Cancel start" }),
    capture: msg({ id: "mapEditor.captions.capture", message: "Capture" }),
    clear: msg({ id: "mapEditor.captions.clear", message: "Clear" }),
    draw: msg({ id: "mapEditor.captions.draw", message: "Draw" }),
    eraseAtClick: msg({ id: "mapEditor.captions.eraseAtClick", message: "Erase at click" }),
    hide: msg({ id: "mapEditor.captions.hide", message: "Hide" }),
    inspect: msg({ id: "mapEditor.captions.inspect", message: "Inspect" }),
    lakeHabitat: msg({ id: "mapEditor.captions.lakeHabitat", message: "Lake habitat" }),
    localBiomeTree: msg({ id: "mapEditor.captions.localBiomeTree", message: "Local biome tree" }),
    move: msg({ id: "mapEditor.captions.move", message: "Move" }),
    movePoint: msg({ id: "mapEditor.captions.movePoint", message: "Move point" }),
    moveToClick: msg({ id: "mapEditor.captions.moveToClick", message: "Move to click" }),
    next: msg({ id: "mapEditor.captions.next", message: "Next" }),
    normalTime: msg({ id: "mapEditor.captions.normalTime", message: "Normal time" }),
    paintBiome: msg({ id: "mapEditor.captions.paintBiome", message: "Paint biome" }),
    place: msg({ id: "mapEditor.captions.place", message: "Place" }),
    placeBuilding: msg({ id: "mapEditor.captions.placeBuilding", message: "Place building" }),
    placeGroup: msg({ id: "mapEditor.captions.placeGroup", message: "Place group" }),
    placeHq: msg({ id: "mapEditor.captions.placeHq", message: "Place HQ" }),
    placeLanding: msg({ id: "mapEditor.captions.placeLanding", message: "Place landing" }),
    play: msg({ id: "mapEditor.captions.play", message: "Play" }),
    preview: msg({ id: "mapEditor.captions.preview", message: "Preview" }),
    recoverIdentities: msg({
      id: "mapEditor.captions.recoverIdentities",
      message: "Recover identities"
    }),
    refresh: msg({ id: "settlement.market.refresh", message: "Refresh" }),
    refreshList: msg({ id: "mapEditor.captions.refreshList", message: "Refresh list" }),
    regenerate: msg({ id: "mapEditor.captions.regenerate", message: "Regenerate" }),
    regrowBrush: msg({ id: "mapEditor.captions.regrowBrush", message: "Regrow in brush" }),
    regrowContour: msg({ id: "mapEditor.captions.regrowContour", message: "Regrow in contour" }),
    remove: msg({ id: "mapEditor.captions.remove", message: "Remove" }),
    removeHarbour: msg({ id: "mapEditor.captions.removeHarbour", message: "Remove harbour" }),
    removePoint: msg({ id: "mapEditor.captions.removePoint", message: "Remove point" }),
    removeRoads: msg({ id: "mapEditor.captions.removeRoads", message: "Remove roads" }),
    restore: msg({ id: "mapEditor.captions.restore", message: "Restore" }),
    retryRebuild: msg({ id: "mapEditor.captions.retryRebuild", message: "Retry rebuild" }),
    rotate: msg({ id: "hud.placement.rotate", message: "Rotate" }),
    seaHabitat: msg({ id: "mapEditor.captions.seaHabitat", message: "Sea habitat" }),
    select: msg({ id: "mapEditor.captions.select", message: "Select" }),
    selectAtCentre: msg({ id: "mapEditor.captions.selectAtCentre", message: "Select at centre" }),
    setAmount: msg({ id: "mapEditor.captions.setAmount", message: "Set amount" }),
    setMaterial: msg({ id: "mapEditor.captions.setMaterial", message: "Set material" }),
    setPerCell: msg({ id: "mapEditor.captions.setPerCell", message: "Set per cell" }),
    setTotal: msg({ id: "mapEditor.captions.setTotal", message: "Set total" }),
    show: msg({ id: "mapEditor.captions.show", message: "Show" }),
    showLinks: msg({ id: "mapEditor.captions.showLinks", message: "Show links" }),
    switchToAdventure: msg({
      id: "mapEditor.captions.switchToAdventure",
      message: "Switch to adventure"
    }),
    traceBakedRiver: msg({
      id: "mapEditor.captions.traceBakedRiver",
      message: "Trace baked river"
    }),
    validate: msg({ id: "mapEditor.captions.validate", message: "Validate" }),
    drawRiver: msg({ id: "mapEditor.captions.drawRiver", message: "Draw river" }),
    moveMouth: msg({ id: "mapEditor.captions.moveMouth", message: "Move mouth" }),
    moveSource: msg({ id: "mapEditor.captions.moveSource", message: "Move source" }),
    applySize: msg({ id: "mapEditor.captions.applySize", message: "Apply size" }),
    moveResize: msg({ id: "mapEditor.captions.moveResize", message: "Move / resize" }),
    setOrePerCell: msg({ id: "mapEditor.captions.setPerCell", message: "Set per cell" }),
    setOreTotal: msg({ id: "mapEditor.captions.setTotal", message: "Set total" }),
    clearPatrol: msg({ id: "mapEditor.captions.clearPatrol", message: "Clear patrol" }),
    addPoint: msg({ id: "mapEditor.captions.addPoint", message: "Add point" }),
    inspectShore: msg({ id: "mapEditor.captions.inspectShore", message: "Inspect shore" }),
    moveToClickDecoration: msg({
      id: "mapEditor.captions.moveToClick",
      message: "Move to click"
    })
  },
  catalog: {
    tile: {
      dirt: msg({ id: "mapEditor.catalog.tile.dirt", message: "Dirt" }),
      forestFloor: msg({ id: "mapEditor.catalog.tile.forestFloor", message: "Forest floor" }),
      grass: msg({ id: "settings.graphics.toggle.grass", message: "Grass" }),
      gravel: msg({ id: "mapEditor.catalog.tile.gravel", message: "Gravel" }),
      lushGrass: msg({ id: "mapEditor.catalog.tile.lushGrass", message: "Clover meadow" }),
      coarseStones: msg({ id: "mapEditor.catalog.tile.coarseStones", message: "Coarse stones" }),
      moss: msg({ id: "mapEditor.catalog.tile.moss", message: "Moss" }),
      swampMud: msg({ id: "mapEditor.catalog.tile.swampMud", message: "Swamp mud" }),
      crackedEarth: msg({ id: "mapEditor.catalog.tile.crackedEarth", message: "Cracked earth" }),
      tilledSoil: msg({ id: "mapEditor.catalog.tile.tilledSoil", message: "Tilled soil" }),
      mineGravel: msg({ id: "mapEditor.catalog.tile.mineGravel", message: "Mine gravel" }),
      rock: msg({ id: "mapEditor.catalog.tile.rock", message: "Rock" }),
      sand: msg({ id: "mapEditor.catalog.tile.sand", message: "Sand" }),
      snow: msg({ id: "settings.weather.snow", message: "Snow" })
    },
    tool: {
      alpineMountain: msg({
        id: "mapEditor.catalog.tool.alpineMountain",
        message: "Alpine mountain"
      }),
      flatten: msg({
        id: "mapEditor.catalog.tool.flatten",
        message: "Flatten to target height"
      }),
      lake: msg({ id: "mapEditor.catalog.tool.lake", message: "Lake" }),
      lowerGround: msg({ id: "mapEditor.catalog.tool.lowerGround", message: "Lower ground" }),
      lowerToggle: msg({
        id: "mapEditor.catalog.tool.lowerToggle",
        message: "Lower: Mountain and Lake clicks take a level back (Ctrl flips it)"
      }),
      mountain: msg({ id: "mapEditor.catalog.tool.mountain", message: "Mountain" }),
      pickHeight: msg({ id: "mapEditor.catalog.tool.pickHeight", message: "Pick terrain height" }),
      quarryStoneBoulder: msg({
        id: "mapEditor.catalog.tool.quarryStoneBoulder",
        message: "Quarry stone boulder"
      }),
      raiseGround: msg({ id: "mapEditor.catalog.tool.raiseGround", message: "Raise ground" }),
      removeMine: msg({
        id: "mapEditor.catalog.tool.removeMine",
        message: "Remove mine zones and ore"
      }),
      removePlants: msg({
        id: "mapEditor.catalog.tool.removePlants",
        message: "Remove objects: trees, plants and stones"
      }),
      removeTree: msg({ id: "mapEditor.catalog.tool.removeTree", message: "Remove tree" }),
      resetGround: msg({ id: "mapEditor.catalog.tool.resetGround", message: "Reset ground" }),
      sandyShore: msg({ id: "mapEditor.catalog.tool.sandyShore", message: "Sandy shore" }),
      sea: msg({ id: "mapEditor.catalog.tool.sea", message: "Sea" }),
      smoothGround: msg({ id: "mapEditor.catalog.tool.smoothGround", message: "Smooth ground" }),
      unevenGround: msg({ id: "mapEditor.catalog.tool.unevenGround", message: "Uneven ground" })
    }
  },
  common: {
    categories: msg({ id: "mapEditor.common.categories", message: "Map editor categories" }),
    close: msg({ id: "mapEditor.common.close", message: "Close map editor" }),
    editHistory: msg({ id: "mapEditor.common.editHistory", message: "Edit history" }),
    howItWorks: msg({ id: "mapEditor.common.howItWorks", message: "How it works" }),
    moveHelp: msg({
      id: "mapEditor.common.moveHelp",
      message: "Left drag edits; Shift + drag, arrow keys or the minimap pan."
    }),
    title: msg({ id: "mapEditor.common.title", message: "Map editor" }),
    loading: msg({ id: "mapEditor.common.loading", message: "Loading {heading}…" }),
    loadFailed: msg({
      id: "mapEditor.common.loadFailed",
      message: "{heading} could not load. Close and reopen to retry."
    })
  },
  coordinate: {
    depositOption: msg({
      id: "mapEditor.coordinate.depositOption",
      message: "{material} {number}: {remaining}"
    }),
    featureOption: msg({
      id: "mapEditor.coordinate.featureOption",
      message: "{kind} {id} · level {level}"
    }),
    generatedFeatureOption: msg({
      id: "mapEditor.coordinate.generatedFeatureOption",
      message: "{kind} #{id}"
    }),
    oreOption: msg({
      id: "mapEditor.coordinate.oreOption",
      message: "{ore} {id} · {total} ore"
    }),
    patrolPointOption: msg({
      id: "mapEditor.coordinate.patrolPointOption",
      message: "{index}: {x}, {z}"
    }),
    patrolUnitOption: msg({
      id: "mapEditor.coordinate.patrolUnitOption",
      message: "Unit {id} · {type} · faction {faction}"
    }),
    riverOption: msg({
      id: "mapEditor.coordinate.riverOption",
      message: "{kind} river {id}"
    }),
    scenarioBuildingOption: msg({
      id: "mapEditor.coordinate.scenarioBuildingOption",
      message: "{name} {id}"
    }),
    scenarioUnitOption: msg({
      id: "mapEditor.scenario.unitEntry",
      message: "{type} {id}"
    })
  },
  errors: {
    withReason: msg({ id: "mapEditor.errors.withReason", message: "{reason}" }),
    rebuildFailed: msg({
      id: "mapEditor.errors.rebuildFailed",
      message: "Map rebuild failed: {reason}. Use Retry map rebuild."
    })
  },
  feature: {
    details: msg({
      id: "mapEditor.feature.details",
      message: "Feature {id}: radius ≈ {radius} tiles. Size levels change the existing profile's width and height/depth together. Moving translates the full ridge/channel."
    }),
    lakeChannel: msg({ id: "mapEditor.feature.lakeChannel", message: "Lake/channel" }),
    mountainRidge: msg({ id: "mapEditor.feature.mountainRidge", message: "Mountain/ridge" }),
    empty: msg({
      id: "mapEditor.feature.empty",
      message: "Create a mountain or lake with the terrain tools to edit it here."
    }),
    originalMassif: msg({ id: "mapEditor.feature.originalMassif", message: "Original massif" }),
    generatedOasis: msg({ id: "mapEditor.feature.generatedOasis", message: "Generated oasis" }),
    phase: msg({ id: "mapEditor.feature.phase", message: "{phase}. Cancel is available." }),
    sourceStatus: msg({
      id: "mapEditor.feature.sourceStatus",
      message: "{source} #{id}: {cells} original generator-support cells. {overlap}This identifies the original input before erosion/composition; it does not recover hidden ground. Use the separate measured-contour selector for current-terrain transforms."
    }),
    overlap: msg({
      id: "mapEditor.feature.overlap",
      message: "{count} original sources overlap the last picked cell. "
    }),
    updated: msg({
      id: "mapEditor.feature.updated",
      message: "Authored terrain feature updated."
    })
  },
  fields: {
    animalAge: msg({ id: "mapEditor.fields.animalAge", message: "Initial animal age" }),
    animalPopulation: msg({
      id: "mapEditor.fields.animalPopulation",
      message: "Animal population per placement"
    }),
    biome: msg({ id: "mapEditor.fields.biome", message: "Terrain biome" }),
    baselineName: msg({ id: "mapEditor.fields.baselineName", message: "Terrain baseline name" }),
    brushRadius: msg({ id: "mapEditor.fields.brushRadius", message: "Coast brush radius" }),
    buildingAppearance: msg({
      id: "mapEditor.fields.buildingAppearance",
      message: "Building appearance"
    }),
    brushStrength: msg({ id: "mapEditor.fields.brushStrength", message: "Coast blend strength" }),
    claimSeconds: msg({ id: "mapEditor.fields.claimSeconds", message: "Claim seconds" }),
    coastFeedback: msg({
      id: "mapEditor.fields.coastFeedback",
      message: "Coast navigation feedback"
    }),
    coastOperation: msg({ id: "mapEditor.fields.coastOperation", message: "Coast reshape operation" }),
    contourKind: msg({ id: "mapEditor.fields.contourKind", message: "Generated terrain contour" }),
    decorationRotation: msg({
      id: "mapEditor.fields.decorationRotation",
      message: "Decoration rotation (degrees)"
    }),
    decorationScale: msg({ id: "mapEditor.fields.decorationScale", message: "Decoration scale" }),
    dayCycle: msg({ id: "mapEditor.fields.dayCycle", message: "Start day cycle" }),
    decorationX: msg({ id: "mapEditor.fields.decorationX", message: "Decoration X" }),
    decorationZ: msg({ id: "mapEditor.fields.decorationZ", message: "Decoration Z" }),
    defenders: msg({ id: "mapEditor.fields.defenders", message: "Defenders" }),
    catapultStones: msg({ id: "mapEditor.fields.catapultStones", message: "Initial Catapult stones (finite)" }),
    density: msg({ id: "mapEditor.fields.regrowthDensity", message: "Vegetation regrowth density" }),
    spacing: msg({ id: "mapEditor.fields.regrowthSpacing", message: "Minimum tree spacing" }),
    depositAmount: msg({ id: "mapEditor.fields.depositAmount", message: "Deposit amount" }),
    depositMaterial: msg({ id: "mapEditor.fields.depositMaterial", message: "Deposit material" }),
    depositX: msg({ id: "mapEditor.fields.depositX", message: "Deposit X" }),
    depositZ: msg({ id: "mapEditor.fields.depositZ", message: "Deposit Z" }),
    editableRiver: msg({ id: "mapEditor.fields.editableRiver", message: "Editable river" }),
    enemyBuilding: msg({ id: "mapEditor.fields.enemyBuilding", message: "Enemy building" }),
    enemyFaction: msg({ id: "mapEditor.fields.enemyFaction", message: "Enemy faction" }),
    enemyTheme: msg({ id: "mapEditor.fields.enemyTheme", message: "Enemy theme" }),
    expirySeconds: msg({
      id: "mapEditor.fields.expirySeconds",
      message: "Expiry seconds (0 = none)"
    }),
    authoredFeature: msg({ id: "mapEditor.fields.authoredFeature", message: "Authored terrain feature" }),
    featureLevel: msg({ id: "mapEditor.fields.featureLevel", message: "Feature size level" }),
    featureX: msg({ id: "mapEditor.fields.featureX", message: "Feature X" }),
    featureZ: msg({ id: "mapEditor.fields.featureZ", message: "Feature Z" }),
    formation: msg({ id: "mapEditor.fields.formation", message: "Group formation" }),
    garrisonMode: msg({ id: "mapEditor.fields.garrisonMode", message: "Garrison mode" }),
    groupCount: msg({ id: "mapEditor.fields.groupCount", message: "Group size" }),
    groupFacing: msg({ id: "mapEditor.fields.groupFacing", message: "Group facing" }),
    groupId: msg({ id: "mapEditor.fields.groupId", message: "Unit group" }),
    groupSpacing: msg({ id: "mapEditor.fields.groupSpacing", message: "Group spacing" }),
    harbourRotation: msg({ id: "mapEditor.fields.harbourRotation", message: "Harbour rotation" }),
    hqRotation: msg({
      id: "mapEditor.fields.hqRotation",
      message: "HQ rotation (quarter turns)"
    }),
    includeRiverCourses: msg({
      id: "mapEditor.fields.includeRiverCourses",
      message: "Include complete connected river courses"
    }),
    infrastructureAction: msg({
      id: "mapEditor.fields.infrastructureAction",
      message: "Infrastructure action"
    }),
    moveEast: msg({ id: "mapEditor.fields.moveEast", message: "Move east (tiles)" }),
    moveSouth: msg({ id: "mapEditor.fields.moveSouth", message: "Move south (tiles)" }),
    name: msg({ id: "mapEditor.fields.name", message: "Name" }),
    navigationLayer: msg({
      id: "mapEditor.fields.navigationLayer",
      message: "Navigation inspection layer"
    }),
    oreHeading: msg({ id: "mapEditor.fields.oreHeading", message: "Ore (on mine gravel)" }),
    orePerCell: msg({ id: "mapEditor.fields.orePerCell", message: "Ore per cell" }),
    oreTotal: msg({ id: "mapEditor.fields.oreTotal", message: "Total ore in deposit" }),
    originalFeature: msg({
      id: "mapEditor.fields.originalFeature",
      message: "Original generated feature"
    }),
    patrolPoint: msg({ id: "mapEditor.fields.patrolPoint", message: "Patrol waypoint" }),
    patrolUnit: msg({ id: "mapEditor.fields.patrolUnit", message: "Patrolling enemy unit" }),
    patrolX: msg({ id: "mapEditor.fields.patrolX", message: "Patrol waypoint X" }),
    patrolZ: msg({ id: "mapEditor.fields.patrolZ", message: "Patrol waypoint Z" }),
    placedDeposit: msg({ id: "mapEditor.fields.placedDeposit", message: "Placed material deposit" }),
    population: msg({ id: "mapEditor.fields.population", message: "Population per placement" }),
    protectCoast: msg({ id: "mapEditor.fields.protectCoast", message: "Protect coast and water" }),
    quantityOption: msg({
      id: "mapEditor.fields.oreQuantityOption",
      message: "Ore deposit quantity"
    }),
    reliefThreshold: msg({
      id: "mapEditor.fields.reliefThreshold",
      message: "Relief contour above sea"
    }),
    rewardCoins: msg({ id: "mapEditor.fields.rewardCoins", message: "Reward coins" }),
    riverDepth: msg({ id: "mapEditor.fields.riverDepth", message: "River depth" }),
    riverDepthMultiplier: msg({
      id: "mapEditor.fields.riverDepthMultiplier",
      message: "River depth multiplier"
    }),
    riverWidth: msg({ id: "mapEditor.fields.riverWidth", message: "River width" }),
    riverWidthMultiplier: msg({
      id: "mapEditor.fields.riverWidthMultiplier",
      message: "River width multiplier"
    }),
    rotation: msg({ id: "mapEditor.fields.rotation", message: "Rotation (quarter turns)" }),
    scenario: msg({ id: "mapEditor.fields.scenario", message: "Scenario" }),
    seed: msg({ id: "mapEditor.fields.regrowthSeed", message: "Vegetation regrowth seed" }),
    sizePercent: msg({ id: "mapEditor.fields.sizePercent", message: "Contour size (%)" }),
    species: msg({ id: "mapEditor.fields.species", message: "Regrowth tree species" }),
    startHour: msg({ id: "mapEditor.fields.startHour", message: "Starting hour (0 to under 24)" }),
    startHourAria: msg({ id: "mapEditor.fields.startHourAria", message: "Starting hour" }),
    startNation: msg({ id: "mapEditor.fields.startNation", message: "Start nation" }),
    startWeather: msg({ id: "mapEditor.fields.startWeather", message: "Starting weather" }),
    rockPalette: msg({ id: "mapEditor.fields.rockPalette", message: "Rock" }),
    sandPalette: msg({ id: "mapEditor.fields.sandPalette", message: "Sand" }),
    soilPalette: msg({ id: "mapEditor.fields.soilPalette", message: "Soil" }),
    targetHeight: msg({
      id: "mapEditor.fields.targetHeight",
      message: "Target height above sea"
    }),
    timberAppearance: msg({
      id: "mapEditor.fields.timberAppearance",
      message: "Timber appearance"
    }),
    treeAge: msg({ id: "mapEditor.fields.treeAge", message: "Initial tree age" }),
    troop: msg({ id: "mapEditor.fields.troop", message: "Troop" }),
    unitRank: msg({ id: "mapEditor.fields.unitRank", message: "Unit rank" }),
    victoryObjective: msg({ id: "mapEditor.fields.victoryObjective", message: "Victory objective" })
  },
  hints: {
    aimAtFeatured: msg({
      id: "mapEditor.hints.aimAtFeatured",
      message: "Aim the view centre at a generated feature."
    }),
    aimAtShore: msg({
      id: "mapEditor.hints.aimAtShore",
      message: "Aim at an in-map shore or island location."
    }),
    aimAtTerrain: msg({
      id: "mapEditor.hints.aimAtTerrain",
      message: "Aim the view centre at terrain first."
    }),
    aimAtTerrainOrShore: msg({
      id: "mapEditor.hints.aimAtTerrainOrShore",
      message: "Aim at terrain or shoreline first."
    }),
    atMostRivers: msg({
      id: "mapEditor.hints.atMostRivers",
      message: "At most {count} authored rivers."
    }),
    chooseDeposit: msg({
      id: "mapEditor.hints.chooseDeposit",
      message: "Select a placed deposit first."
    }),
    chooseEnemyUnit: msg({
      id: "mapEditor.hints.chooseEnemyUnit",
      message: "Choose an authored enemy field unit on an adventure or colony."
    }),
    enemyHqNeedsAi: msg({
      id: "mapEditor.hints.enemyHqNeedsAi",
      message: "Give this faction a computer AI mode before placing its headquarters."
    }),
    chooseWaypointMove: msg({
      id: "mapEditor.hints.chooseWaypointMove",
      message: "Choose a patrol waypoint to move."
    }),
    chooseWaypointRemove: msg({
      id: "mapEditor.hints.chooseWaypointRemove",
      message: "Choose a patrol waypoint to remove."
    }),
    coastApplied: msg({
      id: "mapEditor.hints.coastApplied",
      message: "Coast reshape applied. Undo restores the previous shore."
    }),
    coastApplyFirst: msg({
      id: "mapEditor.hints.coastApplyFirst",
      message: "Preview the current map before applying a coast change."
    }),
    coastPreviewFailed: msg({
      id: "mapEditor.hints.coastPreviewFailed",
      message: "Preview failed."
    }),
    coastEditFailed: msg({
      id: "mapEditor.hints.coastEditFailed",
      message: "Coast edit failed. Undo if any terrain changed."
    }),
    coastPreparing: msg({
      id: "mapEditor.hints.coastPreparing",
      message: "Preparing detached coast/navigation preview…"
    }),
    coastPreviewReady: msg({
      id: "mapEditor.hints.coastPreviewReady",
      message: "Coast preview ready. Apply it or cancel to keep the current shore."
    }),
    coverNone: msg({
      id: "mapEditor.hints.coverNone",
      message: "No grass grows here: paint grass on meadow, lush or forest ground away from roads, plots and water."
    }),
    coverPainted: msg({
      id: "mapEditor.hints.coverPainted",
      message: "Grass painted. The doodad eraser clears it."
    }),
    contourInspectionFailed: msg({
      id: "mapEditor.hints.contourInspectionFailed",
      message: "Contour inspection failed."
    }),
    decorationFirst: msg({
      id: "mapEditor.hints.decorationFirst",
      message: "Select a decoration first."
    }),
    decorationPlaced: msg({
      id: "mapEditor.hints.decorationPlaced",
      message: "Decoration placed."
    }),
    decorationUpdated: msg({
      id: "mapEditor.hints.decorationUpdated",
      message: "Decoration updated."
    }),
    depositAmountSet: msg({
      id: "mapEditor.hints.depositAmountSet",
      message: "Deposit amount set."
    }),
    depositMaterialSet: msg({
      id: "mapEditor.hints.depositMaterialSet",
      message: "Deposit material set."
    }),
    depositRemoved: msg({
      id: "mapEditor.hints.depositRemoved",
      message: "Deposit removed."
    }),
    depositLimit: msg({
      id: "mapEditor.hints.depositLimit",
      message: "A map holds {count} stone deposits: remove one before placing another."
    }),
    depositClick: msg({
      id: "mapEditor.hints.depositClick",
      message: "Click clear dry ground to place the selected deposit."
    }),
    depositPlaced: msg({
      id: "mapEditor.hints.depositPlaced",
      message: "Placed {material} ({remaining}); worked out, it vanishes and grows back here after {minutes} min. Click again for another."
    }),
    colonyStone: msg({
      id: "mapEditor.hints.colonyStone",
      message: "This colony's stone sources are {stone}."
    }),
    depositInvalid: msg({
      id: "mapEditor.hints.depositInvalid",
      message: "This deposit cannot be placed here."
    }),
    depositSite: msg({
      id: "mapEditor.hints.depositSite",
      message: "A stone deposit needs dry, walkable open ground (not water, cliff, mine land or a building plot), 3 cells from another deposit."
    }),
    depositMoved: msg({
      id: "mapEditor.hints.depositMoved",
      message: "Stone source moved; its stable identity and played depletion are preserved."
    }),
    drawRiverHelp: msg({
      id: "mapEditor.hints.drawRiverHelp",
      message: "Drag from the river source downhill to its mouth. Release to carve the complete channel."
    }),
    adoptRiverHelp: msg({
      id: "mapEditor.hints.adoptRiverHelp",
      message: "Trace along existing flowing river water from source to mouth, then release. Adoption preserves all terrain; removing the adopted water later retains its baked bed."
    }),
    riverAdoptFailed: msg({
      id: "mapEditor.hints.riverAdoptFailed",
      message: "Could not adopt this river."
    }),
    riverAdopted: msg({
      id: "mapEditor.hints.riverAdopted",
      message: "Baked river adopted without terrain changes. Width/depth and endpoints now edit its sampled shape; removal retains the original baked bed."
    }),
    riverFailed: msg({
      id: "mapEditor.hints.riverFailed",
      message: "River edit failed. Undo the last change if any terrain changed."
    }),
    riverNoChange: msg({
      id: "mapEditor.hints.riverNoChange",
      message: "The generated river dimensions are unchanged."
    }),
    riverNotConnected: msg({
      id: "mapEditor.hints.riverNotConnected",
      message: "River needs a finite connected channel inside the map, at least half a tile long."
    }),
    riverWait: msg({
      id: "mapEditor.hints.riverWait",
      message: "Wait for the current terrain and navigation rebuild before editing rivers."
    }),
    waterErasureUnavailable: msg({
      id: "mapEditor.hints.waterErasureUnavailable",
      message: "Water erasure is unavailable here."
    }),
    heightPicked: msg({
      id: "mapEditor.hints.heightPicked",
      message: "Height picked. Drag with Flatten to apply it."
    }),
    mapChangedInspect: msg({
      id: "mapEditor.hints.mapChangedInspect",
      message: "Map changed. Inspect again."
    }),
    mapChangedPreview: msg({
      id: "mapEditor.hints.mapChangedPreview",
      message: "Map changed. Preview again for current navigation feedback."
    }),
    mapChangedSelectContour: msg({
      id: "mapEditor.hints.mapChangedSelectContour",
      message: "Terrain changed. Select the contour again."
    }),
    mapChangedSelectOriginal: msg({
      id: "mapEditor.hints.mapChangedSelectOriginal",
      message: "Map changed. Select the original source again."
    }),
    oreInvalid: msg({
      id: "mapEditor.hints.oreInvalid",
      message: "Choose a non-barren deposit and a whole quantity within its current cell capacity."
    }),
    oreApplied: msg({
      id: "mapEditor.hints.oreApplied",
      message: "{total} ore now remains in this deposit. Survey visibility is unchanged."
    }),
    paintOreFirst: msg({
      id: "mapEditor.hints.paintOreFirst",
      message: "Paint an ore deposit on mine gravel first. Empty deposits remain editable."
    }),
    patrolDistinct: msg({
      id: "mapEditor.hints.patrolDistinct",
      message: "Use distinct links at least 1 tile apart, up to {perUnit} per unit and {perScenario} in the scenario."
    }),
    patrolRemoveTooClose: msg({
      id: "mapEditor.hints.patrolRemoveTooClose",
      message: "Removing this waypoint would join links less than one tile apart. Move a link first."
    }),
    patrolSaved: msg({
      id: "mapEditor.hints.patrolSaved",
      message: "Patrol route saved. Validate every link before Play; the last link returns to spawn."
    }),
    patrolReachable: msg({
      id: "mapEditor.hints.patrolReachable",
      message: "Scenario and all patrol links are reachable."
    }),
    recoveryCancelled: msg({
      id: "mapEditor.hints.recoveryCancelled",
      message: "Identity recovery cancelled. The generation worker was stopped."
    }),
    recoveryFailed: msg({
      id: "mapEditor.hints.recoveryFailed",
      message: "Identity recovery failed."
    }),
    recoveryNoIdentities: msg({
      id: "mapEditor.hints.recoveryNoIdentities",
      message: "No original feature identities"
    }),
    recoverySource: msg({
      id: "mapEditor.hints.recoverySource",
      message: "No saved original source identity. Use measured contours or recover an exact recipe."
    }),
    recoverySupportBudget: msg({
      id: "mapEditor.hints.recoverySupportBudget",
      message: "Original support exceeds the 32,768-cell display budget. No partial outline shown."
    }),
    recoveryUnsupportedCell: msg({
      id: "mapEditor.hints.recoveryUnsupportedCell",
      message: "No captured source supports this cell. Current contours remain selectable."
    }),
    recoveryWait: msg({
      id: "mapEditor.hints.recoveryWait",
      message: "Wait for terrain rebuilding or enable the generation worker."
    }),
    recoveryWorking: msg({
      id: "mapEditor.hints.recoveryWorking",
      message: "Recovering source identities only. Cancel or edit the map to discard this result."
    }),
    recoveryDone: msg({
      id: "mapEditor.hints.recoveryDone",
      message: "Recovered {count} original source identities. Terrain, props and paints were kept."
    }),
    selectOriginalFirst: msg({
      id: "mapEditor.hints.selectOriginalFirst",
      message: "Select original sources at the view centre first."
    }),
    featureWait: msg({
      id: "mapEditor.hints.featureWait",
      message: "Wait for the current terrain rebuild before editing a feature."
    }),
    selectContourFirst: msg({
      id: "mapEditor.hints.selectContourFirst",
      message: "Select a complete generated/baked contour first."
    }),
    roadStartCleared: msg({
      id: "mapEditor.hints.roadStartCleared",
      message: "Road start cleared."
    }),
    roadStart: msg({
      id: "mapEditor.hints.roadStart",
      message: "Road start {x}, {z}; click an end."
    }),
    roadClickStart: msg({
      id: "mapEditor.hints.roadClickStart",
      message: "Click the road start, then its end. Routes use the ordinary road construction rules."
    }),
    harbourClick: msg({
      id: "mapEditor.hints.harbourClick",
      message: "Click the centre of a harbour reservation."
    }),
    harbourPasses: msg({
      id: "mapEditor.hints.harbourPasses",
      message: "Harbour plot passes the real shore, ocean and ship turning placement rules."
    }),
    harbourFirst: msg({
      id: "mapEditor.hints.harbourFirst",
      message: "Fix or remove the harbour reservation first: {reason}"
    }),
    roadNoLegalRoute: msg({
      id: "mapEditor.hints.roadNoLegalRoute",
      message: "No legal road route: check width, obstacles and grade."
    }),
    roadExistsFirst: msg({
      id: "mapEditor.hints.roadExistsFirst",
      message: "Select two points on an existing authored road."
    }),
    roadLimit: msg({
      id: "mapEditor.hints.roadLimit",
      message: "Authored road edge limit reached."
    }),
    roadUpdated: msg({
      id: "mapEditor.hints.roadUpdated",
      message: "Initial road graph updated; undo is available."
    }),
    scenarioConfigureFirst: msg({
      id: "mapEditor.hints.scenarioConfigureFirst",
      message: "Configure an authored scenario first."
    }),
    scenarioEnemiesNeed: msg({
      id: "mapEditor.hints.scenarioEnemiesNeed",
      message: "Choose an adventure or colony scenario for enemies."
    }),
    scenarioHomeBlocked: msg({
      id: "mapEditor.hints.scenarioHomeBlocked",
      message: "Remove enemy units and camps before changing to a peaceful home."
    }),
    scenarioHqFirst: msg({
      id: "mapEditor.hints.scenarioHqFirst",
      message: "Select an HQ or landing first."
    }),
    scenarioUnitFirst: msg({
      id: "mapEditor.hints.scenarioUnitFirst",
      message: "Select a unit or camp first."
    }),
    scenarioObjectFirst: msg({
      id: "mapEditor.hints.scenarioObjectFirst",
      message: "Select an object in this tab to move."
    }),
    scenarioMode: msg({
      id: "mapEditor.hints.scenarioMode",
      message: "Scenario: {mode}. Click the map; authored changes apply when the map is played."
    }),
    scenarioReady: msg({
      id: "mapEditor.hints.scenarioReady",
      message: "Scenario ready. Save this map and load it to play."
    }),
    scenarioRulesApplied: msg({
      id: "mapEditor.hints.scenarioRulesApplied",
      message: "Scenario rules applied."
    }),
    scriptObjectRemoved: msg({
      id: "mapEditor.hints.scriptObjectRemoved",
      message: "Removed object #{id} is used by the map script ({users}); the script is no longer Ready. Undo restores it."
    }),
    garrisonCapacity: msg({
      id: "mapEditor.hints.garrisonCapacity",
      message: "Use whole garrison counts within capacity {capacity}."
    }),
    seedCancelled: msg({
      id: "mapEditor.hints.seedCancelled",
      message: "Seed generation cancelled."
    }),
    seedFailed: msg({
      id: "mapEditor.hints.seedFailed",
      message: "Seed regeneration failed."
    }),
    seedDifferentMap: msg({
      id: "mapEditor.hints.seedDifferentMap",
      message: "The saved generator recipe belongs to a different map."
    }),
    seedInvalidRecipe: msg({
      id: "mapEditor.hints.seedInvalidRecipe",
      message: "The saved generator recipe is invalid."
    }),
    seedNoRecipe: msg({
      id: "mapEditor.hints.seedNoRecipe",
      message: "This map has no exact saved generator recipe. Named baseline restoration remains available."
    }),
    seedPreparing: msg({
      id: "mapEditor.hints.seedPreparing",
      message: "Preparing the original terrain. Changing the map or selection will cancel this action."
    }),
    seedRestored: msg({
      id: "mapEditor.hints.seedRestored",
      message: "Restored {count} terrain points inside the contour. Protected features, painted ground, resources and terrain outside the selection were kept."
    }),
    seedVersion: msg({
      id: "mapEditor.hints.seedVersion",
      message: "This map uses a different terrain generator version; exact seed regeneration is unavailable."
    }),
    seedUnavailable: msg({
      id: "mapEditor.hints.seedUnavailable",
      message: "Seed generation worker is unavailable."
    }),
    storageTerrainBusy: msg({
      id: "mapEditor.hints.storageTerrainBusy",
      message: "Empty shared storage and finish pending deliveries before editing this live map."
    }),
    seedWait: msg({
      id: "mapEditor.hints.seedWait",
      message: "Wait for terrain rebuilding first."
    }),
    baselineCaptureFailed: msg({
      id: "mapEditor.hints.baselineCaptureFailed",
      message: "Could not capture baseline."
    }),
    baselineCaptured: msg({
      id: "mapEditor.hints.baselineCaptured",
      message: "Captured “{name}”. Save the map to preserve this baseline. Capturing replaces the previous baseline and is not an undoable terrain edit."
    }),
    baselineRestoreFailed: msg({
      id: "mapEditor.hints.baselineRestoreFailed",
      message: "Restore failed."
    }),
    baselineRestored: msg({
      id: "mapEditor.hints.baselineRestored",
      message: "Restored {count} interior vertices to “{name}”; current material paints and props retained. Protected boundaries, road grades, props, river flows and settlement ground were excluded."
    }),
    transformFailed: msg({
      id: "mapEditor.hints.transformFailed",
      message: "Terrain transform failed."
    }),
    transformDone: msg({
      id: "mapEditor.hints.transformDone",
      message: "Transformed {changed} terrain points and moved {moved} attached props, {oreZones} ore zones and {stoneSources} stone sources; re-seated {reseated} trees and rocks in the way. {clamped}Select the new contour before another transform."
    }),
    transformClamped: msg({
      id: "mapEditor.hints.transformClamped",
      message: "Clamped to east {east}, south {south} to stay inside the map. "
    }),
    vegetationDone: msg({
      id: "mapEditor.hints.vegetationDone",
      message: "Added {placed}/{requested} trees after {attempts} bounded attempts (seed {seed}). Existing props and all material/height/ore layers retained; occupied, unsuitable or crowded ground was skipped."
    }),
    vegetationFailed: msg({
      id: "mapEditor.hints.vegetationFailed",
      message: "Vegetation regrowth failed."
    }),
    vegetationWait: msg({
      id: "mapEditor.hints.vegetationWait",
      message: "Wait for the current terrain rebuild first."
    }),
    vegetationSelection: msg({
      id: "mapEditor.hints.vegetationSelection",
      message: "Select a complete contour or aim the view centre at editable ground."
    }),
    weatherInvalid: msg({
      id: "mapEditor.hints.weatherInvalid",
      message: "Choose a finite starting hour from 0 to under 24, and one weather type."
    }),
    groundPaletteApplied: msg({
      id: "mapEditor.hints.groundPaletteApplied",
      message: "Sand, soil and rock colour saved with the map."
    }),
    timeApplied: msg({
      id: "mapEditor.hints.timeApplied",
      message: "Map time and weather saved for new Play."
    }),
    timeRemoved: msg({
      id: "mapEditor.hints.timeRemoved",
      message: "Map time and weather defaults removed."
    }),
    timeNormal: msg({
      id: "mapEditor.hints.timeNormal",
      message: "Normal start time and weather."
    }),
    timeAuthored: msg({
      id: "mapEditor.hints.timeAuthored",
      message: "Authored start time and weather set."
    }),
    noRoom: msg({
      id: "mapEditor.hints.noRoom",
      message: "No room: habitat, body clearance or the 48 authored-home limit."
    }),
    animalsPlaced: msg({
      id: "mapEditor.hints.animalsPlaced",
      message: "{placed} animals placed at the selected age."
    }),
    animalsPartial: msg({
      id: "mapEditor.hints.animalsPartial",
      message: "{placed} / {count} animals placed: remaining spots lack habitat, body room or an available home slot."
    }),
    orePlaced: msg({
      id: "mapEditor.hints.orePlaced",
      message: "Ore deposit placed (hidden until surveyed; Settings > World > Reveal ore deposits shows it)."
    }),
    quarryStonePlaced: msg({
      id: "mapEditor.hints.quarryStonePlaced",
      message: "Quarry stone boulder placed. Click again for another."
    }),
    mineErased: msg({
      id: "mapEditor.hints.mineErased",
      message: "Mine zones and ore removed under the brush; ground and objects preserved."
    }),
    invalidScenario: msg({
      id: "mapEditor.hints.invalidScenario",
      message: "Invalid scenario definition"
    }),
    rebuildFailed: msg({
      id: "mapEditor.hints.rebuildFailed",
      message: "Map rebuild failed. Use Retry map rebuild."
    }),
    mapDraftProblems: msg({
      id: "mapEditor.hints.mapDraftProblems",
      message: "Draft: {problems}"
    })
  },
  info: {
    typicalOf: msg({
      id: "mapEditor.info.typicalOf",
      message: "Typical of: {nations}"
    })
  },
  help: {
    animals: msg({
      id: "mapEditor.help.animals",
      message: "Each animal needs suitable habitat, connected walking space and room for its body. Young animals grow naturally and cannot be hunted. Failed or partial groups are reported; 48 authored homes fit on a map. Tree-backed homes can replenish wildlife after a death."
    }),
    biome: msg({
      id: "mapEditor.help.biome",
      message: "Paint local biome blends with the brush size and strength. Manual ground tiles, heights, water, ore and existing trees stay in place. Local-biome planting uses the new blend. Scenario enemy appearance and weather are separate settings."
    }),
    grassCover: msg({
      id: "mapEditor.help.grassCover",
      message: "Paint field grass with the brush. It grows only where the island's own grass grows (meadow, lush or forest ground away from roads, plots, tilled soil, yards and water). The doodad eraser clears it."
    }),
    coast: msg({
      id: "mapEditor.help.coast",
      message: "Preview a bounded native shore profile at the view centre, then Apply. Painted materials, buildings, roads, ores, stone sources, authored stamps and editable rivers stay protected. Feedback uses real local clearance rules; it does not prove a swept ship voyage or a complete economy."
    }),
    contourSelection: msg({
      id: "mapEditor.help.contourSelection",
      message: "Select at the view centre. Connected ranges and river/lake networks remain whole; generated shapes have no recoverable individual seed."
    }),
    contourTransform: msg({
      id: "mapEditor.help.contourTransform",
      message: "Move or resize the measured contour profile. Relief is cut above its selected contour plane; an inland lake is filled to its waterline and its measured depths move to the new rim. Attached trees, stones and decorations keep their native appearance and size. This does not recover hidden original ground. Complete finite stone sources move with their boulders; complete ore zones retain their exact quantities when moved or resized. Enable connected courses to move or resize complete river groups with the measured relief, using the native river carver. Courses keep their saved order and fixed map erasures. Without this option, relief crossed by a flowing river is refused rather than moving the river implicitly; exact flowing water bodies still support whole-tile moves onto matching terrain. Other props, roads and authored features stay protected."
    }),
    decoration: msg({
      id: "mapEditor.help.decoration",
      message: "Select existing generated or placed ground decorations. Plants stand on dry ground; trees use the tree tools. Moving preserves the model and anchors it to the ground. Scale stays within the model limits. Water lilies need calm fresh water 0.15–1.2 tiles deep; reeds and cattails may wade in calm fresh water up to 0.45 tiles deep. Floating pads follow the water surface."
    }),
    groundPalette: msg({
      id: "mapEditor.help.groundPalette",
      message: "Colour of the island's beach sand, bare soil and rock. Auto follows the climate: the theme of each area and the player's nation."
    }),
    environment: msg({
      id: "mapEditor.help.environment",
      message: "Authored defaults apply on new Play; saved games keep their current clock and weather. Without them new Play uses the game's normal starting time and weather."
    }),
    fishing: msg({
      id: "mapEditor.help.fishing",
      message: "Fish use existing water and shore rules. Shape a lake or sea, then inspect actual shore/cast sites near the view centre. No separate fish population is spawned."
    }),
    garrison: msg({
      id: "mapEditor.help.garrison",
      message: "Finite foot troops only. Archers use available exposed tower/window posts. Ranks 1–3 correspond to unit ranks 0–2. Appearance follows the scenario nation."
    }),
    ore: msg({
      id: "mapEditor.help.ore",
      message: "Per-cell replaces every cell's quantity. Total distributes the exact amount evenly, with remainder units assigned in map order. Zero exhausts the deposit without deleting its zone. Ground, ore type and survey status stay unchanged; refresh to inspect ongoing mine extraction."
    }),
    originalSources: msg({
      id: "mapEditor.help.originalSources",
      message: "Original source footprints can overlap even when their visible contours merge. Saved source identities remain independent; older maps require a compatible exact generator recipe."
    }),
    patrol: msg({
      id: "mapEditor.help.patrol",
      message: "Enemy field units loop from spawn through numbered waypoints and back. Combat interrupts patrols; camp defenders retain their garrison assignments. State survives game saves."
    }),
    placeDeposit: msg({
      id: "mapEditor.help.placeDeposit",
      message: "Pick a deposit, then click the map to place it; pick it again to stop. Quarry stone boulders feed the stonemason; marble, limestone, basalt and granite allow their matching quarry on any island. Every worked-out stone source disappears and grows back at the same spot {minutes} minutes later, waiting while the spot is built or paved over."
    }),
    marble: msg({
      id: "mapEditor.help.marble",
      message: "Up to {deposits} material deposits per map. A worked-out deposit vanishes and grows back with {quantity} after {minutes} minutes, like a quarry stone boulder. Move keeps its identity and played amount; positions snap to cell centres. A colony map keeps its own stone material."
    }),
    relief: msg({
      id: "mapEditor.help.relief",
      message: "Click raises a mountain or digs a lake a level; Ctrl + click (or Lower on) takes one back; a drag draws a ridge or a channel. Reset ground flattens a dry meadow, including over water."
    }),
    riverFeatures: msg({
      id: "mapEditor.help.riverFeatures",
      message: "Select, move, resize or remove editor-authored mountains and lakes. Generated base mountains/lakes and terrain baked by a later brush have no independent feature to select."
    }),
    river: msg({
      id: "mapEditor.help.river",
      message: "Generated rivers with saved definitions and channels drawn here can be selected. Generated width/depth use multipliers of their captured native shape; authored dimensions use world units. Trace a baked channel to adopt its current water and sampled shape; its existing bed is retained on removal. Water erasures stay at their map coordinates when channels are moved or resized."
    }),
    roads: msg({
      id: "mapEditor.help.roads",
      message: "Roads become initial public roads on new Play; saved games keep their runtime roads. Harbour is a reserved plot only: build it normally during play."
    }),
    scenarioSpace: msg({
      id: "mapEditor.help.scenarioSpace",
      message: "Inspect staged economy space, whole-island walking components, authored roads and native ship clearance. Bounded searches without witnesses remain UNKNOWN; this does not simulate an economy or traffic."
    }),
    scopedRestore: msg({
      id: "mapEditor.help.scopedRestore",
      message: "Capture the current map explicitly, then restore a selected connected contour to it. Material paints and props are retained. This is scoped restoration, not original seed regeneration. Boundary vertices, roads, props, flowing rivers and settlement clearance are protected. Regenerate restores the original generated shape inside the selected contour and keeps painted ground, resources, props, roads and authored features; older maps and expedition maps without a saved recipe can use the named baseline."
    }),
    terrain: msg({
      id: "mapEditor.help.terrain",
      message: "Drag to gently raise, lower, smooth or roughen. Sandy shore blends land into sea; use a larger brush along the coast. Sea digs ocean water, unlike Lake."
    }),
    tree: msg({
      id: "mapEditor.help.tree",
      message: "Young trees grow naturally over 120 seconds and cannot be harvested until mature. Local biome reuses terrain moisture, coast, elevation and theme species rules. The Sapling tree tool always places an oak sprout, whatever the initial age."
    }),
    vegetation: msg({
      id: "mapEditor.help.vegetation",
      message: "Add trees without removing existing vegetation or changing material paints, terrain or ore. Uses current biome and planting rules, spacing and actual reservations. Each action adds at most 64 trees; this does not reconstruct the original generated forest. Initial age follows the tree palette."
    })
  },
  inspection: {
    connectivitySummary: msg({
      id: "mapEditor.inspection.connectivitySummary",
      message: "{errors} authored errors. Required startup footprints: {footprints}. {witnessed}/{workspaces} bounded work-area witnesses; {harbours} legal connected harbour plots. {components} walking components; {routes} native swept-route witnesses. This validates a fixed proposed spatial plan, not a functioning economy or hypothetical military expansion."
    }),
    checking: msg({
      id: "mapEditor.inspection.checking",
      message: "Checking actual placement and walking approaches… Cancel is available."
    }),
    cancelled: msg({
      id: "mapEditor.inspection.cancelled",
      message: "Inspection cancelled or hidden."
    }),
    cancelledHidden: msg({
      id: "mapEditor.inspection.cancelledHidden",
      message: "Inspection cancelled while its panel is hidden."
    }),
    mapChanged: msg({
      id: "mapEditor.inspection.mapChanged",
      message: "Map changed. Inspect again to refresh clearance evidence."
    }),
    failed: msg({ id: "mapEditor.inspection.failed", message: "Inspection failed" }),
    findingLimit: msg({
      id: "mapEditor.inspection.findingLimit",
      message: "Display limited to 256 findings; inspect individual authored sites for further detail."
    }),
    roadLimit: msg({
      id: "mapEditor.inspection.roadLimit",
      message: "Overlay drawing is limited to the first 2048 proposed road edges; validation uses the full scratch graph."
    }),
    phase: msg({
      id: "mapEditor.inspection.phase",
      message: "{phase}. Cancel is available."
    }),
    progress: msg({
      id: "mapEditor.inspection.progress",
      message: "{stage}: {plots} plots, {expansionChecks} footprint and {harbourChecks} shore checks. Cancel is available."
    }),
    summaryEvidence: msg({
      id: "mapEditor.inspection.summaryEvidence",
      message: "Connectivity, work-area evidence and limitations"
    }),
    contourBudget: msg({
      id: "mapEditor.inspection.contourBudget",
      message: "Connected feature exceeds the 32,768-cell inspection budget. No partial feature selected."
    }),
    contourStatus: msg({
      id: "mapEditor.inspection.contourStatus",
      message: "{cells} connected cells, {boundary} boundary samples. This is a visible contour, not an inferred independent generated stamp. Move/resize below operates on its measured contour profile, without inventing an independent generated stamp."
    }),
    noContour: msg({
      id: "mapEditor.inspection.noContour",
      message: "No matching contour at the view centre."
    }),
    navigationStatus: msg({
      id: "mapEditor.inspection.navigationStatus",
      message: "{clear}/{samples} samples clear. Green: clear; red: blocked. Walking uses authored occupancy. Road checks only terrain slope, reserved strip and visible rock; territory, buildings and route grading still require placement. Cardinal hull/turning masks are not swept voyage proof or economy validation."
    }),
    inspectingLocal: msg({
      id: "mapEditor.inspection.inspectingLocal",
      message: "Inspecting local clearance…"
    }),
    inspectAgainLayer: msg({
      id: "mapEditor.inspection.inspectAgainLayer",
      message: "Inspect again for the selected layer."
    }),
    mapChangedInspect: msg({
      id: "mapEditor.hints.mapChangedInspect",
      message: "Map changed. Inspect again."
    }),
    fishingStatus: msg({
      id: "mapEditor.inspection.fishingStatus",
      message: "{count} distinct legal shore/cast pairs in the local 25×25-cell inspection. Uses actual depth, rock, stance, dry-cast and doorway rules. A Fisher still needs building placement, territory and a connected worker route."
    }),
    finding: msg({
      id: "mapEditor.inspection.finding",
      message: "{outcome} — {name}: {detail}"
    }),
    landComponent: msg({
      id: "mapEditor.inspection.landComponent",
      message: "Land {id}: {nodes} nodes"
    }),
    stageAuthored: msg({ id: "mapEditor.inspection.stageAuthored", message: "Authored scenario" }),
    stageHarbour: msg({ id: "mapEditor.inspection.stageHarbour", message: "Harbour approaches" }),
    stageWorkArea: msg({ id: "mapEditor.inspection.stageWorkArea", message: "Work area: {name}" }),
    unknown: msg({ id: "mapEditor.inspection.unknown", message: "Unknown" }),
    witnessed: msg({ id: "mapEditor.inspection.witnessed", message: "witnessed" }),
    unfinishedNote: msg({
      id: "mapEditor.inspection.unfinishedNote",
      message: "Navigation checks unfinished: unchecked layers remain UNKNOWN."
    }),
    budgetNote: msg({
      id: "mapEditor.inspection.budgetNote",
      message: "Time budget reached; remaining checks are UNKNOWN."
    }),
    fishingFailed: msg({
      id: "mapEditor.inspection.fishingFailed",
      message: "Fishing inspection failed."
    })
  },
  library: {
    blocked: msg({
      id: "mapEditor.library.blocked",
      message: "Browser storage is blocked here: save and load map files instead."
    }),
    catalogCurrent: msg({
      id: "mapEditor.library.catalogCurrent",
      message: "Current starter: revision {revision} · {name}"
    }),
    catalogEmpty: msg({
      id: "mapEditor.library.catalogEmpty",
      message: "No shared starter map is published yet."
    }),
    catalogFailed: msg({
      id: "mapEditor.library.catalogFailed",
      message: "The shared map history is unavailable."
    }),
    catalogTitle: msg({
      id: "mapEditor.library.catalogTitle",
      message: "Shared starter history"
    }),
    current: msg({ id: "mapEditor.library.current", message: "Current" }),
    rollbackConfirm: msg({
      id: "mapEditor.library.rollbackConfirm",
      message: "Roll back the shared starter to revision {revision} of \"{name}\"? Existing games keep their own map."
    }),
    rolledBack: msg({
      id: "mapEditor.library.rolledBack",
      message: "Shared starter rolled back to revision {revision}."
    }),
    confirmDelete: msg({ id: "mapEditor.library.confirmDelete", message: "Delete \"{name}\"?" }),
    confirmLoadFile: msg({
      id: "mapEditor.library.confirmLoadFile",
      message: "Load \"{name}\"? Unsaved edits are lost."
    }),
    confirmLoadSlot: msg({
      id: "mapEditor.library.confirmLoadSlot",
      message: "Load \"{name}\"? Unsaved edits are lost."
    }),
    confirmOverwrite: msg({
      id: "mapEditor.library.confirmOverwrite",
      message: "Overwrite \"{name}\" with the current map?"
    }),
    fileSaved: msg({
      id: "mapEditor.library.fileSaved",
      message: "Map file saved ({size})."
    }),
    campaignEditing: msg({
      id: "mapEditor.library.campaignEditing",
      message: "Campaign map: Save stores it in its campaign slot ({slot}); Play and the shared starter are off."
    }),
    campaignMapOnly: msg({
      id: "mapEditor.library.campaignMapOnly",
      message: "A campaign map is saved only into its campaign; it cannot replace World01 or the shared starter."
    }),
    campaignSaved: msg({
      id: "mapEditor.library.campaignSaved",
      message: "Campaign map \"{name}\" saved ({size})."
    }),
    worldSaved: msg({
      id: "mapEditor.library.worldSaved",
      message: "Main world saved as World01.smap ({size})."
    }),
    loadFailed: msg({
      id: "mapEditor.library.loadFailed",
      message: "The map could not be loaded. The editor is still open."
    }),
    loadNeedsStorage: msg({
      id: "mapEditor.library.loadNeedsStorage",
      message: "Loading needs browser storage, which is blocked here."
    }),
    publishFailed: msg({
      id: "mapEditor.library.publishFailed",
      message: "The starter map could not be published."
    }),
    publishNoHeadquarters: msg({
      id: "mapEditor.library.publishNoHeadquarters",
      message: "Place a valid headquarters on buildable ground before publishing the starter map."
    }),
    published: msg({
      id: "mapEditor.library.published",
      message: "Published shared starter map revision {revision}."
    }),
    noSlots: msg({ id: "mapEditor.library.noSlots", message: "No maps saved in this browser yet." }),
    saved: msg({
      id: "mapEditor.library.saved",
      message: "Saved \"{name}\" in the browser ({size})."
    }),
    slotsFull: msg({
      id: "mapEditor.library.slotsFull",
      message: "All slots are used: overwrite or delete one first."
    }),
    storageReadFailed: msg({
      id: "mapEditor.library.storageReadFailed",
      message: "The saved map could not be read: browser storage is not available."
    }),
    storageMissing: msg({
      id: "mapEditor.library.storageMissing",
      message: "The saved map is gone (deleted, or the browser data was cleared)."
    }),
    storageReadError: msg({
      id: "mapEditor.library.storageReadError",
      message: "The saved map could not be read."
    }),
    browserRefused: msg({
      id: "mapEditor.library.browserRefused",
      message: "That did not work: the browser refused it."
    }),
    slots: msg({ id: "mapEditor.library.slots", message: "Maps saved in this browser" })
  },
  harbourSpots: {
    label: msg({ id: "mapEditor.harbourSpots.label", message: "Harbour spot" })
  },
  navLayer: {
    oceanDraft: msg({ id: "mapEditor.navLayer.oceanDraft", message: "Ocean-connected draft" }),
    oceanTurning: msg({
      id: "mapEditor.navLayer.oceanTurning",
      message: "Ocean-connected turning square"
    }),
    parallelX: msg({ id: "mapEditor.navLayer.parallelX", message: "Cardinal hull along X" }),
    parallelZ: msg({ id: "mapEditor.navLayer.parallelZ", message: "Cardinal hull along Z" }),
    road: msg({ id: "mapEditor.navLayer.road", message: "Road terrain strip (+X / +Z)" }),
    turning: msg({ id: "mapEditor.navLayer.turning", message: "Full turning square" }),
    walking: msg({ id: "mapEditor.navLayer.walking", message: "Walking point clearance" })
  },
  option: {
    animalAge: {
      adolescent: msg({ id: "mapEditor.option.animalAge.adolescent", message: "Adolescent" }),
      adult: msg({ id: "mapEditor.option.animalAge.adult", message: "Adult" }),
      juvenile: msg({ id: "mapEditor.option.animalAge.juvenile", message: "Juvenile" }),
      mature: msg({ id: "mapEditor.option.animalAge.mature", message: "Mature" }),
      newborn: msg({ id: "mapEditor.option.animalAge.newborn", message: "Newborn" })
    },
    biome: {
      desert: msg({ id: "mapEditor.option.biome.desert", message: "Desert / sandy" }),
      dirt: msg({ id: "mapEditor.option.biome.dirt", message: "Dirt / steppe" }),
      meadow: msg({ id: "mapEditor.option.biome.meadow", message: "Meadow" }),
      snowy: msg({ id: "mapGenerator.theme.snowy", message: "Snowy" })
    },
    buildingAppearance: {
      banditCatapult: msg({ id: "mapEditor.option.buildingAppearance.banditCatapult", message: "Bandit Catapult Tower" }),
      enemyHeadquarters: msg({
        id: "mapEditor.option.buildingAppearance.enemyHeadquarters",
        message: "Enemy headquarters (AI depot)"
      }),
      pirateCatapult: msg({ id: "mapEditor.option.buildingAppearance.pirateCatapult", message: "Pirate Catapult Tower" }),
      lodge0: msg({ id: "mapEditor.option.buildingAppearance.lodge0", message: "Lodge 1" }),
      lodge1: msg({ id: "mapEditor.option.buildingAppearance.lodge1", message: "Lodge 2" }),
      lodge2: msg({ id: "mapEditor.option.buildingAppearance.lodge2", message: "Lodge 3" }),
      military: msg({ id: "mapEditor.option.buildingAppearance.military", message: "Military building" }),
      tent0: msg({ id: "mapEditor.option.buildingAppearance.tent0", message: "Tent 1" }),
      tent1: msg({ id: "mapEditor.option.buildingAppearance.tent1", message: "Tent 2" }),
      tent2: msg({ id: "mapEditor.option.buildingAppearance.tent2", message: "Tent 3" })
    },
    coastFeedback: {
      oceanTurning: msg({
        id: "mapEditor.navLayer.oceanTurning",
        message: "Ocean-connected turning square"
      }),
      sea: msg({ id: "mapEditor.navLayer.oceanDraft", message: "Ocean-connected draft" }),
      walking: msg({ id: "mapEditor.option.coastFeedback.walking", message: "Walking clearance" })
    },
    coastOperation: {
      beach: msg({ id: "mapEditor.option.coastOperation.beach", message: "Smooth shore profile" }),
      flatten: msg({
        id: "mapEditor.option.coastOperation.flatten",
        message: "Extend dry land / small island"
      }),
      sea: msg({ id: "mapEditor.option.coastOperation.sea", message: "Carve ocean inlet" })
    },
    contourKind: {
      relief: msg({
        id: "mapEditor.option.contourKind.relief",
        message: "Connected relief above contour"
      }),
      water: msg({ id: "mapEditor.option.contourKind.water", message: "Connected water body" })
    },
    facing: {
      manual: msg({ id: "mapEditor.option.facing.manual", message: "Manual" }),
      towardLanding: msg({ id: "mapEditor.option.facing.towardLanding", message: "Toward landing" })
    },
    formation: {
      block: msg({ id: "mapEditor.option.formation.block", message: "Block" }),
      column: msg({ id: "mapEditor.option.formation.column", message: "Column" }),
      line: msg({ id: "mapEditor.option.formation.line", message: "Line" }),
      wedge: msg({ id: "mapEditor.option.formation.wedge", message: "Wedge" })
    },
    garrisonMode: {
      authoredComposition: msg({
        id: "mapEditor.option.garrisonMode.authoredComposition",
        message: "Authored composition"
      }),
      shieldDefenders: msg({
        id: "mapEditor.option.garrisonMode.shieldDefenders",
        message: "Default defenders"
      })
    },
    nation: {
      japanese: msg({ id: "mapEditor.option.nation.japanese", message: "Japanese" }),
      nubian: msg({ id: "mapEditor.option.nation.nubian", message: "Nubian" }),
      roman: msg({ id: "mapEditor.option.nation.roman", message: "Roman" }),
      viking: msg({ id: "domain.nation.viking", message: "Viking" })
    },
    objective: {
      capture: msg({ id: "mapEditor.captions.capture", message: "Capture" }),
      defeat: msg({ id: "mapEditor.option.objective.defeat", message: "Defeat" })
    },
    regrowthSpecies: {
      birch: msg({ id: "mapEditor.catalog.tree.birch", message: "Birch" }),
      cedar: msg({ id: "mapEditor.option.regrowthSpecies.cedar", message: "Cedar (explicit authoring)" }),
      conifer: msg({ id: "mapEditor.catalog.tree.conifer", message: "Conifer" }),
      currentBiome: msg({
        id: "mapEditor.option.regrowthSpecies.currentBiome",
        message: "Current local biome"
      }),
      hardwood: msg({
        id: "mapEditor.option.regrowthSpecies.hardwood",
        message: "Hardwood (explicit authoring)"
      }),
      mahogany: msg({
        id: "mapEditor.option.regrowthSpecies.mahogany",
        message: "Mahogany (explicit authoring)"
      }),
      oak: msg({ id: "mapEditor.catalog.tree.oak", message: "Oak" }),
      palm: msg({ id: "mapEditor.catalog.tree.palm", message: "Palm" }),
      walnut: msg({
        id: "mapEditor.option.regrowthSpecies.walnut",
        message: "Walnut (explicit authoring)"
      })
    },
    scenarioKind: {
      adventure: msg({ id: "settlement.colony.adventureKind", message: "Adventure" }),
      colony: msg({ id: "mapEditor.option.scenarioKind.colony", message: "Colony" }),
      home: msg({ id: "mapEditor.option.scenarioKind.home", message: "Home" })
    },
    scenarioTheme: {
      desert: msg({ id: "settlement.climate.desert", message: "Desert" }),
      forest: msg({ id: "settlement.climate.forest", message: "Forest" }),
      swamp: msg({ id: "settlement.climate.swamp", message: "Swamp" }),
      tropical: msg({ id: "settlement.climate.tropical", message: "Tropical" }),
      winter: msg({ id: "settlement.climate.winter", message: "Winter" })
    },
    timber: {
      birchClassic: msg({ id: "mapEditor.option.timber.birchClassic", message: "Birch — Classic" }),
      birchMultipleStems: msg({
        id: "mapEditor.option.timber.birchMultipleStems",
        message: "Birch — Multiple stems"
      }),
      birchOld: msg({ id: "mapEditor.option.timber.birchOld", message: "Birch — Old" }),
      birchWeeping: msg({ id: "mapEditor.option.timber.birchWeeping", message: "Birch — Weeping" }),
      birchYoung: msg({ id: "mapEditor.option.timber.birchYoung", message: "Birch — Young" }),
      seededVariety: msg({
        id: "mapEditor.option.timber.seededVariety",
        message: "Seeded variety"
      }),
      variant1: msg({ id: "mapEditor.option.timber.variant1", message: "Variant 1" }),
      variant2: msg({ id: "mapEditor.option.timber.variant2", message: "Variant 2" }),
      variant3: msg({ id: "mapEditor.option.timber.variant3", message: "Variant 3" }),
      variant4: msg({ id: "mapEditor.option.timber.variant4", message: "Variant 4" })
    },
    treeAge: {
      established: msg({
        id: "mapEditor.option.treeAge.established",
        message: "Established ({seconds}s)"
      }),
      mature: msg({ id: "mapEditor.option.treeAge.mature", message: "Mature ({seconds}s)" }),
      sapling: msg({ id: "mapEditor.option.treeAge.sapling", message: "Sapling ({seconds}s)" }),
      sprout: msg({ id: "mapEditor.option.treeAge.sprout", message: "Sprout ({seconds}s)" }),
      young: msg({ id: "mapEditor.option.treeAge.young", message: "Young ({seconds}s)" })
    },
    troop: {
      archer: msg({ id: "mapEditor.option.troop.archer", message: "Archer" }),
      heavy: msg({ id: "mapEditor.option.troop.heavy", message: "Heavy infantry" }),
      shield: msg({ id: "mapEditor.option.troop.shield", message: "Shield" })
    },
    rockPalette: {
      auto: msg({ id: "mapEditor.option.rockPalette.auto", message: "Auto (climate)" }),
      basalt: msg({ id: "mapEditor.option.rockPalette.basalt", message: "Dark basalt" }),
      golden: msg({ id: "mapEditor.option.rockPalette.golden", message: "Golden sandstone" }),
      grey: msg({ id: "mapEditor.option.rockPalette.grey", message: "Grey" }),
      limestone: msg({ id: "mapEditor.option.rockPalette.limestone", message: "Cream limestone" }),
      redSandstone: msg({ id: "mapEditor.option.rockPalette.redSandstone", message: "Red sandstone" })
    },
    sandPalette: {
      auto: msg({ id: "mapEditor.option.sandPalette.auto", message: "Auto (climate)" }),
      black: msg({ id: "mapEditor.option.sandPalette.black", message: "Black volcanic" }),
      golden: msg({ id: "mapEditor.option.sandPalette.golden", message: "Golden" }),
      grey: msg({ id: "mapEditor.option.sandPalette.grey", message: "Grey volcanic" }),
      pink: msg({ id: "mapEditor.option.sandPalette.pink", message: "Pink coral" }),
      red: msg({ id: "mapEditor.option.sandPalette.red", message: "Red ochre" }),
      tan: msg({ id: "mapEditor.option.sandPalette.tan", message: "Tan" }),
      white: msg({ id: "mapEditor.option.sandPalette.white", message: "White" })
    },
    soilPalette: {
      auto: msg({ id: "mapEditor.option.soilPalette.auto", message: "Auto (climate)" }),
      brown: msg({ id: "mapEditor.option.soilPalette.brown", message: "Brown" }),
      darkBrown: msg({ id: "mapEditor.option.soilPalette.darkBrown", message: "Dark brown" }),
      laterite: msg({ id: "mapEditor.option.soilPalette.laterite", message: "Red laterite" }),
      ash: msg({ id: "mapEditor.option.soilPalette.ash", message: "Volcanic ash" }),
      chalk: msg({ id: "mapEditor.option.soilPalette.chalk", message: "Chalk" }),
      loess: msg({ id: "mapEditor.option.soilPalette.loess", message: "Yellow loess" }),
      terraRossa: msg({ id: "mapEditor.option.soilPalette.terraRossa", message: "Terra rossa" })
    },
    weather: {
      clear: msg({ id: "mapEditor.option.weather.clear", message: "Clear" }),
      rain: msg({ id: "settings.weather.rain", message: "Rain" }),
      snow: msg({ id: "settings.weather.snow", message: "Snow" })
    }
  },
  palette: {
    all: msg({ id: "mapEditor.palette.all", message: "All" }),
    categories: msg({ id: "mapEditor.palette.categories", message: "Decoration categories" }),
    empty: msg({ id: "mapEditor.palette.empty", message: "No decoration matches the search." }),
    help: msg({
      id: "mapEditor.palette.help",
      message: "Every decoration of the game, from its one registry. Pick a model to place it with a click; the ghost shows whether the spot passes the game's placement rules. Natural props (stones, shrubs, reeds) are world props; decoration models (arches, lanterns, columns, ornamental plants) are saved with the authored scenario, so configure the scenario first. Remove deletes the nearest decoration at a click. Undo and redo cover both."
    }),
    natural: msg({ id: "mapEditor.palette.natural", message: "Natural" }),
    placeLimit: msg({
      id: "mapEditor.palette.placeLimit",
      message: "This map already holds the maximum number of decoration models."
    }),
    placed: msg({ id: "mapEditor.palette.placed", message: "Decoration placed." }),
    removeAtClick: msg({ id: "mapEditor.palette.removeAtClick", message: "Remove the decoration at a click" }),
    removed: msg({ id: "mapEditor.palette.removed", message: "Decoration removed." }),
    removeNothing: msg({ id: "mapEditor.palette.removeNothing", message: "No decoration stands there." }),
    search: msg({ id: "mapEditor.palette.search", message: "Search decorations" }),
    searchPlaceholder: msg({ id: "mapEditor.palette.searchPlaceholder", message: "Search…" }),
    section: msg({ id: "mapEditor.palette.section", message: "Decoration palette" }),
    status: msg({
      id: "mapEditor.palette.status",
      message: "{shown} of {total} decorations shown · {placed} decoration models on the map"
    }),
    statusBlocked: msg({
      id: "mapEditor.palette.statusBlocked",
      message: "{shown} of {total} decorations shown · {placed} decoration models on the map, {blocked} refused by the current map"
    }),
    variant: msg({ id: "mapEditor.palette.variant", message: "Decoration variant" }),
    refusal: {
      ground: msg({ id: "mapEditor.palette.refusal.ground", message: "Choose dry, open ground on the map." }),
      obstructed: msg({
        id: "mapEditor.palette.refusal.obstructed",
        message: "A building, plant, rock or another decoration is in the way."
      }),
      spacing: msg({
        id: "mapEditor.palette.refusal.spacing",
        message: "Keep at least half a tile between decoration centres."
      }),
      roadTraffic: msg({
        id: "mapEditor.palette.refusal.roadTraffic",
        message: "This would block road traffic: stand beside the road or span it with an opening."
      }),
      uneven: msg({ id: "mapEditor.palette.refusal.uneven", message: "The ground under the model must be level." })
    }
  },
  patrol: {
    spawn: msg({ id: "mapEditor.patrol.spawn", message: "Spawn" })
  },
  refusal: {
    blocked: msg({ id: "mapEditor.refusal.blocked", message: "Something already stands there." }),
    deepWater: msg({
      id: "mapEditor.refusal.deepWater",
      message: "Too deep: mountains rise only from land or shallow sea."
    }),
    noMinePlot: msg({
      id: "mapEditor.refusal.noMinePlot",
      message: "No usable mine plot here: use gentler ground with room for a mine and its entrance."
    }),
    notMineLand: msg({
      id: "mapEditor.refusal.notMineLand",
      message: "Ore only goes on mine gravel: paint mine gravel first."
    }),
    notWalkable: msg({
      id: "mapEditor.refusal.notWalkable",
      message: "The animal needs open, walkable ground there."
    }),
    outside: msg({ id: "mapEditor.refusal.outside", message: "That is outside the map." }),
    river: msg({
      id: "mapEditor.refusal.river",
      message: "Not in a river or other fresh water."
    }),
    steep: msg({ id: "mapEditor.refusal.steep", message: "Too steep there." }),
    water: msg({ id: "mapEditor.refusal.water", message: "Not on water." })
  },
  phase: {
    authoredNavigation: msg({
      id: "mapEditor.phase.authoredNavigation",
      message: "Preparing authored navigation"
    }),
    authoredRoads: msg({ id: "mapEditor.phase.authoredRoads", message: "Authored public road graph" }),
    biome: msg({ id: "mapEditor.phase.biome", message: "Building biomes and vegetation" }),
    deposits: msg({ id: "mapEditor.phase.deposits", message: "Placing mineral deposits" }),
    erosion: msg({ id: "mapEditor.phase.erosion", message: "Eroding and smoothing terrain" }),
    harbour: msg({
      id: "mapEditor.phase.harbour",
      message: "Harbour {id}: berth, turn and swept ocean route"
    }),
    harbourPair: msg({ id: "mapEditor.phase.harbourPair", message: "Harbour pair {first}/{second}" }),
    homeStone: msg({ id: "mapEditor.phase.homeStone", message: "Securing home stone, coal and iron" }),
    mineral: msg({ id: "mapEditor.phase.mineral", message: "Checking usable mineral work areas" }),
    navigation: msg({
      id: "mapEditor.phase.navigation",
      message: "Building navigation and terrain lighting"
    }),
    publicRoad: msg({ id: "mapEditor.phase.publicRoad", message: "Public road access: building {uid}" }),
    reservedSpace: msg({
      id: "mapEditor.phase.reservedSpace",
      message: "Validating reserved building space and harbour approaches"
    }),
    rivers: msg({ id: "mapEditor.phase.rivers", message: "Tracing and carving connected rivers" }),
    seaClearance: msg({
      id: "mapEditor.phase.seaClearance",
      message: "Sea clearance: {cells} cells"
    }),
    seaMasks: msg({
      id: "mapEditor.phase.seaMasks",
      message: "Native sea, hull and turning masks"
    }),
    shaping: msg({ id: "mapEditor.phase.shaping", message: "Shaping island and mountain sources" }),
    sourceMetadata: msg({
      id: "mapEditor.phase.sourceMetadata",
      message: "Finalizing editable source metadata"
    }),
    walkingGraph: msg({
      id: "mapEditor.phase.walkingGraph",
      message: "Whole-map walking graph: {batches} node/edge batches"
    }),
    working: msg({ id: "mapEditor.phase.working", message: "Working…" })
  },
  replacement: {
    cliffBands: msg({ id: "mapEditor.replacement.cliffBands", message: "Tall cliff bands (walls with ramps)" }),
    generateCaption: msg({ id: "mapEditor.replacement.generateCaption", message: "Generate map" }),
    generateLabel: msg({
      id: "mapEditor.replacement.generateLabel",
      message: "Generate replacement map with resource preset"
    }),
    help: msg({
      id: "mapEditor.replacement.help",
      message: "Resource preset applies only when generating a replacement map. The current map stays unchanged until then; save it before replacing it. Colony presets create an authored colony draft: finish its landing and enemies before Play."
    }),
    resources: msg({
      id: "mapEditor.replacement.resources",
      message: "Next generated map resources"
    })
  },
  river: {
    adopted: msg({ id: "mapEditor.river.adopted", message: "Adopted" }),
    drawn: msg({ id: "mapEditor.river.drawn", message: "Drawn" }),
    drawnDone: msg({ id: "mapEditor.river.drawnDone", message: "River drawn. Undo removes it." }),
    erased: msg({ id: "mapEditor.river.erased", message: "River water erased; its bed is kept." }),
    generated: msg({ id: "mapEditor.river.generated", message: "Generated" }),
    mouth: msg({ id: "mapEditor.river.mouth", message: "River mouth moved." }),
    removed: msg({ id: "mapEditor.river.removed", message: "River and its waterfalls removed." }),
    size: msg({ id: "mapEditor.river.size", message: "River width and depth applied." }),
    source: msg({ id: "mapEditor.river.source", message: "River source moved." })
  },
  road: {
    basaltRoad: msg({ id: "mapEditor.road.basaltRoad", message: "Basalt road" }),
    dirtRoad: msg({ id: "mapEditor.road.dirtRoad", message: "Dirt road" }),
    graniteRoad: msg({ id: "mapEditor.road.graniteRoad", message: "Granite road" }),
    limestoneRoad: msg({ id: "mapEditor.road.limestoneRoad", message: "Limestone road" }),
    marbleRoad: msg({ id: "mapEditor.road.marbleRoad", message: "Marble road" }),
    removeRoad: msg({ id: "mapEditor.road.removeRoad", message: "Remove road" }),
    reserveHarbour: msg({ id: "mapEditor.road.reserveHarbour", message: "Reserve harbour" }),
    status: msg({
      id: "mapEditor.road.status",
      message: "{edges} initial road edges."
    }),
    harbourReservation: msg({
      id: "mapEditor.road.harbourReservation",
      message: "Harbour reservation"
    }),
    statusHarbour: msg({
      id: "mapEditor.road.statusHarbour",
      message: "{edges} initial road edges. Harbour reservation at {x}, {z}."
    }),
    stoneRoad: msg({ id: "mapEditor.road.stoneRoad", message: "Stone road" })
  },
  scenario: {
    camp: msg({ id: "mapEditor.scenario.camp", message: "Camp {id} · {defenders}" }),
    hq: msg({ id: "mapEditor.scenario.hq", message: "HQ" }),
    headquarters: msg({ id: "mapEditor.scenario.headquarters", message: "Headquarters" }),
    landing: msg({ id: "mapEditor.scenario.landing", message: "Landing" }),
    garrisonSummary: msg({
      id: "mapEditor.scenario.garrisonSummary",
      message: "Garrison troop composition (capacity {capacity})"
    }),
    garrisonTitle: msg({
      id: "mapEditor.scenario.garrisonTitle",
      message: "Garrison troop composition"
    }),
    garrisonRow: msg({
      id: "mapEditor.scenario.garrisonRow",
      message: "{type} rank {rank} count"
    }),
    errors: msg({ id: "mapEditor.scenario.errors", message: "{errors}" }),
    selection: {
      mapLabel: msg({
        id: "mapEditor.scenario.selection.mapLabel",
        message: "Authored HQ or landing"
      }),
      mapMove: msg({
        id: "mapEditor.scenario.selection.mapMove",
        message: "Move selected HQ or landing"
      }),
      mapPlaceholder: msg({
        id: "mapEditor.actions.selectHq",
        message: "Select HQ or landing"
      }),
      mapRemove: msg({
        id: "mapEditor.actions.removeSelectedHq",
        message: "Remove selected HQ or landing"
      }),
      mapRotate: msg({
        id: "mapEditor.scenario.selection.mapRotate",
        message: "Rotate selected HQ"
      }),
      mapSelect: msg({
        id: "mapEditor.actions.selectHq",
        message: "Select HQ or landing"
      }),
      unitsLabel: msg({
        id: "mapEditor.scenario.selection.unitsLabel",
        message: "Authored object"
      }),
      unitsMove: msg({
        id: "mapEditor.scenario.selection.unitsMove",
        message: "Move selected"
      }),
      unitsPlaceholder: msg({
        id: "mapEditor.scenario.selection.unitsPlaceholder",
        message: "Select unit or camp"
      }),
      unitsRemove: msg({
        id: "mapEditor.actions.removeSelected",
        message: "Remove selected"
      }),
      unitsRotate: msg({
        id: "mapEditor.scenario.selection.unitsRotate",
        message: "Rotate selected"
      }),
      unitsSelect: msg({
        id: "mapEditor.actions.selectOnMap",
        message: "Select on map"
      })
    },
    mode: {
      building: msg({ id: "mapEditor.scenario.mode.building", message: "Building placement" }),
      hq: msg({ id: "mapEditor.scenario.mode.hq", message: "HQ placement" }),
      landing: msg({ id: "mapEditor.scenario.mode.landing", message: "Landing placement" }),
      move: msg({ id: "mapEditor.scenario.mode.move", message: "Move" }),
      select: msg({ id: "mapEditor.scenario.mode.select", message: "Select" }),
      unit: msg({ id: "mapEditor.scenario.mode.unit", message: "Unit placement" })
    },
    unitEntry: msg({ id: "mapEditor.scenario.unitEntry", message: "{type} {id}" }),
    peacefulHomeNote: msg({
      id: "mapEditor.scenario.peacefulHomeNote",
      message: "Enemies need an adventure or colony scenario: a home island stays peaceful."
    }),
    playNeedsStorage: msg({
      id: "mapEditor.library.loadNeedsStorage",
      message: "Loading needs browser storage, which is blocked here."
    })
  },
  sections: {
    animals: msg({ id: "mapEditor.sections.animals", message: "Animals" }),
    authoredScenario: msg({ id: "mapEditor.sections.authoredScenario", message: "Authored scenario" }),
    biome: msg({ id: "mapEditor.sections.biome", message: "Biome painting" }),
    connectedRivers: msg({ id: "mapEditor.sections.connectedRivers", message: "Connected rivers" }),
    coast: msg({
      id: "mapEditor.sections.coast",
      message: "Coast and island reshape preview"
    }),
    connectivity: msg({
      id: "mapEditor.sections.connectivity",
      message: "Island connectivity, economy space and harbour clearance"
    }),
    contours: msg({
      id: "mapEditor.sections.contours",
      message: "Generated and baked terrain contours"
    }),
    decoration: msg({ id: "mapEditor.sections.decoration", message: "Decoration editing" }),
    groundPalette: msg({ id: "mapEditor.sections.groundPalette", message: "Sand, soil and rock colour" }),
    environment: msg({
      id: "mapEditor.sections.environment",
      message: "Starting time and weather"
    }),
    grass: msg({ id: "mapEditor.sections.grass", message: "Grass" }),
    fish: msg({ id: "mapEditor.sections.fish", message: "Fish and fishable water" }),
    library: msg({ id: "hud.launcher.map", message: "Map" }),
    localNavigation: msg({
      id: "mapEditor.sections.localNavigation",
      message: "Local navigation clearance"
    }),
    mine: msg({ id: "mapEditor.sections.mine", message: "Mine deposits" }),
    objectEraser: msg({ id: "mapEditor.sections.objectEraser", message: "Object eraser" }),
    ore: msg({ id: "mapEditor.sections.ore", message: "Ore deposit quantities" }),
    originalSources: msg({
      id: "mapEditor.sections.originalSources",
      message: "Original generated sources"
    }),
    patrol: msg({ id: "mapEditor.sections.patrol", message: "Enemy patrol links" }),
    pebbles: msg({
      id: "mapEditor.sections.pebbles",
      message: "Small stones and pebbles"
    }),
    relief: msg({ id: "mapEditor.sections.relief", message: "Relief" }),
    replacement: msg({
      id: "mapEditor.sections.replacement",
      message: "Generate a replacement map"
    }),
    roads: msg({
      id: "mapEditor.sections.roads",
      message: "Roads and harbour reservation"
    }),
    scopedRestore: msg({
      id: "mapEditor.sections.scopedRestore",
      message: "Scoped terrain baseline restore"
    }),
    stone: msg({ id: "mapEditor.sections.stone", message: "Stone deposits" }),
    terrain: msg({ id: "mapEditor.sections.terrain", message: "Terrain" }),
    terrainFeatures: msg({
      id: "mapEditor.sections.terrainFeatures",
      message: "Authored mountain and lake features"
    }),
    tiles: msg({ id: "mapEditor.sections.tiles", message: "Tiles" }),
    trees: msg({ id: "mapEditor.sections.trees", message: "Trees" }),
    units: msg({ id: "mapEditor.sections.units", message: "Units & camps" }),
    vegetation: msg({
      id: "mapEditor.sections.vegetation",
      message: "Scoped vegetation regeneration"
    })
  },
  tabs: {
    animals: {
      label: msg({ id: "mapEditor.sections.animals", message: "Animals" }),
      name: msg({ id: "mapEditor.tabs.animals.name", message: "Animals and habitats" })
    },
    deposits: {
      label: msg({ id: "mapEditor.tabs.deposits.label", message: "Deposits" }),
      name: msg({
        id: "mapEditor.tabs.deposits.name",
        message: "Stone, marble and mine deposits"
      })
    },
    map: {
      label: msg({ id: "hud.launcher.map", message: "Map" }),
      name: msg({ id: "mapEditor.tabs.map.name", message: "Map, headquarters and scenario" })
    },
    script: {
      label: msg({ id: "mapEditor.tabs.script.label", message: "Script" }),
      name: msg({ id: "mapEditor.tabs.script.name", message: "Triggers, actors and templates" })
    },
    objects: {
      label: msg({ id: "mapEditor.tabs.objects.label", message: "Objects" }),
      name: msg({ id: "mapEditor.tabs.objects.name", message: "Plants and decorations" })
    },
    terrain: {
      label: msg({ id: "mapEditor.sections.terrain", message: "Terrain" }),
      name: msg({ id: "mapEditor.tabs.terrain.name", message: "Relief and water" })
    },
    tiles: {
      label: msg({ id: "mapEditor.tabs.tiles.label", message: "Tiles" }),
      name: msg({ id: "mapEditor.tabs.tiles.name", message: "Tiles and biomes" })
    },
    trees: {
      label: msg({ id: "mapEditor.tabs.trees.label", message: "Trees" }),
      name: msg({ id: "mapEditor.tabs.trees.name", message: "Trees and forestry" })
    },
    units: {
      label: msg({ id: "mapEditor.tabs.units.label", message: "Units" }),
      name: msg({ id: "mapEditor.tabs.units.name", message: "Units and camps" })
    }
  },
  coast: {
    appliedStatus: msg({
      id: "mapEditor.coast.appliedStatus",
      message: "Applied; current local navigation: {vertices} terrain vertices; {removed} props removed. Walking {walkingBefore} → {walkingAfter}/{walkingSamples} clear; ocean draft {seaBefore} → {seaAfter}/{seaSamples} clear; turning {turningBefore} → {turningAfter}/{turningSamples} clear. Protected ground and material paint remain unchanged."
    }),
    noPreview: msg({
      id: "mapEditor.coast.noPreview",
      message: "No coast reshape preview to cancel."
    }),
    previewDiscarded: msg({
      id: "mapEditor.coast.previewDiscarded",
      message: "Coast reshape preview discarded; the shore is unchanged."
    }),
    previewStatus: msg({
      id: "mapEditor.coast.previewStatus",
      message: "Preview only: {vertices} terrain vertices; {removed} props removed. Walking {walkingBefore} → {walkingAfter}/{walkingSamples} clear; ocean draft {seaBefore} → {seaAfter}/{seaSamples} clear; turning {turningBefore} → {turningAfter}/{turningSamples} clear. Protected ground and material paint remain unchanged."
    })
  },
  variable: {
    coastline: msg({ id: "mapEditor.variable.coastline", message: "{kind} {id}" }),
    coastPreview: msg({
      id: "mapEditor.variable.coastPreview",
      message: "{prefix} {vertices} terrain vertices; {removed} props removed. {counts}. Protected ground and material paint remain unchanged."
    }),
    coastCount: msg({
      id: "mapEditor.variable.coastCount",
      message: "{layer}: {before} → {after}/{samples} clear"
    }),
    oreStatus: msg({
      id: "mapEditor.variable.oreStatus",
      message: "{cells} cells · {total} ore remaining · {minimum}–{maximum} per cell · capacity {capacity}."
    }),
    selectedDecoration: msg({
      id: "mapEditor.variable.selectedDecoration",
      message: "Selected {model} · {index}. Model identity is retained when transforming."
    }),
    selectedTerrainNoSelection: msg({
      id: "mapEditor.variable.selectedTerrainNoSelection",
      message: "Select a decoration on the map to move, rotate, resize or remove it."
    }),
    phase: msg({ id: "mapEditor.variable.phase", message: "{phase}. Cancel is available." }),
    riversNone: msg({
      id: "mapEditor.variable.riversNone",
      message: "No editable rivers — draw a connected river first"
    })
  }
} as const;
