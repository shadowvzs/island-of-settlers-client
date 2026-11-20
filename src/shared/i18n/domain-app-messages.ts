import { msg } from "@lingui/core/macro";

/**
 * Player notices composed by application adapters (notices that are not a command result), plus the
 * offline-summary copy. Values are inserted as named ICU placeholders so translators can reorder them.
 */
export const DOMAIN_APP_MESSAGES = {
  exact: {
    "Offer cancelled: the wares return.": msg({
      id: "domain.app.offerCancelled", message: "Offer cancelled: the wares return."
    }),
    "Offer placed at the Market.": msg({
      id: "domain.app.offerPlaced", message: "Offer placed at the Market."
    }),
    "Purchase paid: a trade ship brings the wares.": msg({
      id: "domain.app.purchasePaid", message: "Purchase paid: a trade ship brings the wares."
    }),
    "The island is changing. Try again in a moment.": msg({
      id: "domain.app.islandChanging", message: "The island is changing. Try again in a moment."
    }),
    "Adventure troops have landed: visit the island from the Colonies panel.": msg({
      id: "domain.app.adventureLanded",
      message: "Adventure troops have landed: visit the island from the Colonies panel."
    }),
    "Build every building is disabled on colonies.": msg({
      id: "domain.app.buildAllDisabled", message: "Build every building is disabled on colonies."
    }),
    "Building every building...": msg({
      id: "domain.app.buildAllRunning", message: "Building every building..."
    }),
    "Colony expedition has landed: the colony harbour is ready.": msg({
      id: "domain.app.colonyLanded", message: "Colony expedition has landed: the colony harbour is ready."
    }),
    "No ground under the cursor.": msg({
      id: "domain.app.noGroundUnderCursor", message: "No ground under the cursor."
    }),
    "Victory: the campaign map is won.": msg({
      id: "domain.app.campaignVictory", message: "Victory: the campaign map is won."
    }),
    "Defeat: the campaign map is lost.": msg({
      id: "domain.app.campaignDefeat", message: "Defeat: the campaign map is lost."
    }),
    "The landing harbour fell: the campaign map is lost.": msg({
      id: "domain.app.campaignHarbourLost", message: "The landing harbour fell: the campaign map is lost."
    }),
    "Scenario completed.": msg({
      id: "domain.app.scenarioCompleted", message: "Scenario completed."
    }),
    "Scenario expired.": msg({ id: "domain.app.scenarioExpired", message: "Scenario expired." }),
    "Ship returning to the home island": msg({
      id: "domain.app.shipReturningHome", message: "Ship returning to the home island"
    }),
    "Ship sailing to the colony harbour": msg({
      id: "domain.app.shipSailingToColony", message: "Ship sailing to the colony harbour"
    }),
    "Ship waiting for soldiers at the harbour": msg({
      id: "domain.app.shipWaitingForSoldiers", message: "Ship waiting for soldiers at the harbour"
    }),
    "Signed in: gems come only from the server (an admin grant).": msg({
      id: "domain.app.serverGemsOnly", message: "Signed in: gems come only from the server (an admin grant)."
    }),
    "Soldiers boarding the ship": msg({
      id: "domain.app.soldiersBoarding", message: "Soldiers boarding the ship"
    }),
    "The home island has no planks, stone or food to send.": msg({
      id: "domain.app.homeNoSupplies", message: "The home island has no planks, stone or food to send."
    }),
    "Adventure expedition preparing: the troops gather at the harbour.": msg({
      id: "domain.app.adventurePreparing",
      message: "Adventure expedition preparing: the troops gather at the harbour."
    }),
    "Building demolished. Unconsumed stock recovered; its crew returns home.": msg({
      id: "domain.app.buildingDemolished",
      message: "Building demolished. Unconsumed stock recovered; its crew returns home."
    }),
    "Building plan placed. Connect its road endpoint to another road.": msg({
      id: "domain.app.buildingPlanPlaced",
      message: "Building plan placed. Connect its road endpoint to another road."
    }),
    "Choose a building, then connect its road endpoint with a dirt road.": msg({
      id: "domain.app.chooseBuildingLead",
      message: "Choose a building, then connect its road endpoint with a dirt road."
    }),
    "Choose a public road section.": msg({
      id: "domain.app.choosePublicRoad", message: "Choose a public road section."
    }),
    "Choose an enemy building to siege, or ground for an attack move.": msg({
      id: "domain.app.chooseSiegeTarget", message: "Choose an enemy building to siege, or ground for an attack move."
    }),
    "Choose clear ground. Soldiers retreat there and ignore enemies on the way.": msg({
      id: "domain.app.chooseRetreatGround",
      message: "Choose clear ground. Soldiers retreat there and ignore enemies on the way."
    }),
    "Choose clear ground. Soldiers will move there.": msg({
      id: "domain.app.chooseMoveGround", message: "Choose clear ground. Soldiers will move there."
    }),
    "Choose open land for the rally banner.": msg({
      id: "domain.app.chooseRallyLand", message: "Choose open land for the rally banner."
    }),
    "Choose reachable land.": msg({ id: "domain.app.chooseReachableLand", message: "Choose reachable land." }),
    "Choose a reachable friendly military building with room for infantry.": msg({
      id: "domain.app.chooseGarrisonBuilding",
      message: "Choose a reachable friendly military building with room for infantry."
    }),
    "Choose the road's second endpoint.": msg({
      id: "domain.app.chooseRoadEndpoint", message: "Choose the road's second endpoint."
    }),
    "Choose where to plant the rally banner. The called troops march there.": msg({
      id: "domain.app.chooseRallyPlace", message: "Choose where to plant the rally banner. The called troops march there."
    }),
    "Choose your military building.": msg({
      id: "domain.app.chooseEnterBuilding",
      message: "Choose your military building."
    }),
    "Colony expedition preparing: troops, crew and supplies gather at the harbour.": msg({
      id: "domain.app.colonyPreparing",
      message: "Colony expedition preparing: troops, crew and supplies gather at the harbour."
    }),
    "Colony expedition cancelled; troops and supplies return.": msg({
      id: "domain.app.colonyCancelled", message: "Colony expedition cancelled; troops and supplies return."
    }),
    "Dirt road connected.": msg({ id: "domain.app.dirtRoadConnected", message: "Dirt road connected." }),
    "Disbanding the colony; its garrison sails home.": msg({
      id: "domain.app.disbandingColony", message: "Disbanding the colony; its garrison sails home."
    }),
    "Exploration expedition queued; the scout returns home.": msg({
      id: "domain.app.explorationQueued", message: "Exploration expedition queued; the scout returns home."
    }),
    "Exploration needs an idle settler, a spyglass, an idle ship and an unexplored reachable shore.": msg({
      id: "domain.app.explorationNeeds",
      message: "Exploration needs an idle settler, a spyglass, an idle ship and an unexplored reachable shore."
    }),
    "Headquarters is the starting building.": msg({
      id: "domain.app.headquartersStarting", message: "Headquarters is the starting building."
    }),
    "No building under the cursor.": msg({
      id: "domain.app.noBuildingUnderCursor", message: "No building under the cursor."
    }),
    "No eligible troops can reach that target.": msg({
      id: "domain.app.noEligibleTroops", message: "No eligible troops can reach that target."
    }),
    "No sea route or cargo available.": msg({
      id: "domain.app.noSeaRouteOrCargo", message: "No sea route or cargo available."
    }),
    "No valid shore, or an expedition is already active.": msg({
      id: "domain.app.noValidShore", message: "No valid shore, or an expedition is already active."
    }),
    "Order accepted.": msg({ id: "domain.app.orderAccepted", message: "Order accepted." }),
    "Cannot place here": msg({ id: "domain.app.cannotPlaceHere", message: "Cannot place here" }),
    "Surveying is unavailable": msg({
      id: "domain.app.surveyingUnavailable", message: "Surveying is unavailable"
    }),
    "Passenger voyage cannot be queued.": msg({
      id: "domain.app.passengerRefused", message: "Passenger voyage cannot be queued."
    }),
    "Passenger voyage queued.": msg({ id: "domain.app.passengerQueued", message: "Passenger voyage queued." }),
    "Preparing expedition: carriers collect supplies and crew await a ship.": msg({
      id: "domain.app.preparingExpedition", message: "Preparing expedition: carriers collect supplies and crew await a ship."
    }),
    "Purchase delivered to your home storage.": msg({
      id: "domain.app.purchaseDelivered", message: "Purchase delivered to your home storage."
    }),
    "Quest completed!": msg({ id: "domain.app.questCompleted", message: "Quest completed!" }),
    "Raise building level is off.": msg({
      id: "domain.app.buildingLevelOff", message: "Raise building level is off."
    }),
    "Raise building level: click a building. Escape or the button turns it off.": msg({
      id: "domain.app.buildingLevelOn",
      message: "Raise building level: click a building. Escape or the button turns it off."
    }),
    "Recruits ordered: carriers bring the equipment to the Military Academy.": msg({
      id: "domain.app.recruitsOrdered", message: "Recruits ordered: carriers bring the equipment to the Military Academy."
    }),
    "Road section removed.": msg({ id: "domain.app.roadRemoved", message: "Road section removed." }),
    "Sailing home…": msg({ id: "domain.app.sailingHome", message: "Sailing home…" }),
    "Sailing to the colony…": msg({ id: "domain.app.sailingToColony", message: "Sailing to the colony…" }),
    "Sea cargo order queued.": msg({ id: "domain.app.seaCargoQueued", message: "Sea cargo order queued." }),
    "Selected soldiers are in a door duel. Wait for it to finish before moving them.": msg({
      id: "domain.app.doorDuel",
      message: "Selected soldiers are in a door duel. Wait for it to finish before moving them."
    }),
    "Settlement expedition queued.": msg({
      id: "domain.app.settlementExpeditionQueued", message: "Settlement expedition queued."
    }),
    "Soldiers returning to their closest reachable storehouse.": msg({
      id: "domain.app.soldiersReturning", message: "Soldiers returning to their closest reachable storehouse."
    }),
    "Training encounter ready. Select troops using the right-side soldier icon.": msg({
      id: "domain.app.trainingReady",
      message: "Training encounter ready. Select troops using the right-side soldier icon."
    }),
    "Tutorial objective complete. Open Quests to claim your reward.": msg({
      id: "domain.app.tutorialObjectiveComplete",
      message: "Tutorial objective complete. Open Quests to claim your reward."
    }),
    "Upgrade cancelled; unconsumed deliveries will return to storage.": msg({
      id: "domain.app.upgradeCancelled",
      message: "Upgrade cancelled; unconsumed deliveries will return to storage."
    }),
    "Upgrade requested. Delivered materials and a builder are required.": msg({
      id: "domain.app.upgradeRequested",
      message: "Upgrade requested. Delivered materials and a builder are required."
    }),
    "No enemy spawned: no walkable ground your troops can reach near that point.": msg({
      id: "domain.app.noEnemySpawned", message: "No enemy spawned: no walkable ground your troops can reach near that point."
    }),
    "No soldier added: this island has no home building.": msg({
      id: "domain.app.noSoldierAdded", message: "No soldier added: this island has no home building."
    }),
    "Choose a public road section": msg({
      id: "domain.app.choosePublicRoadBadge", message: "Choose a public road section"
    }),
    "Choose road end": msg({ id: "domain.app.chooseRoadEnd", message: "Choose road end" }),
    "Choose road start": msg({ id: "domain.app.chooseRoadStart", message: "Choose road start" }),
    "Click to build this road": msg({ id: "domain.app.clickBuildRoad", message: "Click to build this road" }),
    "Click to remove this road section": msg({
      id: "domain.app.clickRemoveRoad", message: "Click to remove this road section"
    }),
    "R to rotate": msg({ id: "domain.app.rotateHint", message: "R to rotate" }),
    "tap again to build": msg({ id: "domain.app.tapAgain", message: "tap again to build" })
  },
  patterns: {
    jobDispatched: msg({ id: "domain.app.jobDispatched", message: "{job} dispatched." }),
    buildAll: msg({
      id: "domain.app.buildAll",
      message: "Built {count, plural, one {# finished building} other {# finished buildings}} with roads."
    }),
    buildAllSkipped: msg({ id: "domain.app.buildAllSkipped", message: "Skipped: {reasons}." }),
    claimNotConfirmed: msg({
      id: "domain.app.claimNotConfirmed", message: "The server did not confirm this claim: {reason}"
    }),
    colonyExpiredHome: msg({
      id: "domain.app.colonyExpiredHome",
      message: "{island} expired; its remaining settlers, troops and goods returned home."
    }),
    colonyExpiredHarbour: msg({
      id: "domain.app.colonyExpiredHarbour",
      message: "{island} expired; its remaining units and goods returned to the home harbour."
    }),
    enemySpawned: msg({
      id: "domain.app.enemySpawned", message: "Enemy {troop} (rank {rank}) spawned."
    }),
    handcartGrantedMany: msg({
      id: "domain.app.handcartGrantedMany", message: "{count} hand carts added to the {storages}."
    }),
    handcartGrantedOne: msg({
      id: "domain.app.handcartGrantedOne", message: "A hand cart added to the {storages}."
    }),
    handcartRefused: msg({
      id: "domain.app.handcartRefused",
      message: "No hand cart granted: every storage already keeps {limit} hand carts (carts on the road included)."
    }),
    infantryEntering: msg({
      id: "domain.app.infantryEntering",
      message: "{count} soldiers entering the garrison."
    }),
    produceMore: msg({
      id: "domain.app.produceMore", message: "Produce {count} more {ware} first"
    }),
    questNeedsWare: msg({ id: "domain.app.questNeedsWare", message: "Needs {ware} in storage" }),
    rallyPlantedBuilding: msg({
      id: "domain.app.rallyPlantedBuilding",
      message: "Rally banner planted. {count} soldiers attack the building it marks."
    }),
    rallyPlantedMarch: msg({
      id: "domain.app.rallyPlantedMarch", message: "Rally banner planted. {count} soldiers march to it."
    }),
    resourceShip: msg({
      id: "domain.app.resourceShip", message: "Resource ship from {island}: {wares}."
    }),
    rewardShip: msg({
      id: "domain.app.rewardShip", message: "The reward ship brings {wares} from the adventure."
    }),
    roadUpgradeRefused: msg({
      id: "domain.app.roadUpgradeRefused",
      message: "No connected previous-tier road to upgrade, or insufficient {label}. Upgrade one tier at a time."
    }),
    roadUpgraded: msg({ id: "domain.app.roadUpgraded", message: "Road upgraded to {label}." }),
    soldiersCalled: msg({
      id: "domain.app.soldiersCalled", message: "{count} soldiers called to the rally banner."
    }),
    surveyDispatched: msg({
      id: "domain.app.surveyDispatched", message: "{job} dispatched from storage."
    }),
    soldiersSailedHome: msg({
      id: "domain.app.soldiersSailedHome", message: "{count} soldiers sailed home from the colony."
    }),
    supplyShip: msg({
      id: "domain.app.supplyShip", message: "Supply ship from home: {wares}."
    }),
    oreShip: msg({
      id: "domain.app.oreShip", message: "Ore ship sailed home with {wares}."
    }),
    troopGranted: msg({
      id: "domain.app.troopGranted", message: "{troop} (rank {rank}) added to the home garrison."
    }),
    upgradedTo: msg({
      id: "domain.app.upgradedTo", message: "{building} raised to level {level}."
    }),
    upgradeRefusal: msg({ id: "domain.app.upgradeRefusal", message: "{building}: {reason}." }),
    addedOutputs: msg({
      id: "domain.app.addedOutputs", message: "Added {items} outputs to {buildings} buildings.{detail}"
    }),
    scenarioCompletedCoins: msg({
      id: "domain.app.scenarioCompletedCoins", message: "Scenario completed — {coins} coin reward."
    }),
    maxPlayerLevel: msg({
      id: "domain.app.maxPlayerLevel", message: "Already at maximum player level {level}."
    }),
    shipArriving: msg({ id: "domain.app.shipArriving", message: "Ship arriving in {duration}" }),
    gemsGranted: msg({ id: "domain.app.gemsGranted", message: "{gems} gems granted." }),
    goldGranted: msg({
      id: "domain.app.goldGranted", message: "{coins} gold coins added to the headquarters."
    }),
    navigationFailure: msg({
      id: "domain.app.navigationFailure",
      message: "{job} cannot reach its destination; goods are retained."
    }),
    playerLevel: msg({
      id: "domain.app.playerLevel", message: "Player level {before} → {after}."
    }),
  },
  hints: {
    builderMaterials: msg({
      id: "domain.hint.builderMaterials", message: "The builder needs the remaining materials delivered to this site."
    }),
    checkWorkArea: msg({
      id: "domain.hint.checkWorkArea", message: "Check the selected work area for a usable resource and clear access."
    }),
    connectStorage: msg({
      id: "domain.hint.connectStorage",
      message: "Connect this building's entrance to a completed storage with a road."
    }),
    depositEmpty: msg({
      id: "domain.hint.depositEmpty", message: "This deposit has no remaining resource. Survey or choose another deposit."
    }),
    fieldSpace: msg({
      id: "domain.hint.fieldSpace", message: "Leave usable field space inside the selected farm area."
    }),
    handcartRoom: msg({
      id: "domain.hint.handcartRoom", message: "Make room for a hand cart in a connected storage."
    }),
    inputPolicy: msg({
      id: "domain.hint.inputPolicy",
      message: "{missing}. Check the input producers and storage supply policies."
    }),
    materialDeposit: msg({
      id: "domain.hint.materialDeposit",
      message: "Requires a reachable {stone} deposit within 24 tiles. Deposits are finite."
    }),
    matureTree: msg({
      id: "domain.hint.matureTree",
      message: "Requires a mature {tree} tree within reach; other species cannot be harvested."
    }),
    ordersComplete: msg({
      id: "domain.hint.ordersComplete", message: "The requested quantity is complete. Add another order to continue."
    }),
    outputFull: msg({
      id: "domain.hint.outputFull", message: "The output court is full. Check connected storage and its receiving policy."
    }),
    populationLimit: msg({
      id: "domain.hint.populationLimit",
      message: "Population limit reached. Build a residence to raise the limit, or free an existing worker."
    }),
    productionPaused: msg({
      id: "domain.hint.productionPaused", message: "Production is paused. Use Resume when you are ready."
    }),
    returnRoute: msg({
      id: "domain.hint.returnRoute", message: "The worker cannot currently return. Inspect the route and entrances."
    }),
    settlerWait: msg({
      id: "domain.hint.settlerWait",
      message: "There are no idle settlers available to take this job. The headquarters gains a settler every {seconds} seconds{suffix} while the island is below its population limit."
    }),
    talentChange: msg({ id: "domain.hint.talentChange", message: " ({sign}{percent}% talent)" }),
    toolRequirement: msg({
      id: "domain.hint.toolRequirement",
      message: "A {tool} must be available in road-connected storage to assign this worker."
    }),
    unsafeEntrance: msg({
      id: "domain.hint.unsafeEntrance", message: "The entrance is not currently safe to use. Inspect its approach."
    }),
    waitingCloth: msg({
      id: "domain.hint.waitingCloth",
      message: "The hull needs cloth before rigging can finish. Weave cloth, then let road-connected carriers deliver it to this shipyard."
    })
  },
  offline: {
    capped: msg({ id: "domain.offline.capped", message: "Production stopped after one day away." }),
    colonyEnded: msg({ id: "domain.offline.colonyEnded", message: "The colony on {island} ended." }),
    discarded: msg({
      id: "domain.offline.discarded",
      message: "Offline production for {duration} was discarded; calendar deadlines advanced to now."
    }),
    experience: msg({ id: "domain.offline.experience", message: "You earned {experience} experience." }),
    gains: msg({ id: "domain.offline.gains", message: "Your storages gained {wares}." }),
    summary: msg({ id: "domain.offline.summary", message: "While you were away ({duration}): {parts}" })
  }
} as const;
