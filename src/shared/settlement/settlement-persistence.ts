import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import { restoreStoneRespawns, saveStoneRespawns } from "./boulder-respawn";
import { resolveLoadedBridgeWaits } from "./bridge-wait";
import { restoreMarbleDeposits, saveMarbleDeposits } from "./colony-marble-deposits";
import { retoolDrinkChainWorkers, returnObsoleteInputs } from "./drink-chain-saves";
import { refreshCourtyardOccupancy } from "./event-courtyard";
import { applyGameRuleEffects } from "./game-rule-effects";
import { normalizeCatapultRoofStock } from "./military-catapult-resupply";
import { packSparseCells, RUIN_OCCUPANCY_VALUE_MAX, unpackSparseCells } from "./save-cell-codecs";
import { profileSaveStage } from "./save-stage-profile";
import { ADVENTURE_ABOARD } from "./settlement-adventure-landing";
import { rebuildBuildingIndex } from "./settlement-building-index";
import { restoreCarrierDetourState, saveCarrierDetourState } from "./settlement-carrier-detours";
import { expireAllLayByClaims } from "./settlement-carrier-laybys";
import { restoreCorridorReservations, saveCorridorReservations } from "./settlement-corridor-reservations";
import { restoreDoorActivity } from "./settlement-door-activity";
import { repairDoorPassageOverlaps, restoreStorageTraffic, saveStorageTraffic } from "./settlement-door-traffic";
import { clampStorageHandcarts } from "./settlement-handcart-ledger";
import { isHomeBuilding } from "./settlement-home";
import { reclaimIdleCarriers } from "./settlement-idle-carriers";
import { markLoadedRevisions, saveNavigationRevisions } from "./settlement-load-revisions";
import { reconcileLoadedWorkerPositions } from "./settlement-loaded-positions";
import { restoreLandDispatchCursor, saveLandDispatchCursor } from "./settlement-logistics";
import type { createSettlementMilitary } from "./settlement-military";
import { restoreMovementResume, saveMovementResume } from "./settlement-movement-resume";
import { migrateSettlementNation } from "./settlement-nation-migration";
import type { createSettlementNaval } from "./settlement-naval";
import { restoreCancelledCarrierExits } from "./settlement-navigation-cancellation";
import { restoreNavigationRecovery, saveNavigationRecovery, saveNavigationRevisionAliases } from "./settlement-navigation-recovery";
import { clearPersonTraffic } from "./settlement-person-index";
import { compactRetiredSettlers, countOnDutyPeople } from "./settlement-population";
import { bumpNavigationRevision, createSettlementReservations, withUnchangedNavigation } from "./settlement-reservations";
import { restorePlantingRandom, savePlantingRandom } from "./settlement-resources";
import { isPreparedRoadTravel, restorePreparedRoadTravel } from "./settlement-road-travel";
import { restoreRuins } from "./settlement-ruin-save";
import { countSaveIntegrity } from "./settlement-save-integrity";
import { SETTLEMENT_SAVE_VERSION, type SettlementSaveV1, validateSettlementSave } from "./settlement-save-state";
import { reconcileLoadedStockLayouts } from "./settlement-stock-layout-restore";
import { restoreStockTraffic, saveStockTraffic } from "./settlement-stock-traffic";
import { restoreStoneAreas, saveStoneAreas } from "./settlement-stone-area";
import { restoreIslandScript, saveIslandScript } from "./settlement-script-snapshot";
import { restoreSurveyAssignments, saveSurveyAssignments } from "./settlement-surveying";
import type { createSettlementTavern } from "./settlement-tavern";
import { resetTerritoryCache } from "./settlement-territory";
import { resetTransientState } from "./settlement-transient-state";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { restoreWellWorkStyles } from "./settlement-well-work";
import { restoreBuilderSides, saveBuilderSides } from "./settlement-workers";
import { reconcileStorageAccess } from "./shared-storage";
import { restoreShoreShellLedger } from "./shore-shell-collection";
import { restoreGameRules, saveGameRules } from "./sim-rules";
import { restoreHomeBuildingRules, saveHomeBuildingRules } from "./building-availability-rules";

/** Existing renderer/UI holders retain the authoritative headquarters object. */
const keepHomeObject = (headquarters: SettlementBuilding, saved: SettlementBuilding) => {
  for (const key of Object.keys(headquarters)) delete (headquarters as unknown as Record<string, unknown>)[key];
  return Object.assign(headquarters, saved);
};

type LoadResult = { ok: true } | { ok: false; reason: string };

