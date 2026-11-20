import { msg } from "@lingui/core/macro";

/**
 * Player-facing refusal and failure copy from domain commands. The source English sentence remains
 * the command result (so tests, logs and server semantics do not change); this map is applied only
 * where the result is shown to the player.
 */
export const DOMAIN_REFUSAL_MESSAGES = {
  exact: {
    "The paid trade storage is no longer available": msg({
      id: "domain.refusal.paidTradeStorageUnavailable",
      message: "The paid trade storage is no longer available"
    }),
    "Build a harbour on this island to collect wares": msg({
      id: "domain.refusal.collectHarbourRequired",
      message: "Build a harbour on this island to collect wares"
    }),
    "Move the local boats and hand carts before removing this last storage access": msg({
      id: "domain.refusal.lastStorageEquipment",
      message: "Move the local boats and hand carts before removing this last storage access"
    }),
    "Empty the local storage pool and finish its transport commitments before removing its last access": msg({
      id: "domain.refusal.lastStorageCommitments",
      message: "Empty the local storage pool and finish its transport commitments before removing its last access"
    }),
    "This building holds paid relief aid; wait for the collection ship to depart": msg({ id: "domain.quest.relief.refusal.paidBuilding", message: "This building holds paid relief aid; wait for the collection ship to depart" }),
    "Wait for the paid relief ship before abandoning this island": msg({ id: "domain.quest.relief.refusal.abandon", message: "Wait for the paid relief ship before abandoning this island" }),
    "Claim the completed relief rewards before sending more aid": msg({ id: "domain.quest.relief.refusal.claimPrevious", message: "Claim the completed relief rewards before sending more aid" }),
    "This colony has expired and cannot accept a new aid payment": msg({ id: "domain.quest.relief.refusal.expired", message: "This colony has expired and cannot accept a new aid payment" }),
    "This aid was returned when its collection island expired": msg({ id: "domain.quest.relief.refusal.returned", message: "This aid was returned when its collection island expired" }),
    "This relief quest has no registered payment": msg({ id: "domain.quest.relief.refusal.unregistered", message: "This relief quest has no registered payment" }),
    "This relief payment already has a different manifest": msg({ id: "domain.quest.relief.refusal.manifest", message: "This relief payment already has a different manifest" }),
    "Relief departure verification is pending": msg({ id: "domain.quest.relief.refusal.verification", message: "Relief departure verification is pending" }),
    "A commander already serves this island": msg({
      id: "domain.refusal.commanderAlreadyServes", message: "A commander already serves this island"
    }),
    "A commander already serves this player": msg({
      id: "domain.refusal.commanderPlayerCap", message: "A commander already serves this player"
    }),
    "Another island already has your commander": msg({
      id: "domain.refusal.commanderOtherIsland", message: "Another island already has your commander"
    }),
    "A completed Commander's Lodge is required": msg({
      id: "domain.refusal.commanderLodgeRequired", message: "A completed Commander's Lodge is required"
    }),
    "A mine requires usable mountain ground": msg({
      id: "domain.refusal.mineGround", message: "A mine requires usable mountain ground"
    }),
    "A ruin is being cleared here": msg({ id: "domain.refusal.plotRuin", message: "A ruin is being cleared here" }),
    "A start plot turns, so its footprint must be square": msg({
      id: "domain.refusal.startPlotSquare", message: "A start plot turns, so its footprint must be square"
    }),
    "Adventure islands are conquered by troops only": msg({
      id: "domain.refusal.adventureTroopsOnly", message: "Adventure islands are conquered by troops only"
    }),
    "Another expedition is still under way": msg({
      id: "domain.refusal.expeditionUnderWay", message: "Another expedition is still under way"
    }),
    "Another expedition is still under way: wait for it to land": msg({
      id: "domain.refusal.expeditionUnderWayWait", message: "Another expedition is still under way: wait for it to land"
    }),
    "Applied talents can only be reset": msg({
      id: "domain.refusal.appliedTalentsResetOnly", message: "Applied talents can only be reset"
    }),
    "Build every building is disabled on colonies": msg({
      id: "domain.refusal.buildAllColony", message: "Build every building is disabled on colonies"
    }),
    "Building entrance must be inside your territory": msg({
      id: "domain.refusal.entranceTerritory", message: "Building entrance must be inside your territory"
    }),
    "Building no longer exists": msg({
      id: "domain.refusal.buildingGone", message: "Building no longer exists"
    }),
    "Building signpost leaves the island grid": msg({
      id: "domain.refusal.signpostGrid", message: "Building signpost leaves the island grid"
    }),
    "Building signpost overlaps an existing plot": msg({
      id: "domain.refusal.signpostPlot", message: "Building signpost overlaps an existing plot"
    }),
    "Building signpost requires solid passable ground": msg({
      id: "domain.refusal.signpostGround", message: "Building signpost requires solid passable ground"
    }),
    "Building signpost stands in a road's reserved stone width": msg({
      id: "domain.refusal.signpostRoadWidth", message: "Building signpost stands in a road's reserved stone width"
    }),
    "Building signposts overlap": msg({
      id: "domain.refusal.signpostsOverlap", message: "Building signposts overlap"
    }),
    "Build inside your territory; station soldiers to expand it": msg({
      id: "domain.refusal.buildInTerritory", message: "Build inside your territory; station soldiers to expand it"
    }),
    "building type already exists": msg({
      id: "domain.refusal.debugBuildingExists", message: "building type already exists"
    }),
    "finish or cancel its pending upgrade first": msg({
      id: "domain.refusal.debugUpgradePending", message: "finish or cancel its pending upgrade first"
    }),
    "no building there": msg({ id: "domain.refusal.debugNoBuilding", message: "no building there" }),
    "no free plot in your territory reachable by road": msg({
      id: "domain.refusal.debugNoFreePlot", message: "no free plot in your territory reachable by road"
    }),
    "no harbour plot on your coast reachable by road": msg({
      id: "domain.refusal.debugNoHarbourPlot", message: "no harbour plot on your coast reachable by road"
    }),
    "no surveyed matching deposit in your territory reachable by road": msg({
      id: "domain.refusal.debugNoDeposit", message: "no surveyed matching deposit in your territory reachable by road"
    }),
    "not allowed on this island": msg({
      id: "domain.refusal.debugNotAllowed", message: "not allowed on this island"
    }),
    "only finished buildings you own can be raised": msg({
      id: "domain.refusal.debugOnlyFinished", message: "only finished buildings you own can be raised"
    }),
    "the island has no headquarters": msg({
      id: "domain.refusal.debugNoHeadquarters", message: "the island has no headquarters"
    }),
    "the upgrade could not be completed": msg({
      id: "domain.refusal.debugUpgradeFailed", message: "the upgrade could not be completed"
    }),
    "this building has no levels": msg({
      id: "domain.refusal.debugNoLevels", message: "this building has no levels"
    }),
    "Requires an idle player-owned ship": msg({
      id: "domain.refusal.requiresIdleShip", message: "Requires an idle player-owned ship"
    }),
    "Choose at least one soldier": msg({
      id: "domain.refusal.chooseSoldier", message: "Choose at least one soldier"
    }),
    "Invalid troop count": msg({
      id: "domain.refusal.invalidTroopCount", message: "Invalid troop count"
    }),
    "Troop limit exceeded for this difficulty": msg({
      id: "domain.refusal.troopLimit", message: "Troop limit exceeded for this difficulty"
    }),
    "ships and boats require their normal shipyard launch": msg({
      id: "domain.refusal.debugShipyardLaunch",
      message: "ships and boats require their normal shipyard launch"
    }),
    "Cannot demolish this building": msg({
      id: "domain.refusal.demolishGeneric", message: "Cannot demolish this building"
    }),
    "Capture this hostile building before demolishing it": msg({
      id: "domain.refusal.captureBeforeDemolish", message: "Capture this hostile building before demolishing it"
    }),
    "Choose a buildable building": msg({
      id: "domain.refusal.chooseBuildable", message: "Choose a buildable building"
    }),
    "Choose a completed harbour": msg({
      id: "domain.refusal.chooseCompletedHarbour", message: "Choose a completed harbour"
    }),
    "Choose a military building": msg({
      id: "domain.refusal.chooseMilitaryBuilding", message: "Choose a military building"
    }),
    "Choose a troop type and a count": msg({
      id: "domain.refusal.chooseTroopCount", message: "Choose a troop type and a count"
    }),
    "Choose a ware and a whole amount": msg({
      id: "domain.refusal.chooseWareAmount", message: "Choose a ware and a whole amount"
    }),
    "Choose an island": msg({ id: "domain.refusal.chooseIsland", message: "Choose an island" }),
    "Choose an island that is not already claimed": msg({
      id: "domain.refusal.chooseUnclaimedIsland", message: "Choose an island that is not already claimed"
    }),
    "Choose one of the offered adventures": msg({
      id: "domain.refusal.chooseOfferedAdventure", message: "Choose one of the offered adventures"
    }),
    "Choose reachable ground": msg({
      id: "domain.refusal.chooseReachableGround", message: "Choose reachable ground"
    }),
    "Choose undiscovered fog on reachable ground": msg({
      id: "domain.refusal.chooseFogGround", message: "Choose undiscovered fog on reachable ground"
    }),
    "Chosen troops cannot reach this harbour": msg({
      id: "domain.refusal.troopsCannotReach", message: "Chosen troops cannot reach this harbour"
    }),
    "Connect the Military Academy to a storehouse by road": msg({
      id: "domain.refusal.tavernRoad", message: "Connect the Military Academy to a storehouse by road"
    }),
    "Connect a storage on this island first": msg({
      id: "domain.refusal.noIslandStorage", message: "Connect a storage on this island first"
    }),
    "Connect this building to storage with a road.": msg({
      id: "domain.refusal.upgradeRoad", message: "Connect this building to storage with a road."
    }),
    "Connect a storehouse holding the recruit cost and an idle settler": msg({
      id: "domain.refusal.commanderRecruitStore",
      message: "Connect a storehouse holding the recruit cost and an idle settler"
    }),
    "Connect a storehouse to the Commander's Lodge": msg({
      id: "domain.refusal.commanderRoad", message: "Connect a storehouse to the Commander's Lodge"
    }),
    "Door swing would overlap a tree outside its plot": msg({
      id: "domain.refusal.doorTree", message: "Door swing would overlap a tree outside its plot"
    }),
    "Door swing would overlap an existing road": msg({
      id: "domain.refusal.doorRoad", message: "Door swing would overlap an existing road"
    }),
    "Door swing would overlap another building": msg({
      id: "domain.refusal.doorBuilding", message: "Door swing would overlap another building"
    }),
    "Entrance must have clear passable ground": msg({
      id: "domain.refusal.entranceGround", message: "Entrance must have clear passable ground"
    }),
    "Entrance road needs room for its full width": msg({
      id: "domain.refusal.entranceRoadWidth", message: "Entrance road needs room for its full width"
    }),
    "Entrance road would touch a neighbouring plot": msg({
      id: "domain.refusal.entranceRoadNeighbour", message: "Entrance road would touch a neighbouring plot"
    }),
    "Finish the current adventure first": msg({
      id: "domain.refusal.finishAdventure", message: "Finish the current adventure first"
    }),
    "Finish the current adventure first (sail home from it)": msg({
      id: "domain.refusal.finishAdventureSail", message: "Finish the current adventure first (sail home from it)"
    }),
    "Finish the harbour before trading": msg({
      id: "domain.refusal.finishHarbour", message: "Finish the harbour before trading"
    }),
    "Finish the Military Academy first": msg({ id: "domain.refusal.finishTavern", message: "Finish the Military Academy first" }),
    "Finish pier work or cancel passenger voyages first": msg({
      id: "domain.refusal.finishPierWork", message: "Finish pier work or cancel passenger voyages first"
    }),
    "Finish this tutorial's objective first": msg({
      id: "domain.refusal.finishTutorialObjective", message: "Finish this tutorial's objective first"
    }),
    "Foundation is not buildable": msg({
      id: "domain.refusal.foundationNotBuildable", message: "Foundation is not buildable"
    }),
    "Foundation is too steep": msg({
      id: "domain.refusal.foundationSteep", message: "Foundation is too steep"
    }),
    "Harbour needs a reachable ocean shore within 8 tiles of its entrance and room for a ship to approach": msg({
      id: "domain.refusal.harbourShore",
      message: "Harbour needs a reachable ocean shore within 8 tiles of its entrance and room for a ship to approach"
    }),
    "Keep this marble outcrop clear for quarrying": msg({
      id: "domain.refusal.keepMarble", message: "Keep this marble outcrop clear for quarrying"
    }),
    "Mill sails leave the island grid": msg({
      id: "domain.refusal.millGrid", message: "Mill sails leave the island grid"
    }),
    "Mill sails would overlap a tree outside its plot": msg({
      id: "domain.refusal.millTree", message: "Mill sails would overlap a tree outside its plot"
    }),
    "Mill sails would overlap another building": msg({
      id: "domain.refusal.millBuilding", message: "Mill sails would overlap another building"
    }),
    "No applied talents to reset": msg({
      id: "domain.refusal.noAppliedTalents", message: "No applied talents to reset"
    }),
    "No clear road route": msg({ id: "domain.refusal.noRoadRoute", message: "No clear road route" }),
    "No clear road route between these points.": msg({
      id: "domain.refusal.noRoadRouteBetween", message: "No clear road route between these points."
    }),
    "No connected previous-tier road to upgrade": msg({
      id: "domain.refusal.noPreviousRoad", message: "No connected previous-tier road to upgrade"
    }),
    "No free troops of the chosen types.": msg({
      id: "domain.refusal.noFreeTroops", message: "No free troops of the chosen types."
    }),
    "No harbour plot on your coast can be reached by road: expand your territory to the sea": msg({
      id: "domain.refusal.noHarbourPlot",
      message: "No harbour plot on your coast can be reached by road: expand your territory to the sea"
    }),
    "No idle settler in recruitment storage": msg({
      id: "domain.refusal.noIdleSettler", message: "No idle settler in recruitment storage"
    }),
    "No island is offered for this expedition": msg({
      id: "domain.refusal.noIslandOffered", message: "No island is offered for this expedition"
    }),
    "No landing beach on this island": msg({
      id: "domain.refusal.noLandingBeach", message: "No landing beach on this island"
    }),
    "No new talent points to apply": msg({
      id: "domain.refusal.noNewTalents", message: "No new talent points to apply"
    }),
    "No reachable room for every enemy camp": msg({
      id: "domain.refusal.noRoomCamps", message: "No reachable room for every enemy camp"
    }),
    "No reachable room for every enemy fort and defender": msg({
      id: "domain.refusal.noRoomForts", message: "No reachable room for every enemy fort and defender"
    }),
    "No reachable space for the opposing training troops": msg({
      id: "domain.refusal.noTrainingSpace", message: "No reachable space for the opposing training troops"
    }),
    "No reachable storehouse for this selection.": msg({
      id: "domain.refusal.noReachableStorehouse", message: "No reachable storehouse for this selection."
    }),
    "No reachable unsurveyed deposit near this ground": msg({
      id: "domain.refusal.noUnsurveyedDeposit", message: "No reachable unsurveyed deposit near this ground"
    }),
    "No sea route from this harbour to open water": msg({
      id: "domain.refusal.noSeaRoute", message: "No sea route from this harbour to open water"
    }),
    "No settlers available inside storage": msg({
      id: "domain.refusal.noSettlersInStorage", message: "No settlers available inside storage"
    }),
    "No ship is free and the water at the harbour has no room for one": msg({
      id: "domain.refusal.noFreeShip", message: "No ship is free and the water at the harbour has no room for one"
    }),
    "No storage or insufficient island storage capacity for these goods": msg({
      id: "domain.refusal.noStorageCapacity", message: "No storage or insufficient island storage capacity for these goods"
    }),
    "Offer and request must be different wares": msg({
      id: "domain.refusal.sameWare", message: "Offer and request must be different wares"
    }),
    "Only authored hostile military sites can be removed": msg({
      id: "domain.refusal.onlyAuthoredHostile", message: "Only authored hostile military sites can be removed"
    }),
    "Plot leaves the island grid": msg({
      id: "domain.refusal.plotGrid", message: "Plot leaves the island grid"
    }),
    "Plot obstructs an existing building signpost": msg({
      id: "domain.refusal.plotSignpost", message: "Plot obstructs an existing building signpost"
    }),
    "Plot obstructs an existing entrance road": msg({
      id: "domain.refusal.plotEntranceRoad", message: "Plot obstructs an existing entrance road"
    }),
    "Plot overlaps a building or its entrance": msg({
      id: "domain.refusal.plotBuilding", message: "Plot overlaps a building or its entrance"
    }),
    "Plot overlaps an active crop or charcoal site": msg({
      id: "domain.refusal.plotCrop", message: "Plot overlaps an active crop or charcoal site"
    }),
    "Plot reaches into a road's reserved stone width": msg({
      id: "domain.refusal.plotRoadWidth", message: "Plot reaches into a road's reserved stone width"
    }),
    "Quests are unavailable": msg({ id: "domain.refusal.questsUnavailable", message: "Quests are unavailable" }),
    "Resetting talents costs {gems} gems": msg({
      id: "domain.refusal.resetTalentsCost", message: "Resetting talents costs {gems} gems"
    }),
    "Snap the plot to the cell grid": msg({
      id: "domain.refusal.snapPlot", message: "Snap the plot to the cell grid"
    }),
    "Talents are unavailable": msg({
      id: "domain.refusal.talentsUnavailable", message: "Talents are unavailable"
    }),
    "The adventure failed.": msg({
      id: "domain.refusal.adventureFailed", message: "The adventure failed."
    }),
    "The colony expedition failed.": msg({
      id: "domain.refusal.colonyFailed", message: "The colony expedition failed."
    }),
    "The gem shop is unavailable": msg({
      id: "domain.refusal.gemShopUnavailable", message: "The gem shop is unavailable"
    }),
    "The harbour is this island's home and cannot be demolished": msg({
      id: "domain.refusal.harbourHome", message: "The harbour is this island's home and cannot be demolished"
    }),
    "The headquarters is your settlement's home and cannot be demolished": msg({
      id: "domain.refusal.headquartersHome", message: "The headquarters is your settlement's home and cannot be demolished"
    }),
    "The island has no headquarters": msg({
      id: "domain.refusal.islandNoHeadquarters", message: "The island has no headquarters"
    }),
    "The island needs a finished harbour for the trade ship": msg({
      id: "domain.refusal.tradeHarbour", message: "The island needs a finished harbour for the trade ship"
    }),
    "The required mineral is absent": msg({
      id: "domain.refusal.mineralAbsent", message: "The required mineral is absent"
    }),
    "The trade ship cannot reach the harbour from the open sea": msg({
      id: "domain.refusal.tradeNoSeaWay", message: "The trade ship cannot reach the harbour from the open sea"
    }),
    "The training encounter cannot start here.": msg({
      id: "domain.refusal.trainingCannotStart", message: "The training encounter cannot start here."
    }),
    "This adventure has already begun": msg({
      id: "domain.refusal.adventureBegun", message: "This adventure has already begun"
    }),
    "This adventure island has no home building": msg({
      id: "domain.refusal.adventureNoHome", message: "This adventure island has no home building"
    }),
    "This building cannot start another upgrade.": msg({
      id: "domain.refusal.upgradeUnavailable", message: "This building cannot start another upgrade."
    }),
    "This colony is already settled": msg({
      id: "domain.refusal.colonySettled", message: "This colony is already settled"
    }),
    "This island needs a harbour to trade": msg({
      id: "domain.refusal.tradeNeedsHarbour", message: "This island needs a harbour to trade"
    }),
    "This offer is no longer active": msg({
      id: "domain.refusal.offerInactive", message: "This offer is no longer active"
    }),
    "This offer is no longer available (expired)": msg({
      id: "domain.refusal.offerExpired", message: "This offer is no longer available (expired)"
    }),
    "This offer is not available": msg({
      id: "domain.refusal.offerUnavailable", message: "This offer is not available"
    }),
    "This item is not available for purchase": msg({
      id: "domain.refusal.itemUnavailable", message: "This item is not available for purchase"
    }),
    "This offer was already taken": msg({
      id: "domain.refusal.offerTaken", message: "This offer was already taken"
    }),
    "This quest is already done": msg({
      id: "domain.refusal.questDone", message: "This quest is already done"
    }),
    "This specialist requires a colony with its matching resource pair": msg({
      id: "domain.refusal.specialistColony", message: "This specialist requires a colony with its matching resource pair"
    }),
    "This talent is at its highest rank": msg({
      id: "domain.refusal.talentMaxRank", message: "This talent is at its highest rank"
    }),
    "This tutorial cannot be skipped": msg({
      id: "domain.refusal.tutorialCannotSkip", message: "This tutorial cannot be skipped"
    }),
    "This tutorial is not active": msg({
      id: "domain.refusal.tutorialInactive", message: "This tutorial is not active"
    }),
    "The gem shop is closed on campaign maps": msg({
      id: "domain.refusal.gemShopCampaignClosed", message: "The gem shop is closed on campaign maps"
    }),
    "Not available on this map": msg({
      id: "domain.refusal.notOnThisMap", message: "Not available on this map"
    }),
    "A campaign map is under way; finish or give it up first": msg({
      id: "domain.refusal.campaignUnderWay", message: "A campaign map is under way; finish or give it up first"
    }),
    "A colony is still contested; conquer or disband it first": msg({
      id: "domain.refusal.colonyContested", message: "A colony is still contested; conquer or disband it first"
    }),
    "Commander is already assigned to a campaign": msg({
      id: "domain.refusal.commanderOnCampaign", message: "Commander is already assigned to a campaign"
    }),
    "Trading is only available on your home island": msg({
      id: "domain.refusal.tradeHomeOnly", message: "Trading is only available on your home island"
    }),
    "Training encounter already started": msg({
      id: "domain.refusal.trainingStarted", message: "Training encounter already started"
    }),
    "Tutorial quests are completed on your home island": msg({
      id: "domain.refusal.tutorialHomeOnly", message: "Tutorial quests are completed on your home island"
    }),
    "Tutorials are unavailable": msg({
      id: "domain.refusal.tutorialsUnavailable", message: "Tutorials are unavailable"
    }),
    "Unknown building": msg({ id: "domain.refusal.unknownBuilding", message: "Unknown building" }),
    "Unknown surveying job": msg({
      id: "domain.refusal.unknownSurveyJob", message: "Unknown surveying job"
    }),
    "Unknown talent": msg({ id: "domain.refusal.unknownTalent", message: "Unknown talent" }),
    "Invalid talent ranks": msg({
      id: "domain.refusal.invalidTalentRanks", message: "Invalid talent ranks"
    }),
    "More talent points than the level grants": msg({
      id: "domain.refusal.tooManyTalentPoints", message: "More talent points than the level grants"
    }),
    "No talent points left": msg({
      id: "domain.refusal.noTalentPoints", message: "No talent points left"
    }),
    "Carriers are bringing the paid wares to the harbour": msg({
      id: "domain.refusal.tradeCollecting", message: "Carriers are bringing the paid wares to the harbour"
    }),
    "Waiting for a free trade ship": msg({
      id: "domain.refusal.tradeWaitingShip", message: "Waiting for a free trade ship"
    })
  },
  patterns: {
    activeOfferLimit: msg({
      id: "domain.refusal.activeOfferLimit", message: "You already have {limit} active offers"
    }),
    adventureWon: msg({ id: "domain.refusal.adventureWon", message: "{island}: adventure won!" }),
    colonyConquered: msg({ id: "domain.refusal.colonyConquered", message: "{island} is conquered!" }),
    colonyMaterialProducers: msg({
      id: "domain.refusal.colonyMaterialProducers",
      message: "This colony requires producers for its {wood} and {stone} resource pair"
    }),
    enemyOutpost: msg({ id: "domain.refusal.enemyOutpost", message: "Enemy outpost {number}" }),
    enemyOutpostStock: msg({
      id: "domain.refusal.enemyOutpostStock",
      message: "Enemy outpost · {recruits} recruits · {beer} beer"
    }),
    fortDestroyed: msg({ id: "domain.refusal.fortDestroyed", message: "{building} destroyed! It burns down." }),
    notEnoughTroops: msg({
      id: "domain.refusal.notEnoughTroops", message: "Not enough stored {troop}"
    }),
    needsGems: msg({ id: "domain.refusal.needsGems", message: "Needs {count} more gems" }),
    notEnoughOnIsland: msg({
      id: "domain.refusal.notEnoughOnIsland", message: "Not enough {ware} on this island (missing {missing})"
    }),
    notEnoughStock: msg({
      id: "domain.refusal.notEnoughStock", message: "Not enough free {ware}: needs {amount}, {free} free"
    }),
    quarryStoneDeposit: msg({
      id: "domain.refusal.quarryStoneDeposit", message: "This quarry needs a {stone} deposit on the island"
    }),
    requestCapacity: msg({
      id: "domain.refusal.requestCapacity",
      message: "Request exceeds free storage for {ware}: {amount} asked, room for {room}"
    }),
    requiresBranchPoints: msg({
      id: "domain.refusal.requiresBranchPoints", message: "Requires {points} points in this branch"
    }),
    requiresLevel: msg({ id: "domain.refusal.requiresLevel", message: "Requires level {level}" }),
    requiresIdleSettlers: msg({
      id: "domain.refusal.requiresIdleSettlers", message: "Requires {required} idle settlers ({available} available)"
    }),
    requiresEligibleSoldiers: msg({
      id: "domain.refusal.requiresEligibleSoldiers",
      message: "Requires {required} eligible soldiers ({available} available)"
    }),
    requiresTierPoints: msg({
      id: "domain.refusal.requiresTierPoints",
      message: "Requires {points} points in tier {tier} of this branch"
    }),
    reservedRecruits: msg({
      id: "domain.refusal.reservedRecruits", message: "; {wares} reserved for queued recruits"
    }),
    storageFull: msg({ id: "domain.refusal.storageFull", message: "Storage for {ware} is full" }),
    talentRequiresBranch: msg({
      id: "domain.refusal.talentRequiresBranch", message: "Talent {id} requires {points} branch points"
    }),
    talentRequiresLevel: msg({
      id: "domain.refusal.talentRequiresLevel", message: "Talent {id} requires level {level}"
    }),
    talentRequiresTier: msg({
      id: "domain.refusal.talentRequiresTier",
      message: "Talent {id} requires {points} points in tier {tier} of this branch"
    }),
    tavernMissing: msg({ id: "domain.refusal.tavernMissing", message: "Missing {wares}" }),
    tradeProtectedFloor: msg({
      id: "domain.refusal.tradeProtectedFloor",
      message: "Trading keeps at least {floor} {ware} in stock (protected)"
    }),
    unlocksAtLevel: msg({
      id: "domain.refusal.unlocksAtLevel", message: "Unlocks at player level {level}"
    }),
    upgradeNeedsWares: msg({
      id: "domain.refusal.upgradeNeedsWares", message: "Needs {wares} in connected storage."
    }),
    wareLevelLocked: msg({
      id: "domain.refusal.wareLevelLocked", message: "{ware} unlocks at player level {level}"
    }),
    wareNotTradable: msg({
      id: "domain.refusal.wareNotTradable", message: "{ware} cannot be traded"
    })
  }
} as const;
