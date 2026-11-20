import { msg } from "@lingui/core/macro";

/**
 * Simulation-produced status copy. The source text is a saved/deterministic simulation value, so it
 * stays the key: translation happens only at the presentation boundary and never changes the save.
 */
export const DOMAIN_STATUS_MESSAGES = {
  exact: {
    "Relief collection ship": msg({ id: "ship.relief.name", message: "Relief collection ship" }),
    "Building boat": msg({ id: "domain.status.buildingBoat", message: "Building boat" }),
    "Building ship": msg({ id: "domain.status.buildingShip", message: "Building ship" }),
    "Boat workshop access blocked": msg({
      id: "domain.status.boatWorkshopAccessBlocked", message: "Boat workshop access blocked"
    }),
    "Carrying full bucket to collection bay": msg({
      id: "domain.status.carryingFullBucket", message: "Carrying full bucket to collection bay"
    }),
    "Carrying plank to ship": msg({ id: "domain.status.carryingPlank", message: "Carrying plank to ship" }),
    "Carrying cloth to ship": msg({ id: "domain.status.carryingCloth", message: "Carrying cloth to ship" }),
    "Fitting sails": msg({ id: "domain.status.fittingSails", message: "Fitting sails" }),
    "Waiting for cloth": msg({ id: "domain.status.waitingCloth", message: "Waiting for cloth" }),
    "Waiting for a clear flax plot": msg({
      id: "domain.status.waitingFlaxPlot", message: "Waiting for a clear flax plot"
    }),
    "Coast workpoint blocked": msg({ id: "domain.status.coastWorkpointBlocked", message: "Coast workpoint blocked" }),
    "Coastal work route blocked": msg({
      id: "domain.status.coastalWorkRouteBlocked", message: "Coastal work route blocked"
    }),
    "Collecting prey": msg({ id: "domain.status.collectingPrey", message: "Collecting prey" }),
    "Collecting raised bucket": msg({
      id: "domain.status.collectingRaisedBucket", message: "Collecting raised bucket"
    }),
    "Commander assigned to an expedition": msg({
      id: "domain.status.commanderAssigned", message: "Commander assigned to an expedition"
    }),
    "Commander awaiting evacuation": msg({
      id: "domain.status.commanderAwaitingEvacuation", message: "Commander awaiting evacuation"
    }),
    "Commander mustering at the harbour": msg({
      id: "domain.status.commanderMustering", message: "Commander mustering at the harbour"
    }),
    "Commander awaiting home": msg({
      id: "domain.status.commanderAwaitingHome", message: "Commander awaiting home"
    }),
    "Commander recovering": msg({
      id: "domain.status.commanderRecovering", message: "Commander recovering"
    }),
    "Colony harbour": msg({ id: "domain.status.colonyHarbour", message: "Colony harbour" }),
    "Connect a storehouse: the recruit waits inside": msg({
      id: "domain.status.connectStorehouseRecruit", message: "Connect a storehouse: the recruit waits inside"
    }),
    "Constructing": msg({ id: "domain.status.constructing", message: "Constructing" }),
    "Deposit exhausted": msg({ id: "domain.status.depositExhausted", message: "Deposit exhausted" }),
    "Destroyed · burning down": msg({ id: "domain.status.fortBurning", message: "Destroyed · burning down" }),
    "Drawing water": msg({ id: "domain.status.drawingWater", message: "Drawing water" }),
    "Enemy camp": msg({ id: "domain.bandit.enemyCamp", message: "Enemy camp" }),
    "Feeding wheat to pigs": msg({ id: "domain.status.feedingPigs", message: "Feeding wheat to pigs" }),
    "Filling bucket": msg({ id: "domain.status.fillingBucket", message: "Filling bucket" }),
    "Finishing current cycle": msg({ id: "domain.status.finishingCycle", message: "Finishing current cycle" }),
    "Following prey": msg({ id: "domain.status.followingPrey", message: "Following prey" }),
    "Hand cart waiting for a storage with room": msg({
      id: "domain.status.handcartWaiting", message: "Hand cart waiting for a storage with room"
    }),
    "Headquarters": msg({ id: "domain.status.headquarters", message: "Headquarters" }),
    "Hunting": msg({ id: "domain.status.hunting", message: "Hunting" }),
    "Input stock access blocked": msg({
      id: "domain.status.inputAccessBlocked", message: "Input stock access blocked"
    }),
    "Leaving leveled site": msg({ id: "domain.status.leavingLeveledSite", message: "Leaving leveled site" }),
    "Lowering bucket": msg({ id: "domain.status.loweringBucket", message: "Lowering bucket" }),
    "Military units pending": msg({ id: "domain.status.militaryPending", message: "Military units pending" }),
    "No reachable route": msg({ id: "domain.status.noReachableRoute", message: "No reachable route" }),
    "No reachable ship work site with a navigable launch within 36 tiles": msg({
      id: "domain.status.noShipWorkSite",
      message: "No reachable ship work site with a navigable launch within 36 tiles"
    }),
    "No storage has room for another hand cart": msg({
      id: "domain.status.noRoomForHandcart", message: "No storage has room for another hand cart"
    }),
    "Output stock full": msg({ id: "domain.status.outputFull", message: "Output stock full" }),
    "Pigs feeding and growing": msg({ id: "domain.status.pigsFeeding", message: "Pigs feeding and growing" }),
    "Planting site occupied; returning seedling": msg({
      id: "domain.status.plantingSiteOccupied", message: "Planting site occupied; returning seedling"
    }),
    "Pouring water for pigs": msg({ id: "domain.status.wateringPigs", message: "Pouring water for pigs" }),
    "Production orders complete": msg({
      id: "domain.status.productionOrdersComplete", message: "Production orders complete"
    }),
    "Production resumed": msg({ id: "domain.status.productionResumed", message: "Production resumed" }),
    "Production stopped": msg({ id: "domain.status.productionStopped", message: "Production stopped" }),
    "Raising bucket": msg({ id: "domain.status.raisingBucket", message: "Raising bucket" }),
    "Ready to recruit": msg({ id: "domain.status.readyToRecruit", message: "Ready to recruit" }),
    "Residence": msg({ id: "domain.status.residence", message: "Residence" }),
    "Resource unreachable; returning": msg({
      id: "domain.status.resourceUnreachable", message: "Resource unreachable; returning"
    }),
    "Resting": msg({ id: "domain.status.resting", message: "Resting" }),
    "Resting beside windlass": msg({ id: "domain.status.restingAtWindlass", message: "Resting beside windlass" }),
    "Return path blocked": msg({ id: "domain.status.returnPathBlocked", message: "Return path blocked" }),
    "Returning to windlass": msg({ id: "domain.status.returningToWindlass", message: "Returning to windlass" }),
    "Road not connected to storage": msg({
      id: "domain.status.roadNotConnected", message: "Road not connected to storage"
    }),
    "Setting down full bucket": msg({
      id: "domain.status.settingDownBucket", message: "Setting down full bucket"
    }),
    "Sowing wheat": msg({ id: "domain.status.sowingWheat", message: "Sowing wheat" }),
    "Staffed": msg({ id: "domain.status.staffed", message: "Staffed" }),
    "Stacking output": msg({ id: "domain.status.stackingOutput", message: "Stacking output" }),
    "Undefended": msg({ id: "domain.status.undefended", message: "Undefended" }),
    "Waiting for a clear return route": msg({
      id: "domain.status.waitingClearReturn", message: "Waiting for a clear return route"
    }),
    "Waiting for a clear sowing plot": msg({
      id: "domain.status.waitingSowingPlot", message: "Waiting for a clear sowing plot"
    }),
    "Waiting for a clear sowing route": msg({
      id: "domain.status.waitingSowingRoute", message: "Waiting for a clear sowing route"
    }),
    "Waiting for builder and supplies": msg({
      id: "domain.status.waitingBuilderAndSupplies", message: "Waiting for builder and supplies"
    }),
    "Waiting for clear leveling access": msg({
      id: "domain.status.waitingLevelingAccess", message: "Waiting for clear leveling access"
    }),
    "Waiting for clear leveling exit": msg({
      id: "domain.status.waitingLevelingExit", message: "Waiting for clear leveling exit"
    }),
    "Waiting for clear pig feeding access": msg({
      id: "domain.status.waitingPigFeeding", message: "Waiting for clear pig feeding access"
    }),
    "Waiting for clear windlass access": msg({
      id: "domain.status.waitingWindlassAccess", message: "Waiting for clear windlass access"
    }),
    "Waiting for construction supplies": msg({
      id: "domain.status.waitingConstructionSupplies", message: "Waiting for construction supplies"
    }),
    "Waiting for input access": msg({ id: "domain.status.waitingInputAccess", message: "Waiting for input access" }),
    "Waiting for inputs": msg({ id: "domain.status.waitingInputs", message: "Waiting for inputs" }),
    "Waiting for planks": msg({ id: "domain.status.waitingPlanks", message: "Waiting for planks" }),
    "Waiting for prey to fall": msg({ id: "domain.status.waitingPrey", message: "Waiting for prey to fall" }),
    "Waiting for reachable resource": msg({
      id: "domain.status.waitingResource", message: "Waiting for reachable resource"
    }),
    "Waiting for road and supplies": msg({
      id: "domain.status.waitingRoadAndSupplies", message: "Waiting for road and supplies"
    }),
    "Waiting for safe building access": msg({
      id: "domain.status.waitingSafeAccess", message: "Waiting for safe building access"
    }),
    "Waiting for shovel worker to level foundation": msg({
      id: "domain.status.waitingLeveler", message: "Waiting for shovel worker to level foundation"
    }),
    "Waiting for the innkeeper": msg({ id: "domain.status.waitingInnkeeper", message: "Waiting for the innkeeper" }),
    "Waiting for boat route to headquarters": msg({
      id: "domain.status.waitingBoatRoute", message: "Waiting for boat route to headquarters"
    }),
    "Working": msg({ id: "domain.status.working", message: "Working" })
  },
  shipLabel: {
    "Another island": msg({ id: "domain.ship.label.anotherIsland", message: "Another island" }),
    "Exploration waypoint": msg({
      id: "domain.ship.label.explorationWaypoint", message: "Exploration waypoint"
    }),
    "Idle": msg({ id: "domain.ship.label.idle", message: "Idle" }),
    "Loading / boarding": msg({ id: "domain.ship.label.loading", message: "Loading / boarding" }),
    "Local waters": msg({ id: "domain.ship.label.localWaters", message: "Local waters" }),
    "Ore ship": msg({ id: "domain.ship.label.oreShip", message: "Ore ship" }),
    "Outbound voyage": msg({ id: "domain.ship.label.outbound", message: "Outbound voyage" }),
    "Positioning": msg({ id: "domain.ship.label.positioning", message: "Positioning" }),
    "Return voyage": msg({ id: "domain.ship.label.returnVoyage", message: "Return voyage" }),
    "Reward ship": msg({ id: "domain.ship.label.rewardShip", message: "Reward ship" }),
    "Route blocked": msg({ id: "domain.ship.label.routeBlocked", message: "Route blocked" }),
    "Sailing": msg({ id: "domain.ship.label.sailing", message: "Sailing" }),
    "Settlement site": msg({ id: "domain.ship.label.settlementSite", message: "Settlement site" }),
    "Supply ship": msg({ id: "domain.ship.label.supplyShip", message: "Supply ship" }),
    "Trade ship": msg({ id: "domain.ship.label.tradeShip", message: "Trade ship" }),
    "Troop ship": msg({ id: "domain.ship.label.troopShip", message: "Troop ship" }),
    "Unloading": msg({ id: "domain.ship.label.unloading", message: "Unloading" }),
    "Waiting for entry": msg({ id: "domain.ship.label.waitingForEntry", message: "Waiting for entry" }),
    "Waiting for harbour": msg({ id: "domain.ship.label.waitingForHarbour", message: "Waiting for harbour" })
  },
  shipTerms: {
    explorationExpedition: msg({
      id: "domain.ship.term.explorationExpedition", message: "exploration expedition"
    }),
    passengers: msg({
      id: "domain.ship.term.passengers", message: "{count, plural, one {# passenger} other {# passengers}}"
    }),
    settlementExpedition: msg({
      id: "domain.ship.term.settlementExpedition", message: "settlement expedition"
    })
  },
  shipPhase: {
    "away": msg({ id: "domain.ship.phase.away", message: "away" }),
    "idle": msg({ id: "domain.ship.phase.idle", message: "idle" }),
    "loading": msg({ id: "domain.ship.phase.loading", message: "loading" }),
    "positioning": msg({ id: "domain.ship.phase.positioning", message: "positioning" }),
    "sailing": msg({ id: "domain.ship.phase.sailing", message: "sailing" }),
    "stranded": msg({ id: "domain.ship.phase.stranded", message: "stranded" }),
    "unloading": msg({ id: "domain.ship.phase.unloading", message: "unloading" })
  }
} as const;