const restoreNavigationEpoch = (context: SettlementContext, saved: SettlementSaveV1) => {
  markLoadedRevisions(context, saved.navigationRevisions);
  restoreNavigationRecovery(context, saved.navigationRevisions !== undefined, saved.navigationRevisions?.aliases);
};

export const createSettlementPersistence = (
  context: SettlementContext,
  headquarters: SettlementBuilding | undefined,
  naval: ReturnType<typeof createSettlementNaval>,
  military: ReturnType<typeof createSettlementMilitary>,
  tavern: ReturnType<typeof createSettlementTavern>
) => {
  const { options } = context;
  const saveStateWithText = (): { snapshot: SettlementSaveV1; text: string } =>
    profileSaveStage("settlement.saveState", () => {
    profileSaveStage("capture.reconcileStorage", () => reconcileStorageAccess(context));
    const carrierDetours = saveCarrierDetourState(context);
    const movementResume = saveMovementResume(context);
    const live = {
      format: FORMATS.settlement.id, version: SETTLEMENT_SAVE_VERSION,
      storagePools: context.storagePools!,
      preparedRoadActors: context.actors.filter(isPreparedRoadTravel).map(actor => actor.uid),
      settlerDemand: [...context.population!.demand].filter(uid =>
        context.buildings.some(building => building.uid === uid)),
      landDispatchCursor: saveLandDispatchCursor(context),
      authoredScenario: context.authoredScenario,
      ...(context.campaignMap ? { campaignMap: structuredClone(context.campaignMap) } : {}),
      ...saveIslandScript(context),
      playerNation: context.playerNation ?? "roman",
      ...saveGameRules(context),
      ...saveHomeBuildingRules(context),
      ...(context.difficulty !== undefined && context.difficulty !== "normal"
        ? { difficulty: context.difficulty } : {}),
      ...(context.roadDecorations?.hasState()
        ? { roadDecorations: context.roadDecorations.save() } : {}),
      ...(context.roadDecorations?.sceneryRows().length
        ? { roadDecorationScenery: structuredClone([...context.roadDecorations.sceneryRows()]) } : {}),
      world: { seed: options.world.seed, cellsX: options.world.cellsX, cellsZ: options.world.cellsZ },
      buildings: context.buildings, actors: context.actors.map(actor => actor.navigationRecovery
        ? { ...actor, navigationRecovery: saveNavigationRecovery(actor) } : actor), settlers: context.settlers,
      settlerGrowthTime: context.population!.growthTime, settlerBirths: context.population!.births,
      nextActor: context.nextActor, nextBuilding: context.nextBuilding,
      accumulator: context.accumulator, scheduling: context.scheduling, gameTick: context.clock?.tick() ?? 0,
      navigationRevisions: { ...saveNavigationRevisions(context), aliases: saveNavigationRevisionAliases(context) }, plantingRandomState: savePlantingRandom(context), builderSides: saveBuilderSides(context),
      occupied: packSparseCells(context.occupied), reservations: [...context.reservations],
      corridorReservations: saveCorridorReservations(context), stockTraffic: saveStockTraffic(context), storageTraffic: saveStorageTraffic(context),
      ...(carrierDetours.length ? { carrierDetours } : {}),
      ...(movementResume ? { movementResume } : {}),
      ...(context.options.stockContact ? {} : { plainStockContacts: true as const }),
      marbleDeposits: saveMarbleDeposits(context), stoneRespawns: saveStoneRespawns(context),
      ...(context.shoreShells?.collected ? { shoreShells: structuredClone(context.shoreShells) } : {}),
      resourceAmounts: [...context.resourceAmounts], transfers: context.transfers, nextTransferId: context.nextTransferId,
      fields: context.fieldCycles!.snapshot(), stoneAreas: saveStoneAreas(context),
      surveys: saveSurveyAssignments(context), naval: naval.saveState(), military: military.saveState(),
      tavern: tavern.saveState(), trade: context.trade?.save(), reliefCollections: context.relief?.save(),
      factionAi: context.factionAi?.save(),
      colony: context.colony?.save(),
      adventure: context.adventure?.save(), roads: options.roads.segments?.() ?? [],
      ...(context.bridgeRemovals?.length ? { bridgeRemovals: context.bridgeRemovals } : {}),
      ...(context.abandonedHandcarts?.length ? { abandonedHandcarts: context.abandonedHandcarts } : {}),
      ...(context.ruins?.length ? { ruins: context.ruins } : {})
    };
    // Counted from the live state, before serialization: a load rejects a save whose arrays disagree.
    return profileSaveStage("settlement.clone", () => {
      const text = JSON.stringify({ ...live, integrity: countSaveIntegrity(live) });
      return { snapshot: JSON.parse(text) as SettlementSaveV1, text };
    });
  });
  const saveState = (): SettlementSaveV1 => saveStateWithText().snapshot;
  const loadState = (value: unknown): LoadResult => {
    const reason = validateSettlementSave(value, context);
    if (reason) return { ok: false, reason };
    const validated = JSON.parse(JSON.stringify(value)) as SettlementSaveV1;
    return applySave(migrateSettlementNation(validated, validated.playerNation ?? "roman"), false);
  };
  /**
   * Restores a validated, migrated save. `inPlace`: the island's own snapshot of its current state (the upload
   * reload, D3): the terrain under the roads and the occupancy are already what the save describes, so their
   * forced regrading and the navigation cache renewal are skipped; the result equals a fresh load's.
   */
  const applySave = (saved: SettlementSaveV1, inPlace: boolean): LoadResult => {
    if (!inPlace) return restoreSave(saved, false);
    const result = withUnchangedNavigation(context, () => restoreSave(saved, true));
    naval.afterInPlaceReload(result.ok);
    return result;
  };
  const restoreSave = (saved: SettlementSaveV1, inPlace: boolean): LoadResult => {
    if (!options.roads.replaceSegments) return { ok: false, reason: "Road network cannot restore saves" };
    if (!options.roads.replaceSegments(saved.roads)) return { ok: false, reason: "Invalid saved road network" };
    context.restoringRoadDecorations = true;
    context.bridgeRemovals = saved.bridgeRemovals ?? [];
    context.abandonedHandcarts = saved.abandonedHandcarts?.map(cart => ({ ...cart }));
    context.ruins = restoreRuins(saved.ruins);
    context.playerNation = saved.playerNation ?? "roman";
    restoreGameRules(context, saved.gameRules);
    restoreHomeBuildingRules(context, saved.homeBuildingRules);
    context.difficulty = saved.difficulty ?? "normal";
    context.buildings.splice(0, context.buildings.length,
      ...saved.buildings.map(building =>
        isHomeBuilding(building) ? keepHomeObject(headquarters!, building) : building));
    for (const site of context.buildings)
      if (site.typeId === 16) normalizeCatapultRoofStock(site);
    rebuildBuildingIndex(context);
    // The economy set (a script may have woken a faction) before anything asks `hasEconomy`.
    context.factionAi?.restore(saved.factionAi, saved.gameTick ?? 0);
    context.storagePools = saved.storagePools;
    reconcileStorageAccess(context);
    context.actors.splice(0, context.actors.length, ...saved.actors);
    clearPersonTraffic(context);
    resetTransientState(context);
    context.population!.demand.clear();
    for (const uid of saved.settlerDemand ?? []) context.population!.demand.add(uid);
    restoreLandDispatchCursor(context, saved.landDispatchCursor);
    context.settlers = saved.settlers; context.nextActor = saved.nextActor; context.nextBuilding = saved.nextBuilding;
    context.population!.growthTime = saved.settlerGrowthTime;
    context.population!.births = saved.settlerBirths;
    context.authoredScenario = saved.authoredScenario && structuredClone(saved.authoredScenario);
    context.campaignMap = saved.campaignMap && structuredClone(saved.campaignMap);
    restoreIslandScript(context, saved.scriptSnapshot, saved.scriptRun);
    context.accumulator = saved.accumulator; context.scheduling = saved.scheduling;
    context.clock?.restore(saved.gameTick ?? 0);
    // Bay leases are tick-based: drop only ownership that already expired at save time.
    expireAllLayByClaims(context);
    context.occupied.set(unpackSparseCells(saved.occupied, context.occupied.length, RUIN_OCCUPANCY_VALUE_MAX));
    for (const site of context.buildings) if (site.eventCourtyard) refreshCourtyardOccupancy(context, site);
    context.reservations = createSettlementReservations(context, saved.reservations);
    restoreCorridorReservations(context, saved.corridorReservations);
    bumpNavigationRevision(context);
    context.resourceAmounts = new Map(saved.resourceAmounts); context.transfers = saved.transfers;
    context.nextTransferId = saved.nextTransferId;
    context.fieldCycles!.restore(saved.fields); context.horses!.restore(); naval.restore(saved.naval, inPlace);
    restoreStoneAreas(context, saved.stoneAreas); restoreSurveyAssignments(context, saved.surveys);
    restorePlantingRandom(context, saved.plantingRandomState); restoreBuilderSides(context, saved.builderSides);
    military.restore(saved.military);
    tavern.restore(saved.tavern);
    context.trade?.restore(saved.trade);
    context.relief?.restore(saved.reliefCollections);
    returnObsoleteInputs(context);
    retoolDrinkChainWorkers(context);
    restoreWellWorkStyles(context);
    context.colony?.restore(saved.colony);
    // Timers first: restored deposits queue any worked out source the save has no timer for.
    restoreStoneRespawns(context, saved.stoneRespawns);
    context.shoreShells = restoreShoreShellLedger(context.options.world, saved.shoreShells);
    restoreMarbleDeposits(context, saved.marbleDeposits);
    context.adventure?.restore(saved.adventure);
    // Old event stockades gain destructible walls; expedition migrations have already run.
    if (!saved.colony && !saved.adventure) for (const site of context.buildings)
      military.combat.enableEventCourtyard(site.uid);
    clampStorageHandcarts(context);
    reclaimIdleCarriers(context);
    compactRetiredSettlers(context);
    context.population!.onDuty = countOnDutyPeople(context) + (context.naval?.rowers?.() ?? 0);
    restoreDoorActivity(context);
    resetTerritoryCache(context);
    refreshSettlementRoadTerrain(context, !inPlace);
    // Fixed map scenery first: player decorations keep clear of its volumes.
    context.roadDecorations?.spawnScenery(saved.roadDecorationScenery ?? []);
    context.roadDecorations?.load(saved.roadDecorations);
    const navalState = naval.saveState();
    const shipPassengers = new Set(navalState.fleet.ships.flatMap(ship => ship.passengers ?? []));
    // The commander's horse led aboard or standing on a troop ship's deck stays where the ship holds it.
    for (const horse of naval.troopShipHorseFrames()) shipPassengers.add(horse.id);
    for (const operation of navalState.founding.operations)
      if (operation.stage === "landing" && operation.landing)
        for (const uid of [operation.builder, operation.leveler, operation.carrier]) shipPassengers.add(uid);
    const counterattack = context.colony?.save()?.counterattack;
    if (counterattack?.ship) {
      const raiders = new Set(counterattack.raiders);
      for (const soldier of saved.military?.soldiers ?? []) {
        if (raiders.has(soldier.actor) && soldier.combat?.faction === 1)
          shipPassengers.add(soldier.actor);
      }
    }
    // An adventure's soldiers stand on the anchored ship's deck until their turn on the gangway.
    if (context.adventure?.save()?.landing)
      for (const actor of context.actors) if (actor.phase === ADVENTURE_ABOARD) shipPassengers.add(actor.uid);
    const landingPiers = [context.adventure?.save()?.landing?.gangway,
      counterattack?.ship?.landing.gangway]
      .flatMap(pier => pier ? [pier] : []);
    const piers = [...naval.sites().flatMap(site => site.workPier ? [site.workPier] : []), ...landingPiers];
    reconcileLoadedWorkerPositions(context, piers, shipPassengers, saved.navigationRevisions !== undefined);
    restoreCancelledCarrierExits(context);
    restoreNavigationEpoch(context, saved);
    restoreStockTraffic(context, saved.stockTraffic);
    // Preserve live layouts; only legacy fishery boat contacts migrate to the physical yard.
    reconcileLoadedStockLayouts(context, !saved.plainStockContacts);
    restoreStorageTraffic(context, saved.storageTraffic);
    restorePreparedRoadTravel(context, saved.preparedRoadActors);
    restoreCarrierDetourState(context, saved.carrierDetours);
    repairDoorPassageOverlaps(context);
    // The bridge wait timer is not saved: a carrier still cut off returns to storage now.
    resolveLoadedBridgeWaits(context);
    // Load-time reconciliation may spend repair grants on repositioning. Those grants belong to
    // restore, not the first live tick: the saved grant window and detour waits resume from here.
    restoreMovementResume(context, saved.movementResume);
    // The loaded pin's consequences (GS4a): a pin changed without a command (server catch-up) settles here.
    applyGameRuleEffects(context);
    context.restoringRoadDecorations = false;
    return { ok: true };
  };
  /**
   * Reloads a snapshot this island saved of its current state (no validation or migration needed).
   * Callers that pass a fresh `saveState()` and never reuse it can transfer ownership and skip the
   * defensive clone; browser saves retain the clone because the captured snapshot feeds persistence.
   */
  const reloadSnapshot = (snapshot: SettlementSaveV1, takeOwnership = false) =>
    profileSaveStage("reload.snapshot", () =>
      applySave(takeOwnership ? snapshot : JSON.parse(JSON.stringify(snapshot)), true));
  return { loadState, reloadSnapshot, saveState, saveStateWithText };
};
import { refreshSettlementRoadTerrain } from "./settlement-road-terrain";