/** Complete dynamic status sentences; values carry already-localized names where needed. */
export const DOMAIN_STATUS_PATTERNS = {
  banditDestroyed: msg({
    id: "domain.status.banditDestroyed",
    message: "{tier} · Destroyed · burning down · capacity {capacity}"
  }),
  banditFort: msg({
    id: "domain.status.banditFort",
    message: "{tier} · {name} · {count, plural, one {# defender} other {# defenders}} · capacity {capacity}"
  }),
  banditUndefended: msg({
    id: "domain.status.banditUndefended", message: "{tier} · Undefended · capacity {capacity}"
  }),
  banditWalls: msg({
    id: "domain.status.banditWalls",
    message: "{tier} · Undefended · walls {hp} / {maximum} · capacity {capacity}"
  }),
  boarding: msg({ id: "domain.status.boarding", message: "Boarding {aboard}/{total}" }),
  buildingStatus: msg({ id: "domain.status.buildingStatus", message: "{building}: {status}." }),
  buildingComplete: msg({ id: "domain.status.buildingComplete", message: "{building} is complete." }),
  chooseBuildingSite: msg({ id: "domain.status.chooseBuildingSite", message: "Choose a site for {building}." }),
  chooseSurveyEndpoint: msg({
    id: "domain.status.chooseSurveyEndpoint",
    message: "Choose a connected road endpoint for the {job}."
  }),
  expeditionNumber: msg({ id: "domain.status.expeditionNumber", message: "Expedition {id}" }),
  fortLost: msg({
    id: "domain.status.fortLost", message: "{building} has no defenders left: your soldiers attack its walls."
  }),
  harbourNumber: msg({ id: "domain.status.harbourNumber", message: "Harbour {id}" }),
  hostileFort: msg({
    id: "domain.status.hostileFort",
    message: "Enemy fort · {count, plural, one {# defender} other {# defenders}}"
  }),
  hostileWalls: msg({ id: "domain.status.hostileWalls", message: "Undefended · walls {hp} / {maximum}" }),
  incomingChoice: msg({
    id: "domain.status.incomingChoice", message: "{amount} {ware} ({incoming} incoming)"
  }),
  inputRequirement: msg({
    id: "domain.status.inputRequirement",
    message: "{amount} {ware} ({ready}/{amount} ready, {incoming} incoming)"
  }),
  jobTravelling: msg({ id: "domain.status.jobTravelling", message: "{job} travelling" }),
  levelingTile: msg({ id: "domain.status.levelingTile", message: "Leveling tile {current}/{total}" }),
  needsOneOf: msg({ id: "domain.status.needsOneOf", message: "Needs one of: {choices}" }),
  plannedBuilding: msg({
    id: "domain.status.plannedBuilding", message: "Planned {building}. Connect its road endpoint."
  }),
  recruitingCollect: msg({
    id: "domain.status.recruitingCollect",
    message: "Recruiting {count, plural, one {# recruit} other {# recruits}}: carriers bring the equipment"
  }),
  recruitingEquip: msg({
    id: "domain.status.recruitingEquip",
    message: "Recruiting {count, plural, one {# recruit} other {# recruits}}: equipping inside"
  }),
  recruitingSettler: msg({
    id: "domain.status.recruitingSettler",
    message: "Recruiting {count, plural, one {# recruit} other {# recruits}}: a settler is on the way"
  }),
  shipNumber: msg({ id: "domain.status.shipNumber", message: "Ship {id}" }),
  shipRequested: msg({ id: "domain.status.shipRequested", message: "Ship requested: arrives in {duration}" }),
  soldiers: msg({ id: "domain.status.soldiers", message: "{stationed}/{target} soldiers" }),
  soldiersArriving: msg({
    id: "domain.status.soldiersArriving", message: "{stationed}/{target} soldiers · {travelling} arriving"
  }),
  soldiersWaiting: msg({
    id: "domain.status.soldiersWaiting", message: "{stationed}/{target} soldiers · Waiting for stored soldiers"
  }),
  waitingForTool: msg({ id: "domain.status.waitingForTool", message: "Waiting for {tool}" }),
  waitingForInputs: msg({ id: "domain.status.waitingForInputs", message: "Waiting for {missing}" }),
  withPercent: msg({ id: "domain.status.withPercent", message: "{status} ({percent}%)" })
} as const;
