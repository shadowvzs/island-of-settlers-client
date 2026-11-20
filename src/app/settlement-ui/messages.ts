/* oxlint-disable max-lines -- one feature-owned catalog keeps every settlement-ui message and ID auditable. */
import { msg } from "@lingui/core/macro";

/**
 * Settlement UI and HUD copy. Descriptors stay lazy; resolve them through the active Lingui instance
 * at render/use time so a language change updates live windows, labels and statuses.
 */
export const SETTLEMENT_MESSAGES = {
  inventory: {
    empty: msg({ id: "settlement.inventory.empty", message: "No wares stored here." }),
    unavailable: msg({ id: "settlement.inventory.unavailable", message: "Stock information is not available." })
  },
  common: {
    loading: msg({ id: "settlement.common.loading", message: "Loading {name}…" }),
    featureMapOff: msg({ id: "settlement.common.featureMapOff", message: "Not available on this island" }),
    loadFailed: msg({
      id: "settlement.common.loadFailed",
      message: "{name} could not load. Close and reopen to retry."
    }),
    apply: msg({ id: "settlement.common.apply", message: "Apply" }),
    cancel: msg({ id: "settlement.common.cancel", message: "Cancel" }),
    claim: msg({ id: "settlement.common.claim", message: "Claim" }),
    close: msg({ id: "settlement.common.close", message: "Close" }),
    demolish: msg({ id: "settlement.common.demolish", message: "Demolish" }),
    discard: msg({ id: "settlement.common.discard", message: "Discard" }),
    done: msg({ id: "settlement.common.done", message: "Done" }),
    keep: msg({ id: "settlement.common.keep", message: "Keep" }),
    none: msg({ id: "settlement.common.none", message: "None" }),
    ok: msg({ id: "settlement.common.ok", message: "OK" }),
    remove: msg({ id: "settlement.common.remove", message: "Remove" }),
    retry: msg({ id: "settlement.common.retry", message: "Retry" }),
    xp: msg({ id: "settlement.common.xp", message: "{amount} XP" }),
    plusXp: msg({ id: "settlement.common.plusXp", message: "+{amount} XP" }),
    levelBadge: msg({ id: "settlement.common.levelBadge", message: "Lv {level}" }),
    buildingLevel: msg({ id: "settlement.common.buildingLevel", message: "Level {level}" }),
    talentBonus: msg({ id: "settlement.common.talentBonus", message: " (+{percent}% talent)" }),
    talentReduction: msg({ id: "settlement.common.talentReduction", message: " (−{percent}% talent)" }),
    maxLevelXp: msg({ id: "settlement.common.maxLevelXp", message: "{amount} XP · max level" })
  },
  hud: {
    placement: {
      sendJob: msg({ id: "settlement.hud.placement.sendJob", message: "Send {job}" }),
      removeRoad: msg({ id: "settlement.hud.placement.removeRoad", message: "Remove road section" }),
      buildDirtRoad: msg({ id: "settlement.hud.placement.buildDirtRoad", message: "Build dirt road" }),
      roadUpgrade: msg({ id: "settlement.hud.placement.roadUpgrade", message: "{road} road upgrade" }),
      placeBuilding: msg({ id: "settlement.hud.placement.placeBuilding", message: "Place building" }),
      placeNamed: msg({ id: "settlement.hud.placement.placeNamed", message: "Place {name}" })
    },
    player: {
      quests: msg({ id: "settlement.hud.player.quests", message: "Quests" }),
      questsReady: msg({ id: "settlement.hud.player.questsReady", message: "Quests: {count} ready to claim" }),
      talents: msg({ id: "settlement.talents.title", message: "Talents" }),
      talentPoint: msg({ id: "settlement.hud.player.talentPoint", message: "Talents: {count} point to place" }),
      talentPoints: msg({ id: "settlement.hud.player.talentPoints", message: "Talents: {count} points to place" }),
      openQuests: msg({ id: "settlement.hud.player.openQuests", message: "Open daily quests" }),
      population: msg({ id: "settlement.hud.player.population", message: "Population: {population} people" }),
      populationLimit: msg({
        id: "settlement.hud.player.populationLimit",
        message: "Population: {population} people of at most {limit}"
      }),
      populationGrowth: msg({
        id: "settlement.hud.player.populationGrowth",
        message: "Population: {population} people of at most {limit}. While below the limit the headquarters gains a settler every {growth}"
      }),
      growth: msg({ id: "settlement.hud.player.growth", message: "{seconds} seconds" }),
      growthBonus: msg({
        id: "settlement.hud.player.growthBonus",
        message: "{seconds} seconds (+{percent}% talent)"
      }),
      experience: msg({
        id: "settlement.hud.player.experience",
        message: "{current} / {needed} XP"
      }),
      levelLocked: msg({
        id: "settlement.hud.player.levelLocked",
        message: "Level {level} · fixed by this map"
      }),
      experienceTotal: msg({
        id: "settlement.hud.player.experienceTotal",
        message: "Level {level} · {experience} XP in total"
      }),
      experienceTotalMonument: msg({
        id: "settlement.hud.player.experienceTotalMonument",
        message: "Level {level} · {experience} XP in total · Monument: +25% XP"
      })
    }
  },
  menu: {
    buildings: msg({ id: "settlement.menu.buildings", message: "Buildings" }),
    overview: msg({ id: "settlement.menu.overview", message: "Overview" }),
    ships: msg({ id: "settlement.menu.ships", message: "Ships" }),
    shipsTitle: msg({ id: "settlement.menu.shipsTitle", message: "Ships on this island" }),
    market: msg({ id: "settlement.menu.market", message: "Market" }),
    marketTitle: msg({ id: "settlement.menu.marketTitle", message: "Player Market" }),
    settings: msg({ id: "settings.panel.title", message: "Settings" }),
    titleBuild: msg({ id: "settlement.menu.titleBuild", message: "Build your settlement" }),
    titleMenu: msg({ id: "settlement.menu.mainSelection", message: "Main selection" }),
    titleNotices: msg({ id: "notifications.settings.title", message: "Notifications" }),
    titleShips: msg({ id: "settlement.menu.titleShips", message: "Fleet" }),
    mainSelection: msg({ id: "settlement.menu.mainSelection", message: "Main selection" }),
    windowName: msg({ id: "settlement.menu.windowName", message: "settlement" }),
    news: msg({ id: "settlement.menu.news", message: "News from your settlement." }),
    noNews: msg({ id: "settlement.menu.noNews", message: "No new notifications." }),
    warning: msg({ id: "settlement.menu.warning", message: "Attention needed" }),
    settlementNews: msg({ id: "settlement.menu.settlementNews", message: "Settlement news" }),
    buildingGone: msg({ id: "domain.refusal.buildingGone", message: "Building no longer exists" }),
    goToBuilding: msg({ id: "settings.camera.goTo", message: "Go to {name}" })
  },
  build: {
    categories: msg({ id: "settlement.build.categories", message: "Building categories" }),
    roads: msg({ id: "settlement.build.roads", message: "Roads" }),
    road: msg({ id: "settlement.build.road", message: "{road} road" }),
    speed: msg({ id: "settlement.build.speed", message: "{speed}% walking speed" }),
    dirtTitle: msg({
      id: "settlement.build.dirtTitle",
      message: "Connect road endpoints to build a dirt road."
    }),
    pavedTitle: msg({
      id: "settlement.build.pavedTitle",
      message: "Upgrade {previous} → {tier}: {speed}% walking speed. Uses matching material; upgrades one tier at a time."
    }),
    lockedTitle: msg({ id: "settlement.build.lockedTitle", message: "{label} · {reason}" }),
    bridgeWood: msg({ id: "settlement.bridge.nameWood", message: "Wooden bridge" }),
    bridgeStone: msg({ id: "settlement.bridge.nameStone", message: "Stone bridge" }),
    bridgeTitle: msg({
      id: "settlement.build.bridgeTitle",
      message: "{kind} over an inland river · {cost} per tile · {min}–{max} tiles · builder construction"
    }),
    bridgeDeck: msg({ id: "settlement.build.bridgeDeck", message: "2.6 deck · 2 lanes" }),
    bridgeCostWood: msg({ id: "settlement.build.bridgeCostWood", message: "1 plank + 2 logs per tile" }),
    bridgeCostStone: msg({ id: "settlement.build.bridgeCostStone", message: "2 stone + 1 plank per tile" }),
    vergeFlowers: msg({ id: "settlement.build.vergeFlowers", message: "Roadside flowers" }),
    vergeFlowersCost: msg({ id: "settlement.build.vergeFlowersCost", message: "1 plank / tile" }),
    vergeFlowersTitle: msg({
      id: "settlement.build.vergeFlowersTitle",
      message: "Plant flowers on a chosen road stretch: click its start, then its end. Carriers deliver the planks."
    }),
    removeRoad: msg({ id: "settlement.build.removeRoad", message: "Remove road" }),
    removeRoadTitle: msg({
      id: "settlement.build.removeRoadTitle",
      message: "Click a public road section to remove it"
    }),
    requiresLevel: msg({
      id: "settlement.build.requiresLevel",
      message: "Requires level {level} (you are level {levelNow})"
    }),
    chooseHint: msg({
      id: "settlement.build.chooseHint",
      message: "Choose a building, then place it on the island."
    }),
    selectedDetail: msg({
      id: "settlement.build.selectedDetail",
      message: "{name} · {worker} · {role}"
    }),
    cardTitle: msg({ id: "settlement.build.cardTitle", message: "{name} · {role}" }),
    cardLockedTitle: msg({ id: "settlement.build.cardLockedTitle", message: "{name} · {reason}" }),
    alreadyBuilt: msg({ id: "settlement.build.alreadyBuilt", message: "Already built" }),
    requiresTier: msg({
      id: "settlement.build.requiresTier",
      message: "Needs material tier {tier}; this map allows tier {cap} at most"
    }),
    tierBadge: msg({ id: "settlement.build.tierBadge", message: "Tier {tier}" }),
    homeSandbox: msg({ id: "settlement.build.homeSandbox", message: "Home sandbox" }),
    homeSandboxOffTitle: msg({
      id: "settlement.build.homeSandboxOffTitle",
      message: "Home sandbox: open every building and building level on your home island, whatever your player level. No penalty: quests still give experience. Colonies and campaigns keep their map rules."
    }),
    homeSandboxOnTitle: msg({
      id: "settlement.build.homeSandboxOnTitle",
      message: "Home sandbox is on: every building and level is open on your home island. Click to return to normal level progression (existing buildings stay)."
    })
  },
  details: {
    title: msg({ id: "settlement.details.title", message: "Building details" }),
    catapultAmmo: {
      aria: msg({ id: "settlement.details.catapultAmmo.aria", message: "Catapult ammunition" }),
      title: msg({ id: "settlement.details.catapultAmmo.title", message: "Stone kind for new deliveries" }),
      choose: msg({ id: "settlement.details.catapultAmmo.choose", message: "Choose {name} ammunition" }),
      effect: msg({
        id: "settlement.details.catapultAmmo.effect",
        message: "{name}: range ×{range}, impact ×{impact}, damage ×{damage}, flight ×{flight}"
      }),
      summary: msg({
        id: "settlement.details.catapultAmmo.summary",
        message: "{name}: range {tiles} tiles{range}, impact radius {impact}, damage {damage}, flight time {flight}"
      }),
      normal: msg({ id: "settlement.details.catapultAmmo.normal", message: "normal" }),
      split: msg({
        id: "settlement.details.catapultAmmo.split",
        message: "Splits into 5 fragments in flight; each deals 35% damage over a smaller area."
      }),
      direct: msg({
        id: "settlement.details.catapultAmmo.direct",
        message: "Flies faster and damages only what it hits directly."
      })
    },
    workProgress: msg({ id: "settlement.details.workProgress", message: "Production work progress" }),
    workProgressText: msg({ id: "settlement.details.workProgressText", message: "{label}: {percent}%" }),
    quarryNote: msg({
      id: "settlement.details.quarryNote",
      message: "Finite {stone} outcrops: {count} blocks remaining on this island. The quarry works within 24 tiles and uses only its matching stone material."
    }),
    monumentNote: msg({
      id: "settlement.details.monumentNote",
      message: "Monument bonus: +25% experience from every gain, and 3 veteran melee defenders at the harbour of every new colony and campaign landing."
    }),
    whyWaiting: msg({ id: "settlement.details.whyWaiting", message: "Why waiting: {reason}" }),
    pause: msg({ id: "settlement.details.pause", message: "Stop" }),
    resume: msg({ id: "settlement.details.resume", message: "Resume" }),
    pauseTitle: msg({
      id: "settlement.details.pauseTitle",
      message: "Finish the current cycle, then stop starting new work"
    }),
    demolishCaption: msg({ id: "settlement.common.demolish", message: "Demolish" }),
    demolishLabel: msg({
      id: "settlement.details.demolishLabel",
      message: "Demolish this building or construction plan"
    }),
    level: msg({ id: "settlement.details.level", message: "Level {level}" }),
    levelUnderConstruction: msg({
      id: "settlement.details.levelUnderConstruction",
      message: "Level {level} · Under construction"
    }),
    levelCancelling: msg({
      id: "settlement.details.levelCancelling",
      message: "Level {level} · Cancelling upgrade"
    }),
    levelUpgrading: msg({
      id: "settlement.details.levelUpgrading",
      message: "Level {level} · Upgrading to level {next}"
    }),
    levelAria: msg({ id: "settlement.details.levelAria", message: "Building level" }),
    construction: {
      aria: msg({ id: "settlement.details.construction.aria", message: "Construction details" }),
      progress: msg({ id: "settlement.details.construction.progress", message: "Construction: {percent}%" }),
      progressLabel: msg({ id: "settlement.details.construction.progressLabel", message: "Construction progress" }),
      ground: msg({ id: "settlement.details.construction.ground", message: "Ground preparation: {percent}%" }),
      waiting: msg({ id: "settlement.details.construction.waiting", message: "Waiting for construction" }),
      materials: msg({ id: "settlement.details.construction.materials", message: "Construction materials" }),
      material: msg({ id: "settlement.details.construction.material", message: "Material" }),
      required: msg({ id: "settlement.details.construction.required", message: "Required" }),
      delivered: msg({ id: "settlement.details.construction.delivered", message: "Delivered" }),
      inTransit: msg({ id: "settlement.details.construction.inTransit", message: "In transit" })
    },
    garrison: {
      aria: msg({ id: "settlement.details.garrison.aria", message: "Garrison" }),
      focus: msg({ id: "settlement.details.garrison.focus", message: "Training focus" }),
      focusBalanced: msg({
        id: "settlement.details.garrison.focusBalanced",
        message: "Balanced — lowest rank first"
      }),
      focusElite: msg({ id: "settlement.details.garrison.focusElite", message: "Elite — veterans first" }),
      auto: msg({ id: "settlement.details.garrison.auto", message: "Auto" }),
      autoTitle: msg({
        id: "settlement.details.garrison.autoTitle",
        message: "Fill automatically: archers on the towers first, melee for the rest"
      }),
      keepLast: msg({
        id: "settlement.details.garrison.keepLast",
        message: "At least one soldier must remain in an occupied building"
      }),
      wanted: msg({ id: "settlement.details.garrison.wanted", message: "{name} wanted" }),
      fewer: msg({ id: "settlement.details.garrison.fewer", message: "One fewer of the {name}" }),
      more: msg({ id: "settlement.details.garrison.more", message: "One more of the {name}" }),
      stock: msg({ id: "settlement.details.garrison.stock", message: "{stationed} in · {stored} free" }),
      stockHome: msg({
        id: "settlement.details.garrison.stockHome",
        message: "{stationed} in · {stored} free · {home} at home"
      }),
      supplies: msg({ id: "settlement.details.garrison.supplies", message: "Military supplies" }),
      coinsAllowed: msg({
        id: "settlement.details.garrison.coinsAllowed",
        message: "Coin deliveries allowed. Click to stop new coin deliveries."
      }),
      coinsBlocked: msg({
        id: "settlement.details.garrison.coinsBlocked",
        message: "Coin deliveries stopped. Click to allow new coin deliveries."
      }),
      coinsStored: msg({ id: "settlement.details.garrison.coinsStored", message: "Coins stored here" }),
      drinkStored: msg({
        id: "settlement.details.garrison.drinkStored",
        message: "{drink} stored here"
      }),
      onTheWay: msg({ id: "settlement.details.garrison.onTheWay", message: "{count} on the way" }),
      insideHeading: msg({ id: "settlement.details.garrison.insideHeading", message: "Inside now" }),
      insideEmpty: msg({
        id: "settlement.details.garrison.insideEmpty",
        message: "No soldiers are inside yet."
      }),
      insideRow: msg({
        id: "settlement.details.garrison.insideRow",
        message: "{count} {troop}, {rank}"
      }),
      planHeading: msg({ id: "settlement.details.garrison.planHeading", message: "Requested garrison" }),
      arriving: msg({ id: "settlement.details.garrison.arriving", message: "{count} arriving" }),
      requested: msg({ id: "settlement.details.garrison.requested", message: "{count} requested" }),
      headingPosts: msg({
        id: "settlement.details.garrison.headingPosts",
        message: "Garrison {inside}/{capacity} · {posts} tower posts for archers"
      }),
      headingWindows: msg({
        id: "settlement.details.garrison.headingWindows",
        message: "Garrison {inside}/{capacity} · archers fight from the windows"
      }),
      trainingNote: msg({
        id: "settlement.details.garrison.trainingNote",
        message: "One coin and one {drink} promote one stationed soldier by one rank."
      })
    },
    commander: {
      aria: msg({ id: "settlement.details.commander.heading", message: "Commander" }),
      heading: msg({ id: "settlement.details.commander.heading", message: "Commander" }),
      empty: msg({
        id: "settlement.details.commander.empty",
        message: "No commander serves this island yet."
      }),
      recruit: msg({ id: "settlement.details.commander.recruit", message: "Recruit commander" }),
      selector: msg({ id: "settlement.details.commander.selector", message: "Choose a commander" }),
      recruitCost: msg({ id: "settlement.details.commander.recruitCost", message: "Recruit cost" }),
      recruitRequirement: msg({
        id: "settlement.details.commander.recruitRequirement",
        message: "Requires one idle settler and a road-connected storehouse holding the full cost."
      }),
      missing: msg({ id: "settlement.details.commander.missing", message: "Missing: {items}." }),
      idleSettlers: msg({
        id: "settlement.details.commander.idleSettlers",
        message: "{count} idle settlers available"
      }),
      level: msg({ id: "settlement.details.commander.level", message: "Level {level}" }),
      xpProgress: msg({
        id: "settlement.details.commander.xpProgress",
        message: "Experience: {xp} / {next}"
      }),
      maximumLevel: msg({
        id: "settlement.details.commander.maximumLevel",
        message: "Level 3. Maximum level reached."
      }),
      hp: msg({ id: "settlement.details.commander.hp", message: "HP: {current} / {maximum}" }),
      hpReady: msg({
        id: "settlement.details.commander.hpReady",
        message: "Deployment requires at least {required} HP (50%)."
      }),
      restingRate: msg({
        id: "settlement.details.commander.restingRate",
        message: "Restores 1% of maximum HP per game minute while resting here."
      }),
      statusResting: msg({
        id: "settlement.details.commander.statusResting",
        message: "Resting at the Commander's Lodge."
      }),
      statusRecovering: msg({
        id: "settlement.details.commander.statusRecovering",
        message: "Recovering · {minutes} min remaining. Healing continues concurrently."
      }),
      statusTooInjured: msg({
        id: "settlement.details.commander.statusTooInjured",
        message: "Too injured to deploy: at least 50% HP is required."
      }),
      statusIncapacitated: msg({
        id: "settlement.details.commander.statusIncapacitated",
        message: "Incapacitated. Return the commander to the Commander's Lodge to recover."
      }),
      statusAwaitingEvacuation: msg({
        id: "settlement.details.commander.statusAwaitingEvacuation",
        message: "Awaiting a return ship. Recovery begins after arrival at the Commander's Lodge."
      }),
      statusAwaitingHome: msg({
        id: "settlement.details.commander.statusAwaitingHome",
        message: "No reachable friendly Commander's Lodge is available. Recovery is paused until a home is assigned and reached."
      }),
      statusAssigned: msg({
        id: "settlement.details.commander.statusAssigned",
        message: "Assigned to an expedition. Return the commander before selecting another."
      }),
      statusMustering: msg({
        id: "settlement.details.commander.statusMustering",
        message: "Mustering for {destination}. The commander is walking to the harbour boarding point."
      }),
      statusDeployed: msg({
        id: "settlement.details.commander.statusDeployed",
        message: "Deployed to {destination}. Return the commander before selecting another expedition."
      }),
      statusReady: msg({
        id: "settlement.details.commander.statusReady",
        message: "Available for deployment. The expedition still needs a valid ship and route."
      }),
      deckSlots: msg({
        id: "settlement.details.commander.deckSlots",
        message: "Expedition space: 1 troop-cap unit and {slots} deck slots (rider and mount)."
      }),
      roleOffensive: msg({ id: "settlement.details.commander.roleOffensive", message: "Offensive" }),
      roleDefensive: msg({ id: "settlement.details.commander.roleDefensive", message: "Defensive" }),
      styleMelee: msg({ id: "settlement.details.commander.styleMelee", message: "Melee" }),
      styleRanged: msg({ id: "settlement.details.commander.styleRanged", message: "Ranged" }),
      loadoutAxe: msg({ id: "domain.ware.axe", message: "Axe" }),
      loadoutBow: msg({ id: "domain.ware.bow", message: "Bow" }),
      loadoutSword: msg({ id: "domain.ware.sword", message: "Sword" }),
      auraNubian: msg({
        id: "settlement.details.commander.auraNubian",
        message: "Aura: nearby friendly units deal 5% more bow damage within 6 tiles."
      }),
      auraViking: msg({
        id: "settlement.details.commander.auraViking",
        message: "Aura: nearby friendly units deal 5% more melee damage within 6 tiles."
      }),
      auraRoman: msg({
        id: "settlement.details.commander.auraRoman",
        message: "Aura: nearby friendly units take 5% less arrow damage within 6 tiles."
      }),
      auraJapanese: msg({
        id: "settlement.details.commander.auraJapanese",
        message: "Aura: nearby friendly units avoid 5% of otherwise connected melee hits within 6 tiles."
      }),
      levelUp: msg({
        id: "settlement.details.commander.levelUp",
        message: "Level up commander"
      }),
      levelUpTitle: msg({
        id: "settlement.details.commander.levelUpTitle",
        message: "Advance this commander to the next level. Maximum level: 3. Administrator tool."
      }),
      recoveryComplete: msg({
        id: "settlement.details.commander.recoveryComplete",
        message: "Recovery period complete."
      })
    },
    harbour: {
      pageTitle: msg({
        id: "settlement.details.harbour.pageTitle",
        message: "Harbour"
      }),
      explore: msg({
        id: "settlement.details.harbour.explore",
        message: "Send one spyglass-equipped scout to unknown shores, then return home"
      }),
      exploreCaption: msg({
        id: "settlement.details.harbour.exploreCaption",
        message: "Explore expedition"
      }),
      exploreAccepted: msg({
        id: "settlement.details.harbour.exploreAccepted",
        message: "The scout will explore nearby shores and return home."
      }),
      exploreRefused: msg({
        id: "settlement.details.harbour.exploreRefused",
        message: "Requires an idle settler, a spyglass, an idle ship and an unexplored reachable shore."
      }),
      scoutingActive: msg({
        id: "settlement.details.harbour.scoutingActive",
        message: "A scouting expedition from this harbour is already under way."
      }),
      scoutingMissingScout: msg({
        id: "settlement.details.harbour.scoutingMissingScout",
        message: "Needs an idle settler who can reach this harbour."
      }),
      scoutingMissingSpyglass: msg({
        id: "settlement.details.harbour.scoutingMissingSpyglass",
        message: "Needs a free spyglass at this harbour."
      }),
      scoutingWaitingShip: msg({
        id: "settlement.details.harbour.scoutingWaitingShip",
        message: "Waiting for an idle ship that can reach this harbour."
      }),
      settle: msg({
        id: "settlement.details.harbour.settle",
        message: "Find a new island harbour site"
      }),
      settleCaption: msg({
        id: "settlement.details.harbour.settleCaption",
        message: "Settlement expedition"
      }),
      colony: msg({
        id: "settlement.details.harbour.colony",
        message: "Send troops, a builder and supplies to conquer a distant island"
      }),
      colonyCaption: msg({
        id: "settlement.planner.titleColony",
        message: "Colony expedition"
      }),
      adventure: msg({
        id: "settlement.details.harbour.adventure",
        message: "Send troops only to conquer a random enemy island for experience, coins and wares"
      }),
      adventureCaption: msg({
        id: "settlement.planner.titleAdventure",
        message: "Adventure expedition"
      }),
      noShore: msg({
        id: "settlement.details.harbour.noShore",
        message: "No reachable new island shore has a clear harbour foundation."
      }),
      potentialSettlement: msg({
        id: "settlement.details.harbour.potentialSettlement",
        message: "Potential settlement"
      }),
      potentialSite: msg({
        id: "settlement.details.harbour.potentialSite",
        message: "Discovered harbour spot {index} at {x}, {z}"
      }),
      occupyHarbour: msg({
        id: "settlement.details.harbour.occupyHarbour",
        message: "Occupy this harbour spot and prepare a settlement expedition"
      }),
      occupyCaption: msg({
        id: "settlement.details.harbour.occupyCaption",
        message: "Occupy"
      }),
      busy: msg({
        id: "settlement.details.harbour.busy",
        message: "Finish or cancel the current expedition first"
      }),
      noTarget: msg({
        id: "settlement.details.harbour.noTarget",
        message: "No target island available"
      }),
      nextShore: msg({ id: "settlement.details.harbour.nextShore", message: "Next shore" }),
      foundHarbour: msg({ id: "settlement.details.harbour.foundHarbour", message: "Found harbour" }),
      cancelPreparation: msg({
        id: "settlement.details.harbour.cancelPreparation",
        message: "Cancel preparation"
      }),
      launchAccepted: msg({
        id: "settlement.details.harbour.launchAccepted",
        message: "Preparing expedition; missing supplies arrive by carrier, then a ship launches it."
      }),
      launchRefused: msg({
        id: "settlement.fleet.expeditionRefused",
        message: "Check supplies, settlers and shore access."
      }),
      orderCancelled: msg({
        id: "settlement.details.harbour.orderCancelled",
        message: "Expedition cancelled; crew and paid supplies return safely."
      }),
      orderDone: msg({
        id: "settlement.details.harbour.orderDone",
        message: "Expedition already completed."
      }),
      preparationCancelled: msg({
        id: "settlement.details.harbour.preparationCancelled",
        message: "Preparation cancelled; reserved supplies and crew returned."
      }),
      preparationLaunched: msg({
        id: "settlement.details.harbour.preparationLaunched",
        message: "Preparation already launched."
      }),
      shuttle: msg({ id: "settlement.details.harbour.shuttle", message: "Nearby boat shuttle" }),
      shippingDemand: msg({
        id: "settlement.details.harbour.shippingDemand",
        message: "Supply {cargo}: {status}"
      }),
      shippingWaitingSource: msg({
        id: "settlement.details.harbour.shippingWaitingSource",
        message: "waiting for source stock"
      }),
      shippingWaitingShip: msg({
        id: "settlement.details.harbour.shippingWaitingShip",
        message: "waiting for a ship"
      }),
      shippingBatching: msg({
        id: "settlement.details.harbour.shippingBatching",
        message: "waiting to combine with other wares"
      }),
      shippingInTransit: msg({
        id: "settlement.details.harbour.shippingInTransit",
        message: "in transit"
      }),
      shippingOutstanding: msg({
        id: "settlement.details.harbour.shippingOutstanding",
        message: "outstanding"
      }),
      shippingRouteLost: msg({
        id: "settlement.details.harbour.shippingRouteLost",
        message: "no safe sea route"
      }),
      shippingStorageFull: msg({
        id: "settlement.details.harbour.shippingStorageFull",
        message: "receiving storage full"
      }),
      shippingNotAccepted: msg({
        id: "settlement.details.harbour.shippingNotAccepted",
        message: "receiving harbour refuses this ware"
      }),
      shippingNoHarbour: msg({
        id: "settlement.details.harbour.shippingNoHarbour",
        message: "no reachable receiving harbour"
      }),
      shippingReduced: msg({
        id: "settlement.details.harbour.shippingReduced",
        message: "demand reduced; cargo stays aboard"
      }),
      shuttleActive: msg({
        id: "settlement.details.harbour.shuttleActive",
        message: "Boat shuttle to harbour {destination}: {cargo} · {seconds}s left"
      }),
      shuttleCargoBlocked: msg({
        id: "settlement.details.harbour.shuttleCargoBlocked",
        message: "Boat shuttle holding {cargo}: no safe port"
      }),
      shuttleDestinationFull: msg({
        id: "settlement.details.harbour.shuttleDestinationFull",
        message: "Boat shuttle holding {cargo}: destination full"
      }),
      shuttleRouteBlocked: msg({
        id: "settlement.details.harbour.shuttleRouteBlocked",
        message: "Boat shuttle waiting: water route blocked"
      }),
      shuttleIdle: msg({
        id: "settlement.details.harbour.shuttleIdle",
        message: "Boat shuttle ready · {boats} available boat(s) · {rowers} idle rower(s)"
      }),
      shuttleNoCrew: msg({
        id: "settlement.details.harbour.shuttleNoCrew",
        message: "Boat shuttle waiting for two idle rowers"
      }),
      shuttleNoLanding: msg({
        id: "settlement.details.harbour.shuttleNoLanding",
        message: "Boat shuttle unavailable: no safe dedicated boat landing"
      }),
      shuttleNoPartner: msg({
        id: "settlement.details.harbour.shuttleNoPartner",
        message: "Boat shuttle unavailable: no nearby completed harbour"
      }),
      shuttleNoRoute: msg({
        id: "settlement.details.harbour.shuttleNoRoute",
        message: "Boat shuttle unavailable: no safe water route within 1.5× fishery range"
      }),
      shuttleWaitingBoat: msg({
        id: "settlement.details.harbour.shuttleWaitingBoat",
        message: "Boat shuttle waiting for a stored boat"
      }),
      shore: msg({
        id: "settlement.details.harbour.shore",
        message: "Shore {index}/{total}: {x}, {z} · Builder, shovel worker and carrier · 4 planks, 6 stone, 1 hammer, 1 shovel"
      }),
      preparation: msg({
        id: "settlement.details.harbour.preparation",
        message: "Preparing: {status} · Planks {planks}/4 · Stone {stone}/6 · Hammer {hammer}/1 · Shovel {shovel}/1 · Crew {crew}/3"
      }),
      preparationCrew: msg({
        id: "settlement.details.harbour.preparationCrew",
        message: "Waiting for builder, shovel worker and carrier"
      }),
      preparationReady: msg({ id: "settlement.details.harbour.preparationReady", message: "Ready to sail" }),
      preparationShore: msg({
        id: "settlement.details.harbour.preparationShore",
        message: "Waiting for a reachable shore route"
      }),
      preparationShip: msg({ id: "settlement.details.harbour.preparationShip", message: "Waiting for a free ship" }),
      preparationSupplies: msg({
        id: "settlement.details.harbour.preparationSupplies",
        message: "Waiting for carrier deliveries"
      }),
      cancelExploration: msg({
        id: "settlement.details.harbour.cancelExploration",
        message: "Cancel exploration {id}"
      }),
      cancelSettlement: msg({
        id: "settlement.details.harbour.cancelSettlement",
        message: "Cancel settlement {id}"
      }),
      market: msg({ id: "settlement.menu.market", message: "Market" }),
      marketTitle: msg({
        id: "settlement.details.harbour.marketTitle",
        message: "Market: buy from merchants, place your own offers"
      })
    },
    production: {
      chooseOutput: msg({ id: "settlement.details.production.chooseOutput", message: "Choose output" }),
      outputRefused: msg({
        id: "settlement.details.production.outputRefused",
        message: "Output change refused. Current work and production orders are unchanged."
      }),
      input: msg({ id: "settlement.details.production.input", message: "Input" }),
      inputWares: msg({ id: "settlement.details.production.inputWares", message: "Input wares" }),
      output: msg({ id: "settlement.details.production.output", message: "Output" }),
      producedWares: msg({ id: "settlement.details.production.producedWares", message: "Produced wares" }),
      randomTools: msg({ id: "settlement.details.production.randomTools", message: "Random tools" }),
      randomToolsCount: msg({
        id: "settlement.details.production.randomToolsCount",
        message: "Random tools: {count}"
      }),
      produce: msg({ id: "settlement.details.production.produce", message: "Produce {name}" }),
      allInTurn: msg({ id: "settlement.details.production.allInTurn", message: "All products in turn" }),
      waresAria: msg({ id: "settlement.details.production.waresAria", message: "Production wares" }),
      shipyardProduct: msg({
        id: "settlement.details.production.shipyardProduct",
        message: "Shipyard product"
      }),
      boats: msg({ id: "settlement.details.production.boats", message: "Boats" }),
      ships: msg({ id: "settlement.menu.ships", message: "Ships" }),
      boatsHelp: msg({
        id: "settlement.details.production.boatsHelp",
        message: "Small boats carry cargo and eligible civilian passengers between a harbour and a waiting ship. A harbour needs its own completed boat, available crew and a safe landing; headquarters stock alone does not activate every port."
      }),
      shipsHelp: msg({
        id: "settlement.details.production.shipsHelp",
        message: "Sea ships carry goods, passengers, troops and commanders on voyages and expeditions."
      }),
      boatRequirement: msg({
        id: "settlement.details.production.boatRequirement",
        message: "Requires {planks, plural, one {# softwood plank} other {# softwood planks}}. No cloth required."
      }),
      shipRequirement: msg({
        id: "settlement.details.production.shipRequirement",
        message: "Requires {planks, plural, one {# softwood plank} other {# softwood planks}} and {cloth, plural, one {# cloth} other {# cloth}}."
      }),
      shipyardProgress: msg({
        id: "settlement.details.production.shipyardProgress",
        message: "Hull: {planks}/{planksRequired} planks · Rigging: {cloth}/{clothRequired} cloth."
      }),
      shipyardBoatProgress: msg({
        id: "settlement.details.production.shipyardBoatProgress",
        message: "Boat planks used: {planks}/{planksRequired}."
      }),
      shipyardStored: msg({
        id: "settlement.details.production.shipyardStored",
        message: "Stored here: {storedPlanks} planks, {storedCloth} cloth · Incoming: {incomingPlanks} planks, {incomingCloth} cloth."
      }),
      riggingIncomplete: msg({
        id: "settlement.details.production.riggingIncomplete",
        message: "Rigging incomplete: {cloth} of {clothRequired} cloth fitted. The hull waits at the site for cloth."
      }),
      toggle: msg({
        id: "settlement.details.production.toggle",
        message: "{current}: click to produce {next}"
      }),
      recipeLocked: msg({
        id: "settlement.details.production.recipeLocked",
        message: "Unlocks at sawmill level {level}"
      }),
      recipeDetail: msg({
        id: "settlement.details.production.recipeDetail",
        message: "1 {input} → 1 {output} · {seconds}s. Applies to the next cycle."
      }),
      handcartTitle: msg({
        id: "settlement.details.production.handcartTitle",
        message: "{logs} softwood logs → 1 hand cart. Carriers collect completed carts for storage buildings with room."
      }),
      handcarts: msg({ id: "settlement.details.production.handcarts", message: "Hand carts" }),
      sawmillStatus: msg({
        id: "settlement.details.production.sawmillStatus",
        message: "{input}: {available} stored, {incoming} incoming. Current work finishes first. Carriers collect unused old logs, including late deliveries. Select planks or hand carts above."
      }),
      sawmillStatusNeeds: msg({
        id: "settlement.details.production.sawmillStatusNeeds",
        message: "{input}: {available} stored, {incoming} incoming. Needs {count} {ware}. Current work finishes first. Carriers collect unused old logs, including late deliveries. Select planks or hand carts above."
      }),
      sawmillRefused: msg({
        id: "settlement.details.production.sawmillRefused",
        message: "Recipe change refused. Refresh the building to check its level and current state."
      }),
      orders: msg({ id: "settlement.details.production.orders", message: "Production orders" }),
      remaining: msg({ id: "settlement.details.production.remaining", message: "{name} remaining" }),
      fewer: msg({ id: "settlement.details.production.fewer", message: "Produce one fewer {ware}" }),
      more: msg({ id: "settlement.details.production.more", message: "Produce one more {ware}" }),
      unlimited: msg({ id: "settlement.details.production.unlimited", message: "Unlimited {ware} production" }),
      deposit: msg({ id: "settlement.details.production.deposit", message: "Deposit" }),
      seedlings: msg({ id: "settlement.details.production.seedlings", message: "Seedlings" }),
      trees: msg({ id: "settlement.details.production.trees", message: "Trees" }),
      fishingGround: msg({ id: "settlement.details.production.fishingGround", message: "Fishing ground" }),
      wildlife: msg({ id: "settlement.details.production.wildlife", message: "Wildlife" }),
      waterSource: msg({ id: "settlement.details.production.waterSource", message: "Water source" }),
      wheatField: msg({ id: "settlement.details.production.wheatField", message: "Wheat field" }),
      beehive: msg({ id: "settlement.details.production.beehive", message: "Beehive" }),
      palmTree: msg({ id: "settlement.details.production.palmTree", message: "Palm tree" }),
      ricePlants: msg({ id: "settlement.details.production.ricePlants", message: "Rice plants" }),
      vinePlant: msg({ id: "settlement.details.production.vinePlant", message: "Vine plant" }),
      teaBush: msg({ id: "settlement.details.production.teaBush", message: "Tea bush" }),
      pomegranateTree: msg({ id: "settlement.details.production.pomegranateTree", message: "Pomegranate tree" }),
      cacaoTree: msg({ id: "settlement.details.production.cacaoTree", message: "Cacao tree" }),
      berryBush: msg({ id: "settlement.details.production.berryBush", message: "Berry bush" }),
      fisherMethod: msg({ id: "settlement.details.production.fisherMethod", message: "Fishing method" }),
      fishWith: msg({ id: "settlement.details.production.fishWith", message: "Fish with: {name}" }),
      fisherRod: msg({ id: "settlement.details.production.fisherRod", message: "Rod" }),
      fisherRodHelp: msg({
        id: "settlement.details.production.fisherRodHelp",
        message: "Fish from the shore with a rod: one fish per cast."
      }),
      fisherBoat: msg({ id: "settlement.details.production.fisherBoat", message: "Boat" }),
      fisherBoatHelp: msg({
        id: "settlement.details.production.fisherBoatHelp",
        message: "Row out with a boat and haul a net: 4 fish per trip. Reserves one boat from a storehouse on this island; a carrier brings it."
      }),
      fisherBoatNoShore: msg({
        id: "settlement.details.production.fisherBoatNoShore",
        message: "Boat unavailable: no sea or lake shore within this fishery's work area where a boat can be launched. River banks cannot be used."
      }),
      fisherBoatNoBoat: msg({
        id: "settlement.details.production.fisherBoatNoBoat",
        message: "Boat unavailable: no spare boat in a storehouse on this island. A Shipwright in Boats mode builds one from a plank."
      }),
      fisherBoatWaiting: msg({
        id: "settlement.details.production.fisherBoatWaiting",
        message: "Boat: waiting for a carrier."
      }),
      fisherBoatIncoming: msg({
        id: "settlement.details.production.fisherBoatIncoming",
        message: "Boat: on the way."
      }),
      fisherBoatYard: msg({
        id: "settlement.details.production.fisherBoatYard",
        message: "Boat: in the yard."
      }),
      fisherBoatShore: msg({
        id: "settlement.details.production.fisherBoatShore",
        message: "Boat: parked at the shore."
      }),
      fisherBoatCarried: msg({
        id: "settlement.details.production.fisherBoatCarried",
        message: "Boat: being carried."
      }),
      fisherBoatAfloat: msg({
        id: "settlement.details.production.fisherBoatAfloat",
        message: "Boat: on the water."
      }),
      fisherBoatDropped: msg({
        id: "settlement.details.production.fisherBoatDropped",
        message: "Boat: left on the ground."
      })
    },
    residence: {
      aria: msg({ id: "settlement.details.residence.aria", message: "Residence" }),
      seconds: msg({ id: "settlement.details.residence.seconds", message: "{seconds} s" }),
      minutes: msg({ id: "settlement.details.residence.minutes", message: "{minutes} min" }),
      minutesSeconds: msg({
        id: "settlement.details.residence.minutesSeconds",
        message: "{minutes} min {seconds} s"
      }),
      harbour: msg({ id: "settlement.details.residence.harbour", message: "the colony harbour" }),
      headquarters: msg({ id: "settlement.details.residence.headquarters", message: "the headquarters" }),
      note: msg({
        id: "settlement.details.residence.note",
        message: "This residence's settlers are born at {home}, in addition to its own growth. Growth pauses while the island is at its population limit."
      }),
      noteTalent: msg({
        id: "settlement.details.residence.noteTalent",
        message: "This residence's settlers are born at {home}, in addition to its own growth. Growth pauses while the island is at its population limit. Your talent bonuses are included."
      }),
      limit: msg({ id: "settlement.details.residence.limit", message: "Population limit" }),
      extraSettler: msg({
        id: "settlement.details.residence.extraSettler",
        message: "Extra settler at {home}"
      }),
      period: msg({ id: "settlement.details.residence.period", message: "1 every {period}" })
    },
    soldiers: {
      aria: msg({ id: "settlement.details.soldiers.aria", message: "Soldiers in this building" }),
      heading: msg({ id: "settlement.details.soldiers.heading", message: "Soldiers" }),
      storedTotal: msg({
        id: "settlement.details.soldiers.storedTotal",
        message: "{count, plural, one {# soldier stored here} other {# soldiers stored here}}"
      }),
      storageNote: msg({
        id: "settlement.details.soldiers.storageNote",
        message: "Grouped by troop type and rank."
      }),
      groupLabel: msg({
        id: "settlement.details.soldiers.groupLabel",
        message: "{troop} · {rank}"
      }),
      groupTitle: msg({
        id: "settlement.details.soldiers.groupTitle",
        message: "{count} × {label}"
      }),
      wounded: msg({
        id: "settlement.details.soldiers.wounded",
        message: "{count} wounded · {health}/{maximum} HP"
      }),
      empty: msg({
        id: "settlement.details.soldiers.empty",
        message: "No soldiers are stored here."
      }),
      emptyDetails: msg({
        id: "settlement.details.soldiers.emptyDetails",
        message: "No soldiers are stationed or arriving here."
      }),
      row: msg({
        id: "settlement.details.soldiers.row",
        message: "{troop} #{number} · {rank} · {health}/{maximum} HP · {phase}"
      }),
      rankRecruit: msg({ id: "domain.job.recruit", message: "Recruit" }),
      rankSoldier: msg({ id: "domain.job.soldier", message: "Soldier" }),
      rankVeteran: msg({ id: "settlement.details.soldiers.rankVeteran", message: "Veteran" }),
      phaseAssigned: msg({
        id: "settlement.details.soldiers.phaseAssigned",
        message: "Travelling to garrison"
      }),
      phaseEnterAssigned: msg({
        id: "settlement.details.soldiers.phaseEnterAssigned",
        message: "Entering garrison"
      }),
      phaseEnterRetire: msg({
        id: "settlement.details.soldiers.phaseEnterRetire",
        message: "Entering storage"
      }),
      phaseGarrison: msg({ id: "settlement.details.soldiers.phaseGarrison", message: "Stationed" }),
      phaseField: msg({ id: "settlement.details.soldiers.phaseField", message: "In the field" }),
      phaseLeaving: msg({ id: "settlement.details.soldiers.phaseLeaving", message: "Leaving garrison" }),
      phaseReserve: msg({ id: "settlement.details.soldiers.phaseReserve", message: "Stored" }),
      phaseSiege: msg({ id: "settlement.details.soldiers.phaseSiege", message: "Attacking" }),
      phaseTransfer: msg({
        id: "settlement.details.soldiers.phaseTransfer",
        message: "Changing garrison"
      }),
      phaseRetire: msg({ id: "settlement.details.soldiers.phaseRetire", message: "Returning to storage" }),
      phaseTravelling: msg({ id: "settlement.details.soldiers.phaseTravelling", message: "Travelling" })
    },
    storage: {
      collect: msg({ id: "settlement.details.storage.collect", message: "Collect" }),
      collectHint: msg({
        id: "settlement.details.storage.collectHint",
        message: "Activate, then select multiple wares to bring from other islands."
      }),
      collectSelected: msg({
        id: "settlement.details.storage.collectSelected", message: " · Selected for collection"
      }),
      collectElsewhere: msg({
        id: "settlement.details.storage.collectElsewhere", message: "Already collected by another harbour"
      }),
      wareCell: msg({
        id: "settlement.details.storage.wareCell", message: "{name}: {count}{pooled}{collecting}"
      }),
      sharedAria: msg({
        id: "settlement.details.storage.sharedAria",
        message: "Shared resources on this landmass"
      }),
      sharedCapacity: msg({
        id: "settlement.details.storage.sharedCapacity",
        message: "Shared stock on this landmass: available amounts shown. Capacity per ware: {capacity}. People and transport equipment remain local."
      }),
      sharedPooled: msg({
        id: "settlement.details.storage.sharedPooled",
        message: " · Available {available} · Held {held} (reserved for outgoing loads) · Incoming {incoming} (on the way) · Stored {stored} / {capacity}"
      }),
      sharedSummary: msg({
        id: "settlement.details.storage.sharedSummary",
        message: "Held {held} · Incoming {incoming}"
      }),
      sharedBadgeTitle: msg({
        id: "settlement.details.storage.sharedBadgeTitle",
        message: "Available {available} · Held {held} (reserved for outgoing loads) · Incoming {incoming} (on the way) · Stored {stored} / {capacity}"
      }),
      aria: msg({
        id: "settlement.details.storage.aria",
        message: "Resources stored in this building"
      }),
      capacityNote: msg({
        id: "settlement.details.storage.capacityNote",
        message: "pooled across completed friendly storage buildings. Committed arrivals may exceed capacity after a storage loss."
      }),
      capacity: msg({
        id: "settlement.details.storage.capacity",
        message: "Current island: {capacity} capacity for each ware, {note}"
      }),
      handcartNote: msg({
        id: "settlement.details.storage.handcartNote",
        message: "Automatically used on connected paved roads (stone or higher) for loads of at least 2 items"
      }),
      handcart: msg({
        id: "settlement.details.storage.handcart",
        message: "{name}: {count} stored · {active} in use · {note}"
      }),
      poolTitle: msg({
        id: "settlement.details.storage.poolTitle",
        message: "Current island: stored + reserved incoming / per-ware capacity"
      }),
      pooled: msg({
        id: "settlement.details.storage.pooled",
        message: " · Island stored {stored} + reserved {reserved} / {capacity} per ware"
      }),
      showSettlers: msg({
        id: "settlement.details.storage.showSettlers",
        message: "Show settlers"
      }),
      showHarbour: msg({
        id: "settlement.details.storage.showHarbour",
        message: "Show harbour"
      }),
      showSoldiers: msg({
        id: "settlement.details.storage.showSoldiers",
        message: "Show soldiers"
      }),
      showResources: msg({
        id: "settlement.details.storage.showResources",
        message: "Show resources"
      })
    },
    tavern: {
      aria: msg({ id: "domain.building.tavern", message: "Military Academy" }),
      ingredientsAria: msg({
        id: "settlement.details.tavern.ingredientsAria",
        message: "Ingredients for one recruit"
      }),
      recruit: msg({ id: "settlement.details.tavern.recruit", message: "Recruit {troop}" }),
      recruitCount: msg({ id: "settlement.details.tavern.recruitCount", message: "Recruit {count}" }),
      recruitCountLabel: msg({
        id: "settlement.details.tavern.recruitCountLabel",
        message: "Recruit {count} {troop}"
      }),
      recruitsToOrder: msg({
        id: "settlement.details.tavern.recruitsToOrder",
        message: "Recruits to order"
      }),
      oneFewer: msg({ id: "settlement.details.tavern.oneFewer", message: "One recruit fewer" }),
      oneMore: msg({ id: "settlement.details.tavern.oneMore", message: "One recruit more" }),
      hint: msg({
        id: "settlement.details.tavern.hint",
        message: "Accepted only when the road-connected storehouses hold every ingredient. Carriers bring them here; the settler arrives last and leaves as a soldier for the nearest storehouse."
      }),
      stageCollect: msg({
        id: "settlement.details.tavern.stageCollect",
        message: "carriers bring the equipment"
      }),
      stageSettler: msg({ id: "settlement.details.tavern.stageSettler", message: "a settler is on the way" }),
      stageTrain: msg({ id: "settlement.details.tavern.stageTrain", message: "being equipped inside" }),
      noneOrdered: msg({
        id: "settlement.details.tavern.noneOrdered",
        message: "No recruits ordered."
      }),
      current: msg({ id: "settlement.details.tavern.current", message: "{troop}: {stage}" }),
      waiting: msg({ id: "settlement.details.tavern.waiting", message: "{count} × {troop}" }),
      queue: msg({
        id: "settlement.details.tavern.queue",
        message: "Now: {current}. Ordered: {waiting}."
      }),
      scheduleTitle: msg({
        id: "settlement.details.tavern.scheduleTitle",
        message: "Scheduled recruits"
      }),
      scheduleEmpty: msg({
        id: "settlement.details.tavern.scheduleEmpty",
        message: "No recruits are scheduled."
      }),
      scheduleEntry: msg({
        id: "settlement.details.tavern.waiting",
        message: "{count} × {troop}"
      }),
      scheduleCurrent: msg({
        id: "settlement.details.tavern.scheduleCurrent",
        message: "{count} × {troop} · {stage}"
      }),
      stageWaiting: msg({
        id: "settlement.details.tavern.stageWaiting",
        message: "waiting for the innkeeper"
      }),
      scheduledTotal: msg({
        id: "settlement.details.tavern.scheduledTotal",
        message: "{count} scheduled"
      }),
      ingredient: msg({
        id: "settlement.details.tavern.ingredient",
        message: "{label}: {need} each, {have} stored"
      }),
      amount: msg({ id: "settlement.details.tavern.amount", message: "{need}× · {have}" })
    },
    upgrade: {
      benefitsTitle: msg({
        id: "settlement.details.upgrade.benefitsTitle",
        message: "Upgrading keeps the building working and makes it stronger:"
      }),
      level: msg({ id: "settlement.details.upgrade.level", message: "Level {level}: {benefits}" }),
      reached: msg({ id: "settlement.details.upgrade.reached", message: "{line} (reached)" }),
      next: msg({ id: "settlement.details.upgrade.next", message: "{line} (next)" }),
      noBonus: msg({
        id: "settlement.details.upgrade.noBonus",
        message: "base building, no upgrade bonus"
      }),
      current: msg({
        id: "settlement.details.upgrade.current",
        message: "Now (level {level}): {benefits}."
      }),
      currentBerth: msg({
        id: "settlement.details.upgrade.currentBerth",
        message: "Now (level {level}): {benefits}. {berths} berth."
      }),
      currentBerths: msg({
        id: "settlement.details.upgrade.currentBerths",
        message: "Now (level {level}): {benefits}. {berths} berths."
      }),
      nextLevel: msg({
        id: "settlement.details.upgrade.nextLevel",
        message: "Level {level}: {benefits}."
      }),
      cost: msg({ id: "settlement.details.upgrade.cost", message: "{name}: {required}" }),
      costTracking: msg({
        id: "settlement.details.upgrade.costTracking",
        message: "{name}: {delivered}/{required} delivered ({incoming} on the way)"
      }),
      missing: msg({
        id: "settlement.details.upgrade.missing",
        message: "Missing storage stock: {items}."
      }),
      roadBlocked: msg({
        id: "settlement.details.upgrade.roadBlocked",
        message: "Delivery blocked: connect this entrance to completed storage with a road."
      }),
      statusCancelling: msg({
        id: "settlement.details.upgrade.statusCancelling",
        message: "Cancelling: arriving materials return to storage unconsumed."
      }),
      statusIdle: msg({
        id: "settlement.details.upgrade.statusIdle",
        message: "Needs access to supplied storage; carriers deliver {cost}, then a builder performs the work."
      }),
      statusProgress: msg({
        id: "settlement.details.upgrade.statusProgress",
        message: "Builder upgrading: {percent}%."
      }),
      statusTravelling: msg({
        id: "settlement.details.upgrade.statusTravelling",
        message: "Builder travelling to the building."
      }),
      statusWaiting: msg({
        id: "settlement.details.upgrade.statusWaiting",
        message: "Waiting for material deliveries and an available builder with a hammer."
      }),
      statusIdleWithActivity: msg({
        id: "settlement.details.upgrade.statusIdleWithActivity",
        message: "{activity} Needs access to supplied storage; carriers deliver {cost}, then a builder performs the work."
      }),
      statusProgressWithActivity: msg({
        id: "settlement.details.upgrade.statusProgressWithActivity",
        message: "Builder upgrading: {percent}%. {activity}"
      }),
      statusTravellingWithActivity: msg({
        id: "settlement.details.upgrade.statusTravellingWithActivity",
        message: "Builder travelling to the building. {activity}"
      }),
      activityHarbour: msg({
        id: "settlement.details.upgrade.activityHarbour",
        message: "Storage remains available."
      }),
      activityProduction: msg({
        id: "settlement.details.upgrade.activityProduction",
        message: "Production continues."
      }),
      activityTower: msg({
        id: "settlement.details.upgrade.activityTower",
        message: "The tower stays in use."
      }),
      activityGarrison: msg({
        id: "settlement.details.upgrade.activityGarrison",
        message: "The garrison stays inside."
      }),
      activityResidence: msg({
        id: "settlement.details.upgrade.activityResidence",
        message: "Residents stay at home."
      }),
      activityTavern: msg({
        id: "settlement.details.upgrade.activityTavern",
        message: "Recruitment continues."
      }),
      upgrade: msg({ id: "settlement.popup.upgrade", message: "Upgrade" }),
      cancelUpgrade: msg({ id: "settlement.details.upgrade.cancelUpgrade", message: "Cancel upgrade" }),
      cancelTitle: msg({
        id: "settlement.details.upgrade.cancelTitle",
        message: "Cancel and return delivered materials"
      }),
      requires: msg({
        id: "settlement.details.upgrade.requires",
        message: "Requires {cost}; carriers deliver them and a builder performs the upgrade"
      }),
      available: msg({
        id: "settlement.details.upgrade.available",
        message: "Available connected storage: {supply}."
      }),
      headingMax: msg({
        id: "settlement.details.upgrade.headingMax",
        message: "Building level {level} (maximum)"
      }),
      headingNext: msg({
        id: "settlement.details.upgrade.headingNext",
        message: "Upgrade to level {level}"
      }),
      sawmillNote: msg({
        id: "settlement.details.upgrade.sawmillNote",
        message: "Cart capacity is unchanged. Changing the plank recipe keeps completed work committed and returns unused logs to storage."
      }),
      confirmTitle: msg({
        id: "settlement.details.upgrade.confirmTitle",
        message: "Confirm building upgrade"
      }),
      benefits: msg({
        id: "settlement.details.upgrade.benefits",
        message: "Upgrade benefits"
      }),
      close: msg({ id: "settlement.common.close", message: "Close" })
    },
    workArea: {
      farmAria: msg({ id: "settlement.details.workArea.farmAria", message: "Farm wheat area" }),
      farmHeading: msg({ id: "settlement.details.workArea.farmHeading", message: "Wheat fields" }),
      flaxAria: msg({ id: "settlement.details.workArea.flaxAria", message: "Flax field area" }),
      flaxHeading: msg({ id: "settlement.details.workArea.flaxHeading", message: "Flax fields" }),
      farmLocation: msg({
        id: "settlement.details.workArea.farmLocation",
        message: "Fields around the farmhouse"
      }),
      farmDescription: msg({
        id: "settlement.details.workArea.farmDescription",
        message: "Within {radius} tiles of the entrance. Farmers sow, let wheat grow, and bring harvested bundles home."
      }),
      flaxDescription: msg({
        id: "settlement.details.workArea.flaxDescription",
        message: "Within {radius} tiles of the entrance. The grower sows flax, hand-pulls the ripe stems, dries and bundles the fibre."
      }),
      growing: msg({ id: "settlement.details.workArea.growing", message: "Growing" }),
      ready: msg({ id: "settlement.details.workArea.ready", message: "Ready to harvest" }),
      storedWheat: msg({ id: "settlement.details.workArea.storedWheat", message: "Stored wheat" }),
      storedFlax: msg({ id: "settlement.details.workArea.storedFlax", message: "Stored flax" }),
      stoneAria: msg({
        id: "settlement.details.workArea.stoneAria",
        message: "Stonemason gathering area"
      }),
      stoneHeading: msg({ id: "settlement.details.workArea.stoneHeading", message: "Stone gathering" }),
      stoneLocation: msg({
        id: "settlement.details.workArea.stoneLocation",
        message: "Rocks around the stonemason house"
      }),
      stoneDescription: msg({
        id: "settlement.details.workArea.stoneDescription",
        message: "Within {radius} tiles of the entrance. The stonemason searches for rocks and brings cut stone home."
      }),
      storedStone: msg({ id: "settlement.details.workArea.storedStone", message: "Stored stone" })
    },
    workforce: {
      aria: msg({
        id: "settlement.details.workforce.heading",
        message: "Settlers recruited here"
      }),
      heading: msg({
        id: "settlement.details.workforce.heading",
        message: "Settlers recruited here"
      }),
      note: msg({
        id: "settlement.details.workforce.note",
        message: "Includes workers travelling to or working at other buildings."
      }),
      idle: msg({
        id: "settlement.details.workforce.idle",
        message: "Idle settlers stored here"
      }),
      carriers: msg({ id: "settlement.talents.groupCarriers", message: "Carriers" }),
      count: msg({ id: "settlement.summary.count", message: "{label}: {count}" })
    }
  },
  planner: {
    titleAdventure: msg({ id: "settlement.planner.titleAdventure", message: "Adventure expedition" }),
    titleColony: msg({ id: "settlement.planner.titleColony", message: "Colony expedition" }),
    islandAdventure: msg({ id: "settlement.planner.islandAdventure", message: "Adventure island" }),
    islandColony: msg({ id: "settlement.planner.islandColony", message: "Colony island" }),
    troopsAria: msg({ id: "settlement.planner.troopsAria", message: "Troops to send" }),
    start: msg({ id: "settlement.planner.start", message: "Start expedition" }),
    startTitle: msg({ id: "settlement.planner.start", message: "Start expedition" }),
    supplies: msg({ id: "settlement.planner.supplies", message: "Supplies from this harbour" }),
    rewardShip: msg({ id: "domain.ship.label.rewardShip", message: "Reward ship" }),
    ongoing: msg({
      id: "settlement.planner.ongoing",
      message: "Another expedition is under way; finish or cancel it first."
    }),
    adventureBusy: msg({
      id: "settlement.planner.adventureBusy",
      message: "Finish the current adventure first; new adventures are offered afterwards."
    }),
    startRefused: msg({ id: "settlement.planner.startRefused", message: "The expedition cannot start." }),
    crew: msg({
      id: "settlement.planner.crew",
      message: "Crew: 1 builder (shovel and hammer) and 1 carrier. Lost troops cannot be reinforced."
    }),
    claimed: msg({ id: "settlement.planner.claimed", message: "Already claimed" }),
    tier: msg({
      id: "settlement.planner.tier",
      message: "Tier {tier}: {wood} + {stone}"
    }),
    sail: msg({ id: "settlement.planner.sail", message: "{time} sail" }),
    sailTalent: msg({
      id: "settlement.planner.sailTalent",
      message: "{time} sail (−{percent}% talent)"
    }),
    islandTitle: msg({
      id: "settlement.planner.islandTitle",
      message: "{name} ({level}): {detail}"
    }),
    islandTitleTooltip: msg({
      id: "settlement.planner.islandTitleTooltip",
      message: "{name} ({level}): {detail} · {tooltip}"
    }),
    threatColony: msg({
      id: "settlement.planner.threatColony",
      message: "{difficulty}: {summary}"
    }),
    troopsTotal: msg({
      id: "settlement.planner.troopsTotal",
      message: "{count} / {cap} troops"
    }),
    stored: msg({ id: "settlement.planner.stored", message: "{count} stored" }),
    commanderAria: msg({ id: "settlement.planner.commanderAria", message: "Commander (optional)" }),
    commanderHeading: msg({
      id: "settlement.planner.commanderHeading",
      message: "Commander (optional) · one per expedition"
    }),
    noCommander: msg({ id: "settlement.planner.noCommander", message: "No commander" }),
    commanderHp: msg({ id: "settlement.planner.commanderHp", message: "HP {current} / {maximum}" }),
    commanderLevel: msg({ id: "settlement.planner.commanderLevel", message: "Level {level}" }),
    commanderDeck: msg({
      id: "settlement.planner.commanderDeck",
      message: "1 troop-cap unit · 2 deck slots · sails in the first combat load"
    }),
    commanderReady: msg({
      id: "settlement.planner.commanderReady",
      message: "Available for deployment. A valid ship and route are still required."
    }),
    commanderAssigned: msg({
      id: "settlement.planner.commanderAssigned",
      message: "Already assigned or mustering for an expedition."
    }),
    commanderAway: msg({
      id: "settlement.planner.commanderAway",
      message: "Away on an expedition. Return the commander before selecting another."
    }),
    commanderAwaitingEvacuation: msg({
      id: "settlement.planner.commanderAwaitingEvacuation",
      message: "Awaiting a return ship; recovery begins at the Commander's Lodge."
    }),
    commanderAwaitingHome: msg({
      id: "settlement.planner.commanderAwaitingHome",
      message: "No reachable friendly Commander's Lodge is available."
    }),
    commanderIncapacitated: msg({
      id: "settlement.planner.commanderIncapacitated",
      message: "Incapacitated; return to the Commander's Lodge to recover."
    }),
    commanderMissingHome: msg({
      id: "settlement.planner.commanderMissingHome",
      message: "Missing home: no completed Commander's Lodge is reachable."
    }),
    commanderRecovering: msg({
      id: "settlement.planner.commanderRecovering",
      message: "Recovering · {minutes} min remaining. Deployment also needs at least 50% HP."
    }),
    commanderTooInjured: msg({
      id: "settlement.planner.commanderTooInjured",
      message: "Too injured: {current} / {maximum} HP. At least {required} HP (50%) is required."
    }),
    commanderCardTitle: msg({
      id: "settlement.planner.commanderCardTitle",
      message: "{name} · {role} · {hp} · {status}"
    }),
    commanderNoneSelected: msg({
      id: "settlement.planner.commanderNoneSelected",
      message: "No commander selected: the expedition sails with ordinary troops only."
    }),
    commanderSelection: msg({
      id: "settlement.planner.commanderSelection",
      message: "Selected commander: {name}"
    }),
    fewer: msg({ id: "settlement.planner.fewer", message: "Fewer {troop}" }),
    more: msg({ id: "settlement.planner.more", message: "More {troop}" }),
    toSend: msg({ id: "settlement.planner.toSend", message: "{troop} to send" }),
    noShip: msg({
      id: "settlement.planner.noShip",
      message: "No ship available: build one at a shipyard first."
    }),
    estimate: msg({
      id: "settlement.planner.estimate",
      message: "{ships} ship(s) · {loads} load(s) · {trips} trip(s) · arrival ≈ {arrival}"
    }),
    reward: msg({
      id: "settlement.planner.reward",
      message: "Victory: +{experience} XP (about {count} such adventures fill your level) · troops only, survivors sail home with the reward"
    })
  },
  fleet: {
    description: msg({ id: "settlement.fleet.description", message: "Your fleet, voyages and cargo." }),
    empty: msg({
      id: "settlement.fleet.empty",
      message: "No ships on this island. Incoming ships appear when dispatched."
    }),
    cargoInvalid: msg({
      id: "settlement.fleet.cargoInvalid",
      message: "Choose different harbors and 1–40 wares."
    }),
    cargoQueued: msg({ id: "settlement.fleet.cargoQueued", message: "Cargo queued." }),
    cargoRefused: msg({
      id: "settlement.fleet.cargoRefused",
      message: "Cargo cannot be queued: check stock and a sea route."
    }),
    passengersQueued: msg({
      id: "settlement.fleet.passengersQueued",
      message: "Passenger voyage queued."
    }),
    passengersRefused: msg({
      id: "settlement.fleet.passengersRefused",
      message: "Check the sea route, free settlers and reserve soldiers."
    }),
    shoreCost: msg({
      id: "settlement.fleet.shoreCost",
      message: "Requires 3 settlers from a road-connected storage and 4 planks, 6 stone, 1 hammer and 1 shovel in the departure harbour."
    }),
    shoreMissing: msg({
      id: "settlement.fleet.shoreMissing",
      message: "Find and select a new shore first."
    }),
    expeditionQueued: msg({
      id: "settlement.fleet.expeditionQueued",
      message: "Settlement expedition queued."
    }),
    expeditionRefused: msg({
      id: "settlement.fleet.expeditionRefused",
      message: "Check supplies, settlers and shore access."
    }),
    voyageCancelled: msg({
      id: "settlement.fleet.voyageCancelled",
      message: "Voyage cancelled; reserved supplies and passengers return safely."
    }),
    voyageDone: msg({
      id: "settlement.fleet.voyageDone",
      message: "Voyage already completed."
    }),
    harbour: msg({ id: "settlement.fleet.harbour", message: "Harbour {id}" }),
    harbor: msg({ id: "settlement.fleet.harbor", message: "Harbor {id}" }),
    source: msg({ id: "settlement.fleet.source", message: "Cargo source harbor" }),
    destination: msg({ id: "settlement.fleet.destination", message: "Cargo destination harbor" }),
    ware: msg({ id: "settlement.fleet.ware", message: "Cargo ware" }),
    quantity: msg({ id: "settlement.fleet.quantity", message: "Cargo quantity" }),
    queueCargo: msg({ id: "settlement.fleet.queueCargo", message: "Queue cargo" }),
    findShore: msg({ id: "settlement.fleet.findShore", message: "Find new harbour shore" }),
    expeditionShore: msg({ id: "settlement.fleet.expeditionShore", message: "Expedition shore" }),
    foundHarbour: msg({ id: "settlement.fleet.foundHarbour", message: "Found new harbour" }),
    passengerSource: msg({
      id: "settlement.fleet.passengerSource",
      message: "Passenger departure harbour"
    }),
    passengerDestination: msg({
      id: "settlement.fleet.passengerDestination",
      message: "Passenger destination harbour"
    }),
    settlers: msg({ id: "settlement.fleet.settlers", message: "Settlers" }),
    reserveSoldiers: msg({ id: "settlement.fleet.reserveSoldiers", message: "Reserve soldiers" }),
    settlerPassengers: msg({
      id: "settlement.fleet.settlerPassengers",
      message: "Settler passengers"
    }),
    reserveSoldierPassengers: msg({
      id: "settlement.fleet.reserveSoldierPassengers",
      message: "Reserve soldier passengers"
    }),
    sendPassengers: msg({ id: "settlement.fleet.sendPassengers", message: "Send passengers" }),
    cancelExpedition: msg({ id: "settlement.fleet.cancelExpedition", message: "Cancel expedition {id}" }),
    cancelVoyage: msg({ id: "settlement.fleet.cancelVoyage", message: "Cancel voyage {id}" }),
    shore: msg({ id: "settlement.fleet.shore", message: "Shore {x}, {z}" }),
    currentLeg: msg({ id: "settlement.fleet.currentLeg", message: "Current leg ≈ {time}" })
  },
  shipRegister: {
    sink: msg({ id: "settlement.shipRegister.sink", message: "Sink ship" }),
    sinkCaption: msg({ id: "settlement.shipRegister.sinkCaption", message: "Sink" }),
    sinkHint: msg({ id: "settlement.shipRegister.sinkHint",
      message: "Sink an idle, empty owned ship. No materials are returned." }),
    title: msg({ id: "settlement.shipRegister.title", message: "Ship register" }),
    passengers: msg({ id: "settlement.shipRegister.passengers", message: "Passengers" }),
    noPassengers: msg({
      id: "settlement.shipRegister.noPassengers",
      message: "No passengers aboard."
    }),
    cargo: msg({ id: "settlement.shipRegister.cargo", message: "Cargo" }),
    previous: msg({ id: "settlement.shipRegister.previous", message: "Previous" }),
    next: msg({ id: "settlement.shipRegister.next", message: "Next" }),
    goToPlace: msg({ id: "settlement.shipRegister.goToPlace", message: "Go to place" }),
    follow: msg({ id: "settlement.shipRegister.follow", message: "Follow this ship" }),
    stopFollowing: msg({
      id: "settlement.shipRegister.stopFollowing",
      message: "Stop following this ship"
    }),
    followCaption: msg({ id: "settlement.shipRegister.followCaption", message: "Follow" }),
    noShips: msg({ id: "settlement.shipRegister.noShips", message: "No ships available" }),
    status: msg({ id: "settlement.shipRegister.status", message: "{position}/{count} · {status}" }),
    demoWares: msg({ id: "settlement.shipRegister.demoWares", message: "Demo wares" }),
    demoSettlers: msg({ id: "settlement.shipRegister.demoSettlers", message: "Demo settlers" }),
    previewTitle: msg({
      id: "settlement.shipRegister.previewTitle",
      message: "{label}: render-only deck preview; never cargo or saved passengers"
    }),
    debugPreview: msg({
      id: "settlement.shipRegister.debugPreview",
      message: "Debug deck preview"
    }),
    debugNote: msg({
      id: "settlement.shipRegister.debugNote",
      message: "Synthetic deck visuals only. Cargo and passenger counts above remain actual. Use an idle empty ship; click the active preview again to clear. Closing or changing ships clears it."
    })
  },
  gemShop: {
    title: msg({ id: "settlement.gemShop.title", message: "Gem shop" }),
    success: msg({ id: "settlement.gemShop.success", message: "Delivered to your home storage." }),
    purchase: msg({
      id: "settlement.gemShop.purchase",
      message: "Buy {wares} for {price} gems"
    }),
    tier: msg({
      id: "settlement.gemShop.tier",
      message: "Tier {tier} building material"
    }),
    categories: msg({ id: "settlement.gemShop.categories", message: "Shop categories" }),
    yourGems: msg({ id: "settlement.gemShop.yourGems", message: "Your gems: " }),
    categoryResources: msg({ id: "settlement.gemShop.categoryResources", message: "Resources" }),
    categoryMilitary: msg({ id: "settlement.gemShop.categoryMilitary", message: "Military" }),
    categoryTools: msg({ id: "settlement.gemShop.categoryTools", message: "Tools" }),
    unavailable: msg({ id: "settlement.gemShop.unavailable", message: "The gem shop is unavailable" })
  },
  messages: {
    title: msg({ id: "hud.player.inbox", message: "Messages" }),
    battleReports: msg({ id: "settlement.messages.battleReports", message: "Battle reports" }),
    colonyConquered: msg({
      id: "settlement.messages.colonyConquered",
      message: "Colony conquered: {island}"
    }),
    adventureCompleted: msg({
      id: "settlement.messages.adventureCompleted",
      message: "Adventure completed: {island}"
    }),
    none: msg({ id: "settlement.messages.none", message: "None" }),
    troopSent: msg({ id: "settlement.messages.troopSent", message: "Troops sent" }),
    losses: msg({ id: "settlement.messages.losses", message: "Your losses" }),
    defeated: msg({ id: "settlement.messages.defeated", message: "Enemies defeated" }),
    buildings: msg({
      id: "settlement.messages.buildings",
      message: "Buildings defeated or captured"
    }),
    rewards: msg({ id: "settlement.messages.rewards", message: "Rewards earned" }),
    attachments: msg({ id: "settlement.messages.attachments", message: "Goods mentioned" }),
    incomplete: msg({
      id: "settlement.messages.incomplete",
      message: "This expedition began before battle reports were recorded. Earlier troop statistics are unavailable."
    }),
    rewardTravel: msg({
      id: "settlement.messages.rewardTravel",
      message: "Reward wares travel home aboard the returning ship."
    }),
    empty: msg({
      id: "settlement.messages.empty",
      message: "No messages yet. Completed adventures and colony conquests appear here."
    })
  },
  quests: {
    title: msg({ id: "settlement.hud.player.quests", message: "Quests" }),
    tutorial: msg({ id: "settlement.quests.tutorial", message: "Tutorial" }),
    daily: msg({ id: "settlement.quests.daily", message: "Daily quest" }),
    open: msg({ id: "settlement.quests.open", message: "Open quests" }),
    showMe: msg({ id: "settlement.quests.showMe", message: "Show me" }),
    deliver: msg({ id: "settlement.quests.deliver", message: "Deliver {wares}" }),
    produce: msg({ id: "settlement.quests.produce", message: "Produce {wares}" }),
    completed: msg({ id: "settlement.quests.completed", message: "Completed" }),
    produced: msg({
      id: "settlement.quests.produced",
      message: "{progress} / {amount} produced"
    }),
    inStorage: msg({
      id: "settlement.quests.inStorage",
      message: "{stored} / {amount} in storage"
    }),
    renewOpen: msg({
      id: "settlement.quests.renewOpen",
      message: "A new daily quest arrives in {time}."
    }),
    renewClosed: msg({
      id: "settlement.quests.renewClosed",
      message: "Next daily quest in {time}."
    }),
    time: msg({ id: "settlement.quests.time", message: "{hours}h {minutes}m" }),
    goalDeliver: msg({
      id: "settlement.quests.goalDeliver",
      message: "Bring the wares to your storage, then deliver them from here. They are taken from storage."
    }),
    goalProduce: msg({
      id: "settlement.quests.goalProduce",
      message: "Produce the wares in your own buildings today, then claim the reward."
    }),
    progress: msg({
      id: "settlement.quests.progress",
      message: "{progress} / {amount}"
    }),
    progressClaim: msg({
      id: "settlement.quests.progressClaim",
      message: "{progress} / {amount} · Claim reward"
    }),
    progressReady: msg({
      id: "settlement.quests.progressReady",
      message: "{progress} / {amount} · Ready to claim"
    }),
    claim: msg({ id: "settlement.common.claim", message: "Claim" }),
    deliverAction: msg({ id: "settlement.quests.deliverAction", message: "Deliver" }),
    chapter: msg({
      id: "settlement.quests.chapter",
      message: "Chapter {chapter} of {total} · {title}"
    }),
    step: msg({ id: "settlement.quests.step", message: "Step {step} of {total}" }),
    chapterReward: msg({
      id: "settlement.quests.chapterReward",
      message: "Completing this chapter reaches level {level}."
    }),
    chapterRewardUnlocks: msg({
      id: "settlement.quests.chapterRewardUnlocks",
      message: "Completing this chapter reaches level {level} and unlocks {buildings}."
    }),
    why: msg({ id: "settlement.quests.why", message: "Why" }),
    benefit: msg({ id: "settlement.quests.benefit", message: "Benefit" }),
    goodToKnow: msg({ id: "settlement.quests.goodToKnow", message: "Good to know" }),
    skipOptional: msg({
      id: "settlement.quests.skipOptional",
      message: "Skip optional quest"
    }),
    skipMissing: msg({
      id: "settlement.quests.skipMissing",
      message: "Skip: not on this island"
    }),
    homeNote: msg({
      id: "settlement.quests.homeNote",
      message: "Continue this tutorial on your home island."
    }),
    missingNote: msg({
      id: "settlement.quests.missingNote",
      message: "Your island has none of the natural resource this step needs."
    }),
    completedStatus: msg({
      id: "settlement.quests.completedStatus",
      message: "Quest completed!"
    }),
    skippedStatus: msg({ id: "settlement.quests.skippedStatus", message: "Quest skipped." }),
    confirming: msg({
      id: "settlement.quests.confirming",
      message: "Confirming with the server…"
    }),
    done: msg({
      id: "settlement.quests.done",
      message: "Today's daily quest is complete. Well done! A new one arrives at midnight."
    })
  },
  market: {
    title: msg({ id: "settlement.market.title", message: "Player Market" }),
    success: msg({ id: "settlement.market.success", message: "Market refreshed." }),
    unavailable: msg({
      id: "settlement.market.unavailable",
      message: "The Player Market needs a cloud save"
    }),
    unavailableNote: msg({
      id: "settlement.market.unavailableNote",
      message: "Sign in with a cloud save to offer goods to other players or claim Market goods to your home island. Offline and guest play continue normally, and no island goods are moved."
    }),
    unavailableExtra: msg({
      id: "settlement.market.unavailableExtra",
      message: "The harbour trade office and its local NPC offers are separate and unchanged."
    }),
    homeOnly: msg({
      id: "settlement.market.homeOnly",
      message: "The Player Market is available at home"
    }),
    homeOnlyNote: msg({
      id: "settlement.market.homeOnlyNote",
      message: "It moves goods in your saved home island only. Return to your home island to offer goods or claim Market goods; colony and adventure islands are untouched."
    }),
    wallet: msg({ id: "settlement.market.wallet", message: "Market wallet — awaiting claim" }),
    walletAria: msg({ id: "settlement.market.walletAria", message: "Market wallet" }),
    walletNote: msg({
      id: "settlement.market.walletNote",
      message: "Goods from settled offers wait here until you claim them. They stay safe while you are offline."
    }),
    receivedGoods: msg({ id: "settlement.market.receivedGoods", message: "Received: {count}" }),
    depositedGoods: msg({ id: "settlement.market.depositedGoods", message: "Deposited: {count}" }),
    homeStorage: msg({ id: "settlement.market.homeStorage", message: "Home storage" }),
    homeStorageNote: msg({
      id: "settlement.market.homeStorageNote",
      message: "Free wares in your saved home island's storages. Other stored wares are not Market goods."
    }),
    walletEmpty: msg({
      id: "settlement.market.walletEmpty",
      message: "No goods are waiting in your Market wallet."
    }),
    claimAll: msg({ id: "settlement.market.claimAll", message: "Claim all" }),
    claimAllLabel: msg({
      id: "settlement.market.claimAllLabel",
      message: "Claim all Market goods to home"
    }),
    claimToHome: msg({ id: "settlement.market.claimToHome", message: "Claim {wares} to home" }),
    noWares: msg({ id: "settlement.market.noWares", message: "No Market wares" }),
    expiry: msg({ id: "settlement.market.expiry", message: "Expires {time} UTC" }),
    expiryUnknown: msg({ id: "settlement.market.expiryUnknown", message: "Expiry unknown" }),
    lots: msg({ id: "settlement.market.lots", message: "{lots}" }),
    offerGoods: msg({ id: "settlement.market.offerGoods", message: "Offer goods" }),
    offerNote: msg({
      id: "settlement.market.offerNote",
      message: "The offered goods leave home storage for the Market wallet before the offer is created."
    }),
    youOffer: msg({ id: "settlement.market.youOffer", message: "You offer" }),
    youRequest: msg({ id: "settlement.market.youRequest", message: "You request" }),
    offerLifetime: msg({ id: "settlement.market.offerLifetime", message: "Offer lifetime" }),
    amount: msg({ id: "settlement.market.amount", message: "Amount" }),
    amountOffer: msg({
      id: "settlement.market.amountOffer",
      message: "Amount of {ware} to offer"
    }),
    amountRequest: msg({
      id: "settlement.market.amountRequest",
      message: "Amount of {ware} to request"
    }),
    freeAtHome: msg({ id: "settlement.market.freeAtHome", message: "Free at home: {wares}" }),
    offer: msg({ id: "settlement.market.offer", message: "Offer" }),
    offerLabel: msg({
      id: "settlement.market.offerLabel",
      message: "Offer these goods on the Player Market"
    }),
    chooseWares: msg({
      id: "settlement.market.chooseWares",
      message: "Choose one of the 12 Market wares."
    }),
    positiveOffer: msg({
      id: "settlement.market.positiveOffer",
      message: "Enter a whole positive amount to offer."
    }),
    positiveRequest: msg({
      id: "settlement.market.positiveRequest",
      message: "Enter a whole positive amount to request."
    }),
    lifetimeRequired: msg({
      id: "settlement.market.lifetimeRequired",
      message: "Choose how long the offer should stay open."
    }),
    onlyFree: msg({
      id: "settlement.market.onlyFree",
      message: "Only {wares} are free in home storage."
    }),
    tooManyOffers: msg({
      id: "settlement.market.tooManyOffers",
      message: "You already have {count} open offers. Cancel one to offer more."
    }),
    pendingDeposit: msg({
      id: "settlement.market.pendingDeposit",
      message: "Offer deposit not confirmed"
    }),
    pendingOffer: msg({
      id: "settlement.market.pendingOffer",
      message: "Offer creation not confirmed"
    }),
    pendingClaim: msg({
      id: "settlement.market.pendingClaim",
      message: "Claim not confirmed"
    }),
    pendingBuyDeposit: msg({
      id: "settlement.market.pendingBuyDeposit",
      message: "Purchase deposit not confirmed"
    }),
    pendingBuyAccept: msg({
      id: "settlement.market.pendingBuyAccept",
      message: "Offer acceptance not confirmed"
    }),
    pendingOfferText: msg({
      id: "settlement.market.pendingOfferText",
      message: "{message} Retrying uses the same request, so the goods cannot be deposited twice."
    }),
    pendingClaimText: msg({
      id: "settlement.market.pendingClaimText",
      message: "{message} Retrying uses the same request, so the goods cannot be withdrawn twice."
    }),
    pendingBuyDepositText: msg({
      id: "settlement.market.pendingBuyDepositText",
      message: "{message} Retrying uses the same deposit request, so the goods cannot be deposited twice."
    }),
    pendingBuyAcceptText: msg({
      id: "settlement.market.pendingBuyAcceptText",
      message: "{message} Retrying only accepts this offer; the same offer cannot be exchanged twice."
    }),
    retryOffer: msg({ id: "settlement.market.retryOffer", message: "Retry offer" }),
    retryOfferLabel: msg({
      id: "settlement.market.retryOfferLabel",
      message: "Retry the unfinished offer"
    }),
    retryClaim: msg({ id: "settlement.market.retryClaim", message: "Retry claim" }),
    retryClaimLabel: msg({
      id: "settlement.market.retryClaimLabel",
      message: "Retry the unfinished claim"
    }),
    retryBuy: msg({ id: "settlement.market.retryBuy", message: "Retry purchase" }),
    retryBuyLabel: msg({
      id: "settlement.market.retryBuyLabel",
      message: "Retry the unfinished purchase"
    }),
    discardOffer: msg({
      id: "settlement.market.discardOffer",
      message: "Discard the unfinished offer"
    }),
    discardClaim: msg({
      id: "settlement.market.discardClaim",
      message: "Discard the unfinished claim"
    }),
    discardBuy: msg({
      id: "settlement.market.discardBuy",
      message: "Discard the unfinished purchase"
    }),
    discardSafe: msg({
      id: "settlement.market.discardSafe",
      message: "Retry once before discarding: an unconfirmed deposit may have reached the server."
    }),
    unfinishedOffer: msg({
      id: "settlement.market.unfinishedOffer",
      message: "Unfinished offer"
    }),
    unfinishedClaim: msg({
      id: "settlement.market.unfinishedClaim",
      message: "Unfinished claim"
    }),
    unfinishedBuy: msg({
      id: "settlement.market.unfinishedBuy",
      message: "Unfinished purchase"
    }),
    goods: msg({ id: "settlement.market.goods", message: "Goods" }),
    openOffers: msg({ id: "settlement.market.openOffers", message: "Your open offers" }),
    openOffersNote: msg({
      id: "settlement.market.openOffersNote",
      message: "Offered goods are in escrow. Cancel an offer to return them to your Market wallet."
    }),
    escrow: msg({ id: "settlement.market.escrow", message: "You offer (escrow)" }),
    openOffersAria: msg({
      id: "settlement.market.openOffersAria",
      message: "Open Market offers"
    }),
    noOffers: msg({
      id: "settlement.market.noOffers",
      message: "You have no open offers."
    }),
    cancelOffer: msg({
      id: "settlement.market.cancelOffer",
      message: "Cancel offer: {give} for {need}"
    }),
    cancel: msg({ id: "settlement.market.cancel", message: "Cancel" }),
    playerOffers: msg({ id: "settlement.market.playerOffers", message: "Player offers" }),
    playerOffersAria: msg({
      id: "settlement.market.playerOffersAria",
      message: "Player offers from other players"
    }),
    playerOffersNote: msg({
      id: "settlement.market.playerOffersNote",
      message: "Open offers from other players. You give the requested goods from your Market wallet or home storage; their goods arrive in your Market wallet."
    }),
    noPlayerOffers: msg({
      id: "settlement.market.noPlayerOffers",
      message: "No other players' offers are open right now."
    }),
    youGet: msg({ id: "settlement.market.youGet", message: "You get" }),
    youGive: msg({ id: "settlement.market.youGive", message: "You give" }),
    acceptOffer: msg({ id: "settlement.market.acceptOffer", message: "Accept offer" }),
    depositAndAccept: msg({
      id: "settlement.market.depositAndAccept",
      message: "Deposit and accept"
    }),
    acceptOfferLabel: msg({
      id: "settlement.market.acceptOfferLabel",
      message: "Accept offer: you get {get}, you give {give}"
    }),
    depositAndAcceptLabel: msg({
      id: "settlement.market.depositAndAcceptLabel",
      message: "Deposit and accept offer: you get {get}, you give {give}"
    }),
    buyMissing: msg({
      id: "settlement.market.buyMissing",
      message: "Not enough {wares} in your Market wallet or home storage."
    }),
    refresh: msg({ id: "settlement.market.refresh", message: "Refresh" }),
    refreshLabel: msg({
      id: "settlement.market.refreshLabel",
      message: "Refresh the Player Market"
    }),
    walletCount: msg({
      id: "settlement.market.walletCount",
      message: "{count} goods in your Market wallet"
    }),
    reading: msg({ id: "settlement.market.reading", message: "Reading the server Market…" }),
    refreshing: msg({ id: "settlement.market.refreshing", message: "Refreshing…" }),
    loading: msg({ id: "settlement.market.loading", message: "Loading the Player Market…" }),
    footnote: msg({
      id: "settlement.market.footnote",
      message: "Only the 12 Market wares are tradable. Accepted goods stay in your Market wallet until you claim them; nothing is pushed into an offline island automatically."
    }),
    unavailableAria: msg({
      id: "settlement.market.unavailableAria",
      message: "Player Market unavailable"
    }),
    homeOnlyAria: msg({
      id: "settlement.market.homeOnlyAria",
      message: "Player Market at home"
    }),
    offerAria: msg({ id: "settlement.market.offerGoods", message: "Offer goods" }),
    offerSectionAria: msg({
      id: "settlement.trade.myOffers",
      message: "My offers"
    }),
    ttlHour: msg({ id: "settlement.market.ttlHour", message: "1 hour" }),
    ttlSixHours: msg({ id: "settlement.market.ttlSixHours", message: "6 hours" }),
    ttlTwelveHours: msg({ id: "settlement.market.ttlTwelveHours", message: "12 hours" }),
    ttlSeconds: msg({ id: "settlement.hud.player.growth", message: "{seconds} seconds" }),
    errorConnection: msg({
      id: "settlement.market.errorConnection",
      message: "The Market server did not answer. Check your connection and retry."
    }),
    errorOffer: msg({
      id: "settlement.market.errorOffer",
      message: "The Market did not answer. Retry the offer safely."
    }),
    errorRetryOffer: msg({
      id: "settlement.market.errorRetryOffer",
      message: "The Market did not answer. Retry the same offer safely."
    }),
    dismissedOffer: msg({
      id: "settlement.market.dismissedOffer",
      message: "Unfinished offer dismissed. Refresh My offers and your Market wallet to see where its goods settled."
    }),
    errorClaim: msg({
      id: "settlement.market.errorClaim",
      message: "The claim did not reach the server. Retry it safely."
    }),
    noClaimable: msg({
      id: "settlement.market.noClaimable",
      message: "There are no Market goods to claim."
    }),
    dismissedClaim: msg({
      id: "settlement.market.dismissedClaim",
      message: "Unfinished claim dismissed. Refresh the Market to see the server's current state."
    }),
    errorCancel: msg({
      id: "settlement.market.errorCancel",
      message: "The cancellation did not reach the server. Retry it safely."
    }),
    errorBuy: msg({
      id: "settlement.market.errorBuy",
      message: "The purchase did not reach the server. Retry it safely."
    }),
    errorRetryBuy: msg({
      id: "settlement.market.errorRetryBuy",
      message: "The Market did not answer. Retry the same purchase safely."
    }),
    dismissedBuy: msg({
      id: "settlement.market.dismissedBuy",
      message: "Unfinished purchase dismissed. Refresh the Market to see where its goods settled."
    })
  },
  trade: {
    title: msg({ id: "settlement.menu.market", message: "Market" }),
    sections: msg({ id: "settlement.trade.sections", message: "Market sections" }),
    offers: msg({ id: "settlement.trade.offers", message: "Market offers" }),
    placeOffer: msg({ id: "settlement.trade.placeOffer", message: "Place offer" }),
    place: msg({ id: "settlement.trade.place", message: "Place" }),
    myOffers: msg({ id: "settlement.trade.myOffers", message: "My offers" }),
    history: msg({ id: "settlement.trade.history", message: "History" }),
    tradeHistory: msg({ id: "settlement.trade.tradeHistory", message: "Trade history" }),
    category: msg({ id: "settlement.trade.category", message: "Category" }),
    search: msg({ id: "settlement.trade.search", message: "Search" }),
    searchWares: msg({ id: "settlement.trade.searchWares", message: "Search wares" }),
    wareName: msg({ id: "settlement.trade.wareName", message: "Ware name" }),
    all: msg({ id: "settlement.trade.all", message: "All" }),
    categoryBuilding: msg({
      id: "settlement.trade.categoryBuilding",
      message: "Building materials"
    }),
    categoryFoodAndDrinks: msg({ id: "settlement.trade.categoryFoodAndDrinks", message: "Food and drinks" }),
    categoryFoodChain: msg({ id: "settlement.trade.categoryFoodChain", message: "Food-chain ingredients" }),
    categoryRaw: msg({ id: "settlement.trade.categoryRaw", message: "Raw materials" }),
    categoryTools: msg({ id: "settlement.trade.categoryTools", message: "Tools" }),
    categoryWeapons: msg({ id: "settlement.trade.categoryWeapons", message: "Weapons" }),
    taken: msg({ id: "settlement.trade.taken", message: "Already taken" }),
    takenProgress: msg({
      id: "settlement.trade.takenProgress",
      message: "Already taken · {progress}"
    }),
    storageFull: msg({
      id: "settlement.trade.storageFull",
      message: "Storage for {ware} is full"
    }),
    escrowProgress: msg({
      id: "settlement.trade.escrowProgress",
      message: "{staged}/{total} wares at the harbour"
    }),
    buy: msg({ id: "settlement.trade.buy", message: "Buy {give} for {want}" }),
    buyAction: msg({ id: "settlement.trade.buyAction", message: "Buy" }),
    noMatch: msg({
      id: "settlement.trade.noMatch",
      message: "No offer matches the filters."
    }),
    noneToday: msg({
      id: "settlement.trade.noneToday",
      message: "No merchant offers today."
    }),
    npcOff: msg({
      id: "settlement.trade.npcOff",
      message: "NPC traders are off: your offers wait for buyers."
    }),
    noActiveOffers: msg({
      id: "settlement.trade.noActiveOffers",
      message: "You have no active offers."
    }),
    noTrades: msg({ id: "settlement.trade.noTrades", message: "No trades yet." }),
    activeOffers: msg({
      id: "settlement.trade.activeOffers",
      message: "Active offers: {active}/{limit}"
    }),
    waitingForCarriers: msg({
      id: "settlement.trade.waitingForCarriers",
      message: "Waiting for carriers"
    }),
    listed: msg({ id: "settlement.trade.listed", message: "Listed" }),
    boughtDelivering: msg({
      id: "settlement.trade.boughtDelivering",
      message: "Bought · delivering"
    }),
    cancelledReturning: msg({
      id: "settlement.trade.cancelledReturning",
      message: "Cancelled · returning"
    }),
    filledDelivering: msg({
      id: "settlement.trade.filledDelivering",
      message: "Filled · delivering"
    }),
    stageWaiting: msg({ id: "settlement.trade.stageWaiting", message: "waiting" }),
    stageCollecting: msg({
      id: "settlement.trade.stageCollecting",
      message: "carriers collecting"
    }),
    stageQueued: msg({
      id: "settlement.trade.stageQueued",
      message: "ship queued for the pier"
    }),
    stageShipping: msg({
      id: "settlement.trade.stageShipping",
      message: "trade ship on its way"
    }),
    deliveryStatus: msg({
      id: "settlement.trade.deliveryStatus",
      message: "{base} ({detail})"
    }),
    deliveryStatusProgress: msg({
      id: "settlement.trade.deliveryStatusProgress",
      message: "{base} ({progress})"
    }),
    cancelOffer: msg({
      id: "settlement.trade.cancelOffer",
      message: "Cancel offer {give} for {want}"
    }),
    cancelTitle: msg({
      id: "settlement.trade.cancelTitle",
      message: "Cancel: the wares return to your storage at once"
    }),
    cancelQuestion: msg({
      id: "settlement.trade.cancelQuestion",
      message: "Cancel this offer?"
    }),
    returnText: msg({
      id: "settlement.trade.returnText",
      message: "{wares} return to your storage at once (wares already at or on their way to the harbour stay there)."
    }),
    keepOffer: msg({ id: "settlement.trade.keepOffer", message: "Keep offer" }),
    cancelOfferAction: msg({
      id: "settlement.trade.cancelOfferAction",
      message: "Cancel offer"
    }),
    tradeErrorTitle: msg({
      id: "settlement.trade.tradeErrorTitle",
      message: "Trade failed"
    }),
    historyBought: msg({ id: "settlement.trade.historyBought", message: "Bought" }),
    historyCancelled: msg({ id: "settlement.trade.historyCancelled", message: "Cancelled" }),
    historyExpired: msg({ id: "settlement.trade.historyExpired", message: "Expired" }),
    historySold: msg({ id: "settlement.trade.historySold", message: "Sold" }),
    historyFrom: msg({
      id: "settlement.trade.historyFrom",
      message: "{action} from {merchant}"
    }),
    give: msg({ id: "settlement.trade.give", message: "I give" }),
    want: msg({ id: "settlement.trade.want", message: "I want" }),
    chooseGive: msg({
      id: "settlement.trade.chooseGive",
      message: "Choose what you give"
    }),
    chooseWant: msg({
      id: "settlement.trade.chooseWant",
      message: "Choose what you want"
    }),
    freeStock: msg({
      id: "settlement.trade.freeStock",
      message: "{name}: {available} free"
    }),
    freeRoom: msg({
      id: "settlement.trade.freeRoom",
      message: "{name}: {available} room"
    }),
    noFreeStock: msg({
      id: "settlement.trade.noFreeStock",
      message: "No ware with free stock on this island."
    }),
    storageFullWant: msg({
      id: "settlement.trade.storageFullWant",
      message: "Every storage is full."
    }),
    amountToGive: msg({
      id: "settlement.trade.amountToGive",
      message: "Amount to give"
    }),
    amountWanted: msg({
      id: "settlement.trade.amountWanted",
      message: "Amount wanted"
    }),
    estimateChoose: msg({
      id: "settlement.trade.estimateChoose",
      message: "Choose both sides to see the estimate"
    }),
    estimateLikely: msg({
      id: "settlement.trade.estimateLikely",
      message: "Merchants will likely accept"
    }),
    estimateSlowly: msg({
      id: "settlement.trade.estimateSlowly",
      message: "Merchants may accept slowly"
    }),
    estimateUnlikely: msg({
      id: "settlement.trade.estimateUnlikely",
      message: "Merchants are unlikely to accept"
    }),
    sideLabel: msg({
      id: "settlement.trade.sideLabel",
      message: "{heading}: {lot}"
    }),
    less: msg({ id: "settlement.trade.less", message: "Less" }),
    more: msg({ id: "settlement.trade.more", message: "More" }),
    slider: msg({ id: "settlement.trade.slider", message: "{label} slider" }),
    placeNow: msg({ id: "settlement.trade.placeNow", message: "Place offer now" }),
    discardOffer: msg({
      id: "settlement.trade.discardOffer",
      message: "Discard offer"
    }),
    purchaseFailed: msg({
      id: "settlement.trade.purchaseFailed",
      message: "Purchase failed"
    }),
    offerNotCancelled: msg({
      id: "settlement.trade.offerNotCancelled",
      message: "Offer not cancelled"
    }),
    offerNotPlaced: msg({
      id: "settlement.trade.offerNotPlaced",
      message: "Offer not placed"
    }),
    boughtSuccess: msg({
      id: "settlement.trade.boughtSuccess",
      message: "Bought {wares}: a trade ship brings them."
    }),
    cancelledSuccess: msg({
      id: "settlement.trade.cancelledSuccess",
      message: "Offer cancelled: {returnText}"
    }),
    placedSuccess: msg({
      id: "settlement.trade.placedSuccess",
      message: "Offer placed."
    }),
    purchasePaid: msg({
      id: "domain.app.purchasePaid",
      message: "Purchase paid: a trade ship brings the wares."
    }),
    offerReturned: msg({
      id: "settlement.trade.offerReturned",
      message: "Offer cancelled: the wares return."
    }),
    placedAtMarket: msg({
      id: "settlement.trade.placedAtMarket",
      message: "Offer placed at the Market."
    })
  },
  colony: {
    difficultyEasy: msg({ id: "settlement.colony.difficultyEasy", message: "Easy" }),
    difficultyMedium: msg({ id: "domain.bandit.medium", message: "Medium" }),
    difficultyHard: msg({ id: "settlement.colony.difficultyHard", message: "Hard" }),
    oreCoal: msg({ id: "domain.ware.coal", message: "Coal" }),
    oreGold: msg({ id: "domain.ware.goldOre", message: "Gold ore" }),
    oreIron: msg({ id: "domain.ware.ironOre", message: "Iron ore" }),
    oreGranite: msg({ id: "settlement.colony.oreGranite", message: "Granite" }),
    durationDays: msg({
      id: "settlement.colony.durationDays",
      message: "{days} d {hours} h"
    }),
    durationHours: msg({
      id: "settlement.colony.durationHours",
      message: "{hours} h {minutes} min"
    }),
    durationMinutes: msg({
      id: "settlement.colony.durationMinutes",
      message: "{minutes}:{seconds}"
    }),
    difficultySummary: msg({
      id: "settlement.colony.difficultySummary",
      message: "{forts} enemy forts · ~{troops} defenders · max {cap} troops"
    }),
    statusCollecting: msg({
      id: "settlement.colony.statusCollecting",
      message: "Collecting supplies"
    }),
    statusTroopsWalking: msg({
      id: "settlement.colony.statusTroopsWalking",
      message: "Troops walking to the harbour"
    }),
    statusCrewWalking: msg({
      id: "settlement.colony.statusCrewWalking",
      message: "Troops and crew walking to the harbour"
    }),
    statusWaitingShips: msg({
      id: "settlement.colony.statusWaitingShips",
      message: "Waiting for ships"
    }),
    statusReadyAdventure: msg({
      id: "settlement.colony.statusReadyAdventure",
      message: "Adventure is ready to visit"
    }),
    statusReadyColony: msg({
      id: "settlement.colony.statusReadyColony",
      message: "Colony is ready to visit"
    }),
    statusReadyReturning: msg({
      id: "settlement.colony.statusReadyReturning",
      message: "{ready} · Ship returning from the {target}"
    }),
    statusLoading: msg({
      id: "settlement.colony.statusLoading",
      message: "Ship loading · {departed}/{loads} loads sailed"
    }),
    statusSailing: msg({
      id: "settlement.colony.statusSailing",
      message: "Ship sailing to the target {target} · {arrived}/{loads} loads landed"
    }),
    recordReady: msg({
      id: "settlement.colony.statusReadyColony",
      message: "Colony is ready to visit"
    }),
    recordFighting: msg({
      id: "settlement.colony.recordFighting",
      message: "Fighting for the island"
    }),
    recordDefeated: msg({
      id: "settlement.colony.recordDefeated",
      message: "All troops lost"
    }),
    recordConquered: msg({
      id: "settlement.colony.recordConquered",
      message: "Conquered · free again in {time}"
    }),
    recordTest: msg({ id: "settlement.colony.recordTest", message: " (test)" }),
    adventureThreat: msg({
      id: "settlement.colony.adventureThreat",
      message: "{difficulty}: open land fight · {camps} camps · {soldiers} soldiers · {size}×{size} map · max {cap} troops"
    }),
    adventureContested: msg({
      id: "settlement.colony.recordFighting",
      message: "Fighting for the island"
    }),
    adventureDefeated: msg({
      id: "settlement.colony.adventureDefeated",
      message: "All troops lost · sail home"
    }),
    adventureLanded: msg({
      id: "settlement.colony.statusReadyAdventure",
      message: "Adventure is ready to visit"
    }),
    adventureWon: msg({
      id: "settlement.colony.adventureWon",
      message: "Victory · the reward ship waits"
    }),
    popupStayBuild: msg({
      id: "settlement.colony.popupStayBuild",
      message: "Stay and build"
    }),
    popupSailHome: msg({ id: "settlement.colony.popupSailHome", message: "Sail home" }),
    popupDisband: msg({
      id: "settlement.colony.popupDisband",
      message: "Disband colony"
    }),
    popupStay: msg({ id: "settlement.colony.popupStay", message: "Stay" }),
    popupConqueredTitle: msg({
      id: "settlement.colony.popupConqueredTitle",
      message: "Island conquered!"
    }),
    popupFailedTitle: msg({
      id: "settlement.colony.popupFailedTitle",
      message: "The expedition has failed"
    }),
    popupConquered: msg({
      id: "settlement.colony.popupConquered",
      message: "Every enemy fort on {island} has fallen and its land is yours: build military, mine and food buildings here. Its mountain holds {ore}; fed miners' ore ships home {interval}{talent}. The colony is free again in {lifetime}."
    }),
    popupDefeated: msg({
      id: "settlement.colony.popupDefeated",
      message: "No soldiers are left on {island} and the enemy still holds its forts. Reinforcements cannot be sent; disband the colony to free its slot."
    }),
    popupAdventureWonTitle: msg({
      id: "settlement.colony.popupAdventureWonTitle",
      message: "Adventure won!"
    }),
    popupAdventureFailedTitle: msg({
      id: "settlement.colony.popupAdventureFailedTitle",
      message: "The adventure has failed"
    }),
    popupAdventureWon: msg({
      id: "settlement.colony.popupAdventureWon",
      message: "Every enemy on {island} has fallen. The reward ship carries the survivors home with:"
    }),
    popupAdventureDefeated: msg({
      id: "settlement.colony.popupAdventureDefeated",
      message: "No soldiers are left on {island}. The adventure is lost; the island is discarded when you sail home."
    }),
    durationEvery: msg({ id: "settlement.colony.durationEvery", message: "every {interval}" }),
    durationEveryDay: msg({ id: "settlement.colony.durationEveryDay", message: "every day" }),
    durationEveryHour: msg({ id: "settlement.colony.durationEveryHour", message: "every hour" }),
    durationEveryMinute: msg({ id: "settlement.colony.durationEveryMinute", message: "every minute" }),
    durationEverySecond: msg({ id: "settlement.colony.durationEverySecond", message: "every second" }),
    durationDayOne: msg({ id: "settlement.colony.durationDayOne", message: "1 day" }),
    durationDayMany: msg({ id: "settlement.colony.durationDayMany", message: "{count} days" }),
    durationHourOne: msg({ id: "settlement.market.ttlHour", message: "1 hour" }),
    durationHourMany: msg({ id: "settlement.colony.durationHourMany", message: "{count} hours" }),
    durationMinuteOne: msg({ id: "settlement.colony.durationMinuteOne", message: "1 minute" }),
    durationMinuteMany: msg({ id: "settlement.colony.durationMinuteMany", message: "{count} minutes" }),
    durationSecondOne: msg({ id: "settlement.colony.durationSecondOne", message: "1 second" }),
    durationSecondMany: msg({ id: "settlement.colony.durationSecondMany", message: "{count} seconds" }),
    trackerHeading: msg({
      id: "settlement.colony.trackerHeading",
      message: "Colonies & adventures"
    }),
    trackerHeadingCount: msg({
      id: "settlement.colony.trackerHeadingCount",
      message: "Expeditions ({count})"
    }),
    trackerMinimise: msg({
      id: "settlement.colony.trackerMinimise",
      message: "Minimise expeditions"
    }),
    trackerShow: msg({
      id: "settlement.colony.trackerShow",
      message: "Show expeditions"
    }),
    trackerAria: msg({
      id: "settlement.colony.trackerAria",
      message: "Colonies and expeditions"
    }),
    trackerMove: msg({
      id: "settlement.colony.trackerMove",
      message: "Move colony expeditions. Drag or use arrow keys."
    }),
    landedSupplies: msg({
      id: "settlement.colony.landedSupplies",
      message: "Landed supplies"
    }),
    suppliesHeld: msg({ id: "settlement.colony.suppliesHeld", message: "Supplies held" }),
    arrivedNote: msg({
      id: "settlement.colony.arrivedNote",
      message: "The colony harbour stands ready. Visiting the island comes in the next update."
    }),
    adventureKind: msg({ id: "settlement.colony.adventureKind", message: "Adventure" }),
    colonyKind: msg({ id: "settlement.colony.colonyKind", message: "Colony" }),
    expeditionCardLabel: msg({
      id: "settlement.colony.expeditionCardLabel",
      message: "{kind} expedition {id} details"
    }),
    expeditionTitle: msg({
      id: "settlement.colony.expeditionTitle",
      message: "{kind} · {island} · {difficulty}"
    }),
    cancelExpedition: msg({
      id: "settlement.colony.cancelExpedition",
      message: "Cancel expedition"
    }),
    disband: msg({ id: "settlement.colony.disband", message: "Disband" }),
    abandon: msg({ id: "settlement.colony.abandon", message: "Abandon" }),
    keepFighting: msg({
      id: "settlement.colony.keepFighting",
      message: "Keep fighting"
    }),
    keepColony: msg({ id: "settlement.colony.keepColony", message: "Keep colony" }),
    disbandQuestion: msg({
      id: "settlement.colony.disbandQuestion",
      message: "Disband {island}?"
    }),
    abandonQuestion: msg({
      id: "settlement.colony.abandonQuestion",
      message: "Abandon {island}?"
    }),
    disbandMessage: msg({
      id: "settlement.colony.disbandMessage",
      message: "Surviving soldiers sail home and {island} becomes free for another expedition."
    }),
    abandonMessage: msg({
      id: "settlement.colony.abandonMessage",
      message: "Surviving soldiers sail home without a reward and {island} is discarded."
    }),
    youAreHere: msg({ id: "settlement.colony.youAreHere", message: "You are here: {island}" }),
    visit: msg({ id: "settlement.colony.visit", message: "Visit {island}" }),
    recall: msg({ id: "settlement.colony.recall", message: "Send back soldiers" }),
    returnCommander: msg({
      id: "settlement.colony.returnCommander",
      message: "Return commander"
    }),
    returnCommanderPending: msg({
      id: "settlement.colony.returnCommanderPending",
      message: "The commander is returning by ship."
    }),
    commanderVoyage: msg({
      id: "settlement.colony.commanderVoyage",
      message: "Commander {name} · level {level} · HP {hp}/{maximum} · {slots} deck slots · XP {xp}"
    }),
    recallPending: msg({
      id: "settlement.colony.recallPending",
      message: "Ship requested for returning soldiers"
    }),
    disbandAction: msg({
      id: "settlement.colony.disbandAction",
      message: "Disband {island}"
    }),
    abandonAction: msg({
      id: "settlement.colony.abandonAction",
      message: "Abandon {island}"
    }),
    returnHome: msg({
      id: "settlement.colony.returnHome",
      message: "Return to the home island"
    }),
    homeIsland: msg({ id: "settlement.colony.homeIsland", message: "Home island" }),
    mainSettlement: msg({
      id: "settlement.colony.mainSettlement",
      message: "Your main settlement"
    }),
    returningFrom: msg({
      id: "settlement.colony.returningFrom",
      message: " · Ship returning from the {target}"
    }),
    here: msg({ id: "settlement.colony.here", message: " · You are here" }),
    resourceArrives: msg({
      id: "settlement.colony.resourceArrives",
      message: "Resource ship arrives in ≈ {time}"
    }),
    resourceCollecting: msg({
      id: "settlement.colony.resourceCollecting",
      message: "Resource ship collecting goods or waiting for the harbour"
    }),
    resourceNext: msg({
      id: "settlement.colony.resourceNext",
      message: "Next scheduled resource pickup in {time}"
    }),
    resourceEarlier: msg({
      id: "settlement.colony.resourceEarlier",
      message: "A full cargo box can request an earlier pickup."
    }),
    incomingUnloading: msg({
      id: "settlement.colony.incomingUnloading",
      message: "Unloading at harbour"
    }),
    incomingWaiting: msg({
      id: "domain.ship.label.waitingForHarbour",
      message: "Waiting for harbour"
    }),
    incomingArrives: msg({
      id: "settlement.colony.incomingArrives",
      message: "Arrives in ≈ {time}"
    }),
    incomingAria: msg({
      id: "settlement.colony.incomingAria",
      message: "Incoming ships"
    }),
    coloniesAria: msg({ id: "settlement.colony.coloniesAria", message: "Colonies" }),
    colonyTitle: msg({
      id: "settlement.colony.colonyTitle",
      message: "Colony · {island}"
    }),
    adventureTitle: msg({
      id: "settlement.colony.adventureTitle",
      message: "Adventure · {island}"
    })
  },
  register: {
    title: msg({ id: "settlement.register.title", message: "Building overview" }),
    overview: msg({ id: "settlement.register.title", message: "Building overview" }),
    built: msg({ id: "settlement.register.built", message: "Built" }),
    underConstruction: msg({ id: "settlement.register.underConstruction", message: "Under construction" }),
    description: msg({
      id: "settlement.register.description",
      message: "Built buildings · construction sites. Select an icon to visit a built building."
    }),
    cardLabel: msg({
      id: "settlement.register.cardLabel",
      message: "{name}: {built} built, {sites} under construction"
    }),
    cardTitle: msg({
      id: "settlement.register.cardTitle",
      message: "{name}: {built} built · {sites} under construction"
    })
  },
  summary: {
    title: msg({ id: "settlement.summary.title", message: "Settlement overview" }),
    goods: msg({ id: "settlement.market.goods", message: "Goods" }),
    settlers: msg({ id: "settlement.summary.settlers", message: "Settlers" }),
    resources: msg({ id: "settlement.gemShop.categoryResources", message: "Resources" }),
    population: msg({ id: "settlement.summary.population", message: "Population" }),
    populationLabel: msg({
      id: "settlement.summary.populationLabel",
      message: "Population: {value}"
    }),
    idle: msg({ id: "settlement.summary.idle", message: "Idle settlers" }),
    idleLabel: msg({
      id: "settlement.summary.idleLabel",
      message: "Idle settlers: {value}"
    }),
    workers: msg({ id: "settlement.summary.workers", message: "Workers" }),
    noWorkers: msg({
      id: "settlement.summary.noWorkers",
      message: "No workers on the island."
    }),
    military: msg({ id: "settlement.summary.military", message: "Military units" }),
    noSoldiers: msg({
      id: "settlement.summary.noSoldiers",
      message: "No soldiers on the island."
    }),
    sections: msg({
      id: "settlement.summary.sections",
      message: "Settlement overview sections"
    }),
    count: msg({ id: "settlement.summary.count", message: "{label}: {count}" })
  },
  talents: {
    title: msg({ id: "settlement.talents.title", message: "Talents" }),
    applySuccess: msg({ id: "settlement.talents.applySuccess", message: "Talents applied." }),
    unavailable: msg({
      id: "settlement.talents.unavailable",
      message: "Talents are unavailable"
    }),
    freeAgain: msg({
      id: "settlement.talents.freeAgain",
      message: "Every talent point is free again."
    }),
    pendingBack: msg({
      id: "settlement.talents.pendingBack",
      message: "Pending points taken back."
    }),
    branchEconomy: msg({ id: "development.group.economy", message: "Economy" }),
    branchLogistics: msg({
      id: "settlement.talents.branchLogistics",
      message: "Logistics & Population"
    }),
    branchMilitary: msg({ id: "settlement.talents.branchMilitary", message: "Military" }),
    effectBonus: msg({ id: "settlement.talents.effectBonus", message: "+{amount} {label}" }),
    effectReduction: msg({ id: "settlement.talents.effectReduction", message: "−{amount} {label}" }),
    nameAdventureExperience: msg({ id: "settlement.talents.nameAdventureExperience", message: "Adventure experience" }),
    nameAdventureLoot: msg({ id: "settlement.talents.nameAdventureLoot", message: "Adventure loot" }),
    nameAdventureSailing: msg({ id: "settlement.talents.nameAdventureSailing", message: "Adventure sailing" }),
    nameCarrierSpeed: msg({ id: "settlement.talents.nameCarrierSpeed", message: "Carrier speed" }),
    nameColonyProduction: msg({ id: "settlement.talents.nameColonyProduction", message: "Colony production" }),
    nameColonyShipInterval: msg({ id: "settlement.talents.groupColonyShips", message: "Colony resource ships" }),
    nameColonyStartSettlers: msg({ id: "settlement.talents.nameColonyStartSettlers", message: "Colony settlers" }),
    nameConstructionSpeed: msg({ id: "settlement.talents.nameConstructionSpeed", message: "Construction speed" }),
    nameDoorStrength: msg({ id: "settlement.talents.nameDoorStrength", message: "Door strength" }),
    nameFieldGrowth: msg({ id: "settlement.talents.nameFieldGrowth", message: "Field growth" }),
    nameHandcartCapacity: msg({ id: "settlement.talents.nameHandcartCapacity", message: "Handcart capacity" }),
    nameHunterFisherSpeed: msg({ id: "settlement.talents.nameHunterFisherSpeed", message: "Hunter & fisher" }),
    namePopulationLimit: msg({ id: "settlement.details.residence.limit", message: "Population limit" }),
    nameProductionSpeed: msg({ id: "settlement.talents.nameProductionSpeed", message: "Production speed" }),
    nameQuestRewards: msg({ id: "settlement.talents.nameQuestRewards", message: "Daily quest rewards" }),
    nameRecruitTraining: msg({ id: "settlement.talents.nameRecruitTraining", message: "Recruit training" }),
    nameSettlerGrowth: msg({ id: "settlement.talents.nameSettlerGrowth", message: "Settler growth" }),
    nameShipping: msg({ id: "settlement.talents.nameShipping", message: "Shipping" }),
    nameSiegeDamage: msg({ id: "settlement.talents.nameSiegeDamage", message: "Siege damage" }),
    nameSoldierStrength: msg({ id: "settlement.talents.nameSoldierStrength", message: "Veteran soldiers" }),
    nameStorageCapacity: msg({ id: "settlement.talents.nameStorageCapacity", message: "Storage capacity" }),
    nameTowerArcherDamage: msg({ id: "settlement.talents.nameTowerArcherDamage", message: "Tower archers" }),
    nameTradeOfferSlot: msg({ id: "settlement.talents.nameTradeOfferSlot", message: "Market offer slot" }),
    nameTreeGrowth: msg({ id: "settlement.talents.nameTreeGrowth", message: "Tree growth" }),
    labelAdventureExperience: msg({ id: "settlement.talents.labelAdventureExperience", message: "adventure experience" }),
    labelAdventureLoot: msg({ id: "settlement.talents.labelAdventureLoot", message: "adventure loot" }),
    labelAdventureSailing: msg({ id: "settlement.talents.labelAdventureSailing", message: "sailing time to and from adventures" }),
    labelCarrierSpeed: msg({ id: "settlement.talents.labelCarrierSpeed", message: "carrier walking speed" }),
    labelColonyProduction: msg({ id: "settlement.talents.labelColonyProduction", message: "production speed on colonies" }),
    labelColonyShipInterval: msg({ id: "settlement.talents.labelColonyShipInterval", message: "colony resource ship interval" }),
    labelColonyStartSettlers: msg({ id: "settlement.talents.labelColonyStartSettlers", message: "starting settlers on a new colony" }),
    labelConstructionSpeed: msg({ id: "settlement.talents.labelConstructionSpeed", message: "construction speed" }),
    labelDockPorterSpeed: msg({ id: "settlement.talents.labelDockPorterSpeed", message: "dock porter speed" }),
    labelDoorStrength: msg({ id: "settlement.talents.labelDoorStrength", message: "door strength" }),
    labelFieldGrowth: msg({ id: "settlement.talents.labelFieldGrowth", message: "field growth speed" }),
    labelHandcartCapacity: msg({ id: "settlement.talents.labelHandcartCapacity", message: "handcart capacity (rounded down)" }),
    labelHunterFisherSpeed: msg({ id: "settlement.talents.labelHunterFisherSpeed", message: "hunter and fishery work speed" }),
    labelPopulationLimit: msg({ id: "settlement.talents.labelPopulationLimit", message: "population limit" }),
    labelProductionSpeed: msg({ id: "settlement.talents.labelProductionSpeed", message: "production speed" }),
    labelQuestRewards: msg({ id: "settlement.talents.labelQuestRewards", message: "daily quest experience" }),
    labelRecruitTraining: msg({ id: "settlement.talents.labelRecruitTraining", message: "recruit training speed" }),
    labelSettlerGrowth: msg({ id: "settlement.talents.labelSettlerGrowth", message: "settler growth" }),
    labelShipping: msg({ id: "settlement.talents.labelShipping", message: "trade, supply and colony voyage time" }),
    labelSiegeDamage: msg({ id: "settlement.talents.labelSiegeDamage", message: "siege damage to buildings" }),
    labelSoldierDamage: msg({ id: "settlement.talents.labelSoldierDamage", message: "soldier damage" }),
    labelSoldierHealth: msg({ id: "settlement.talents.labelSoldierHealth", message: "soldier health" }),
    labelStorageCapacity: msg({ id: "settlement.talents.labelStorageCapacity", message: "storage capacity (also the trade buy limit)" }),
    labelTowerArcherDamage: msg({ id: "settlement.talents.labelTowerArcherDamage", message: "archer damage from towers and doors" }),
    labelTradeOfferSlots: msg({ id: "settlement.talents.labelTradeOfferSlots", message: "Market offer slot(s)" }),
    labelTreeGrowth: msg({ id: "settlement.talents.labelTreeGrowth", message: "tree growth speed" }),
    groupAdventures: msg({ id: "settlement.talents.groupAdventures", message: "Adventures" }),
    groupAdventureShips: msg({ id: "settlement.talents.groupAdventureShips", message: "Adventure ships" }),
    groupBuilders: msg({ id: "settlement.talents.groupBuilders", message: "Builders" }),
    groupCarriers: msg({ id: "settlement.talents.groupCarriers", message: "Carriers" }),
    groupColonies: msg({ id: "settlement.colony.coloniesAria", message: "Colonies" }),
    groupColonyShips: msg({ id: "settlement.talents.groupColonyShips", message: "Colony resource ships" }),
    groupDailyQuests: msg({ id: "settlement.talents.groupDailyQuests", message: "Daily quests" }),
    groupDockPorters: msg({ id: "settlement.talents.groupDockPorters", message: "Dock porters" }),
    groupHandcarts: msg({ id: "settlement.talents.groupHandcarts", message: "Handcarts" }),
    groupProductionBuildings: msg({ id: "settlement.talents.groupProductionBuildings", message: "All production buildings" }),
    groupShips: msg({ id: "settlement.talents.groupShips", message: "Trade, supply and colony ships" }),
    groupSoldiers: msg({ id: "settlement.details.soldiers.heading", message: "Soldiers" }),
    groupTowerArchers: msg({ id: "settlement.talents.groupTowerArchers", message: "Archers in towers and at doors" }),
    groupTradeOffice: msg({ id: "settlement.menu.market", message: "Market" }),
    groupTrees: msg({ id: "settlement.talents.groupTrees", message: "Trees" }),
    tier: msg({ id: "settlement.talents.tier", message: "Tier {tier}" }),
    points: msg({
      id: "settlement.talents.points",
      message: "{placed} of {total} points spent"
    }),
    requiresLevel: msg({
      id: "settlement.build.requiresLevel",
      message: "Requires level {level} (you are level {levelNow})"
    }),
    requiresTier: msg({
      id: "settlement.talents.requiresTier",
      message: "Requires {points} points in {branch} tier {tier} ({placed} placed)"
    }),
    requiresBranch: msg({
      id: "settlement.talents.requiresBranch",
      message: "Requires {points} points in {branch} ({placed} placed)"
    }),
    pointsBadge: msg({ id: "settlement.talents.pointsBadge", message: "{points} pts" }),
    now: msg({
      id: "settlement.talents.now",
      message: "Now (rank {rank}): {effects}"
    }),
    nextRank: msg({
      id: "settlement.talents.nextRank",
      message: "Next rank ({rank}): {effects}"
    }),
    affects: msg({ id: "settlement.talents.affects", message: "Affects: {affects}" }),
    addPoint: msg({ id: "settlement.talents.addPoint", message: "Add a point" }),
    actionLabel: msg({
      id: "settlement.talents.actionLabel",
      message: "{name}: rank {rank} of {max}. {action}"
    }),
    resetPending: msg({
      id: "settlement.talents.resetPending",
      message: "Reset pending"
    }),
    resetPendingTitle: msg({
      id: "settlement.talents.resetPendingTitle",
      message: "Take back the points placed since Apply (free)"
    }),
    confirmReset: msg({
      id: "settlement.talents.confirmReset",
      message: "Confirm reset: {gems} gems"
    }),
    resetAll: msg({
      id: "settlement.talents.resetAll",
      message: "Reset all ({gems} gems)"
    }),
    resetAllTitle: msg({
      id: "settlement.talents.resetAllTitle",
      message: "Take back every applied point for {gems} gems"
    }),
    everyPointBack: msg({
      id: "settlement.talents.everyPointBack",
      message: "Every applied point comes back"
    }),
    apply: msg({ id: "settlement.talents.apply", message: "Apply" }),
    applyOne: msg({ id: "settlement.talents.applyOne", message: "Apply 1 point" }),
    applyMany: msg({
      id: "settlement.talents.applyMany",
      message: "Apply {count} points"
    })
  },
  popup: {
    title: msg({ id: "settlement.popup.title", message: "Popup" }),
    rewards: msg({ id: "settlement.popup.rewards", message: "Rewards" }),
    newBuildings: msg({ id: "settlement.popup.newBuildings", message: "New buildings" }),
    rewardItem: msg({ id: "settlement.popup.rewardItem", message: "{count} {label}" }),
    gems: msg({ id: "settlement.popup.gems", message: "Gems" }),
    level: msg({ id: "settlement.popup.level", message: "Level {level}!" }),
    levelMessage: msg({
      id: "settlement.popup.levelMessage",
      message: "Your settlers celebrate! The coins wait in your headquarters."
    }),
    levelChapter: msg({
      id: "settlement.popup.levelChapter",
      message: "New tutorial chapter: {chapter}."
    }),
    levelBuildings: msg({
      id: "settlement.popup.levelBuildings",
      message: "New buildings are ready in the build menu:"
    }),
    build: msg({ id: "settlement.popup.build", message: "Build" }),
    close: msg({ id: "settlement.common.close", message: "Close" }),
    upgrade: msg({ id: "settlement.popup.upgrade", message: "Upgrade" })
  },
  climate: {
    tropical: msg({ id: "settlement.climate.tropical", message: "Tropical" }),
    forest: msg({ id: "settlement.climate.forest", message: "Forest" }),
    winter: msg({ id: "settlement.climate.winter", message: "Winter" }),
    desert: msg({ id: "settlement.climate.desert", message: "Desert" }),
    swamp: msg({ id: "settlement.climate.swamp", message: "Swamp" }),
    distant: msg({
      id: "settlement.climate.distant",
      message: "Distant climate · sailing time +25% (loading and approach unchanged)"
    }),
    debug: msg({ id: "settlement.climate.debug", message: "Debug discovery override" })
  },
  terrain: {
    title: msg({ id: "settlement.terrain.title", message: "Terrain exploration" }),
    scoutTitle: msg({
      id: "settlement.terrain.scoutTitle",
      message: "Explore unknown ground"
    }),
    scoutDescription: msg({
      id: "settlement.terrain.scoutDescription",
      message: "Explore nearby fog with a Scout, then return to HQ. Requires a Spyglass."
    }),
    geologistTitle: msg({
      id: "settlement.terrain.geologistTitle",
      message: "Survey mine field"
    }),
    geologistDescription: msg({
      id: "settlement.terrain.geologistDescription",
      message: "Survey this mine field with a Geologist. Requires a hammer."
    }),
    send: msg({ id: "settlement.hud.placement.sendJob", message: "Send {job}" }),
    stale: msg({
      id: "settlement.terrain.stale",
      message: "This ground no longer needs that survey. Choose another area."
    })
  },
  bridge: {
    title: msg({ id: "settlement.bridge.title", message: "Bridge" }),
    nameWood: msg({ id: "settlement.bridge.nameWood", message: "Wooden bridge" }),
    nameStone: msg({ id: "settlement.bridge.nameStone", message: "Stone bridge" }),
    span: msg({ id: "settlement.bridge.span", message: "{tiles} tiles across the river · two-lane deck" }),
    levelAria: msg({ id: "settlement.bridge.levelAria", message: "Bridge level" }),
    stageFoundations: msg({ id: "settlement.bridge.stageFoundations", message: "Laying foundations and piers" }),
    stageDeck: msg({ id: "settlement.bridge.stageDeck", message: "Building the deck" }),
    stageRailings: msg({ id: "settlement.bridge.stageRailings", message: "Fitting the railings" }),
    designWood1: msg({ id: "settlement.bridge.designWood1", message: "softwood beams and post railings" }),
    designWood2: msg({ id: "settlement.bridge.designWood2",
      message: "hardwood, capped posts and braced railing bays" }),
    designWood3: msg({ id: "settlement.bridge.designWood3", message: "cedar, fascia boards and post brackets" }),
    designWood4: msg({ id: "settlement.bridge.designWood4",
      message: "walnut, iron-banded newel posts with finials" }),
    designWood5: msg({ id: "settlement.bridge.designWood5", message: "mahogany, a hand rail and newel lanterns" }),
    designStone1: msg({ id: "settlement.bridge.designStone1", message: "grey granite ashlar and coped parapets" }),
    designStone2: msg({ id: "settlement.bridge.designStone2", message: "marble, a dressed deck-edge moulding" }),
    designStone3: msg({ id: "settlement.bridge.designStone3",
      message: "limestone, parapet piers over the river piers" }),
    designStone4: msg({ id: "settlement.bridge.designStone4", message: "basalt, pyramid finials on the piers" }),
    designStone5: msg({ id: "settlement.bridge.designStone5",
      message: "warm granite, lanterns on the end piers and arch keystones" }),
    upgradeTitle: msg({ id: "settlement.bridge.upgradeTitle", message: "Each level gives the bridge a richer design:" }),
    current: msg({ id: "settlement.bridge.current", message: "Now (level {level}): {design}." }),
    nextLevel: msg({ id: "settlement.bridge.nextLevel", message: "Level {level}: {design}." }),
    headingMax: msg({ id: "settlement.bridge.headingMax", message: "Bridge level {level} (maximum)" }),
    note: msg({ id: "settlement.bridge.note",
      message: "An upgrade changes only the look: the bridge stays open and works exactly as before." }),
    confirmTitle: msg({ id: "settlement.bridge.confirmTitle", message: "Confirm bridge upgrade" }),
    statusIdle: msg({ id: "settlement.bridge.statusIdle",
      message: "Carriers deliver {cost} to the shore, then a builder refits the bridge." }),
    statusProgress: msg({ id: "settlement.bridge.statusProgress", message: "Builder refitting the bridge: {percent}%." }),
    requires: msg({ id: "settlement.bridge.requires",
      message: "Requires {cost}; carriers deliver them and a builder refits the bridge" }),
    busy: msg({ id: "settlement.bridge.busy", message: "This bridge is still being built or upgraded." }),
    mapCap: msg({ id: "settlement.bridge.mapCap", message: "This map does not allow a higher bridge level." }),
    noStorage: msg({ id: "settlement.bridge.noStorage",
      message: "Connect a shore of this bridge to completed storage with a road." }),
    removeCaption: msg({ id: "settlement.bridge.removeCaption", message: "Remove" }),
    removeLabel: msg({ id: "settlement.bridge.removeLabel", message: "Remove this bridge or its construction site" }),
    removeQuestion: msg({ id: "settlement.bridge.removeQuestion", message: "Remove this bridge?" }),
    removeCompleted: msg({ id: "settlement.bridge.removeCompleted",
      message: "The bridge closes to new traffic and comes down once the people on it have stepped off (within a minute). Carriers that can no longer reach their destination wait; after about five minutes they return to the nearest storage with their cargo. A finished bridge refunds nothing." }),
    removeSite: msg({ id: "settlement.bridge.removeSite",
      message: "Delivered materials return to storage; carriers bringing more turn back." }),
    removeConfirm: msg({ id: "settlement.bridge.removeConfirm", message: "Remove {name}" }),
    keep: msg({ id: "settlement.bridge.keep", message: "Keep {name}" }),
    removed: msg({ id: "settlement.bridge.removed", message: "Bridge removed." }),
    closing: msg({ id: "settlement.bridge.closing",
      message: "Bridge closed; it comes down once the deck is clear." }),
    removalPending: msg({ id: "settlement.bridge.removalPending",
      message: "Removal ordered: waiting for the deck to clear." }),
    dismantling: msg({ id: "settlement.bridge.dismantling", message: "Taking the bridge down: {percent}%." }),
    removalBusy: msg({ id: "settlement.bridge.removalBusy", message: "This bridge is already being removed." }),
    removeRefused: msg({ id: "settlement.bridge.removeRefused", message: "This bridge is no longer there." })
  },
  demolish: {
    title: msg({ id: "settlement.demolish.title", message: "Demolish building" }),
    removeTitle: msg({
      id: "settlement.demolish.removeTitle",
      message: "Remove construction site"
    }),
    question: msg({
      id: "settlement.demolish.question",
      message: "Demolish {name}?"
    }),
    removeQuestion: msg({
      id: "settlement.demolish.removeQuestion",
      message: "Remove the {name} construction site?"
    }),
    confirm: msg({ id: "settlement.demolish.confirm", message: "Demolish {name}" }),
    removeConfirm: msg({
      id: "settlement.demolish.removeConfirm",
      message: "Remove {name}"
    }),
    keep: msg({ id: "settlement.bridge.keep", message: "Keep {name}" })
  },
  status: {
    paused: msg({ id: "settlement.status.paused", message: "Production is paused. Use Resume when you are ready." }),
    needsOne: msg({ id: "settlement.status.needsOne", message: "Needs one of: {choices}" }),
    waitingFor: msg({ id: "settlement.status.waitingFor", message: "Waiting for {missing}" }),
    missingItem: msg({
      id: "settlement.status.missingItem",
      message: "{wares} ({ready}/{amount} ready, {incoming} incoming)"
    }),
    choiceItem: msg({
      id: "settlement.status.choiceItem",
      message: "{wares} ({incoming} incoming)"
    }),
    hintDeposit: msg({
      id: "settlement.status.hintDeposit",
      message: "This deposit has no remaining resource. Survey or choose another deposit."
    }),
    hintHandcart: msg({
      id: "settlement.status.hintHandcart",
      message: "Make room for a hand cart in a connected storage."
    }),
    hintOutput: msg({
      id: "settlement.status.hintOutput",
      message: "The output court is full. Check connected storage and its receiving policy."
    }),
    hintOrders: msg({
      id: "settlement.status.hintOrders",
      message: "The requested quantity is complete. Add another order to continue."
    }),
    hintRoad: msg({
      id: "settlement.status.hintRoad",
      message: "Connect this building's entrance to a completed storage with a road."
    }),
    hintReturn: msg({
      id: "settlement.status.hintReturn",
      message: "The worker cannot currently return. Inspect the route and entrances."
    }),
    hintSowing: msg({
      id: "settlement.status.hintSowing",
      message: "Leave usable field space inside the selected farm area."
    }),
    hintConstruction: msg({
      id: "settlement.status.hintConstruction",
      message: "The builder needs the remaining materials delivered to this site."
    }),
    hintResource: msg({
      id: "settlement.status.hintResource",
      message: "Check the selected work area for a usable resource and clear access."
    }),
    hintAccess: msg({
      id: "settlement.status.hintAccess",
      message: "The entrance is not currently safe to use. Inspect its approach."
    }),
    hintQuarry: msg({
      id: "settlement.status.hintQuarry",
      message: "Requires a reachable {stone} deposit within 24 tiles. Deposits are finite."
    }),
    hintTree: msg({
      id: "settlement.status.hintTree",
      message: "Requires a mature {tree} tree within reach; other species cannot be harvested."
    }),
    hintInputs: msg({
      id: "settlement.status.hintInputs",
      message: "{status}. Check the input producers and storage supply policies."
    }),
    hintTool: msg({
      id: "settlement.status.hintTool",
      message: "A {tool} must be available in road-connected storage to assign this worker."
    }),
    hintPopulation: msg({
      id: "settlement.status.hintPopulation",
      message: "Population limit reached. Build a residence to raise the limit, or free an existing worker."
    }),
    settlerWait: msg({
      id: "settlement.status.settlerWait",
      message: "There are no idle settlers available to take this job. The headquarters gains a settler every {seconds} seconds while the island is below its population limit."
    }),
    settlerWaitTalent: msg({
      id: "settlement.status.settlerWaitTalent",
      message: "There are no idle settlers available to take this job. The headquarters gains a settler every {seconds} seconds (+{percent}% talent) while the island is below its population limit."
    }),
    progressChopping: msg({ id: "settlement.status.progressChopping", message: "Chopping" }),
    progressTreeFalling: msg({ id: "settlement.status.progressTreeFalling", message: "Tree falling" }),
    progressPlanting: msg({ id: "settlement.status.progressPlanting", message: "Planting" }),
    progressDrawingBow: msg({ id: "settlement.status.progressDrawingBow", message: "Drawing the bow" }),
    progressArrow: msg({ id: "settlement.status.progressArrow", message: "Arrow in flight" }),
    progressCasting: msg({ id: "settlement.status.progressCasting", message: "Casting" }),
    progressWaitingBite: msg({ id: "settlement.status.progressWaitingBite", message: "Waiting for a bite" }),
    progressReeling: msg({ id: "settlement.status.progressReeling", message: "Reeling in" }),
    progressBoatLift: msg({ id: "settlement.status.progressBoatLift", message: "Lifting the boat" }),
    progressBoatLaunch: msg({ id: "settlement.status.progressBoatLaunch", message: "Launching the boat" }),
    progressBoatNet: msg({ id: "settlement.status.progressBoatNet", message: "Net in the water" }),
    progressBoatBeach: msg({ id: "settlement.status.progressBoatBeach", message: "Beaching the boat" }),
    progressSowing: msg({ id: "settlement.status.progressSowing", message: "Sowing" }),
    progressHarvesting: msg({ id: "settlement.status.progressHarvesting", message: "Harvesting" }),
    progressDrawingWater: msg({ id: "settlement.status.progressDrawingWater", message: "Drawing water" }),
    progressWorking: msg({ id: "settlement.status.progressWorking", message: "Working" }),
    progressPigs: msg({ id: "settlement.status.progressPigs", message: "Pigs feeding and growing" }),
    recallArriving: msg({ id: "settlement.status.recallArriving", message: "Ship arriving in {time}" }),
    recallBoarding: msg({ id: "settlement.status.recallBoarding", message: "Soldiers boarding the ship" }),
    recallReturning: msg({
      id: "settlement.status.recallReturning",
      message: "Ship returning to the home island"
    }),
    recallWaiting: msg({
      id: "settlement.status.recallWaiting",
      message: "Ship waiting for soldiers at the harbour"
    }),
    recallSailing: msg({
      id: "settlement.status.recallSailing",
      message: "Ship sailing to the colony harbour"
    }),
    boarding: msg({ id: "domain.status.boarding", message: "Boarding {aboard}/{total}" }),
    passengers: msg({ id: "settlement.status.passengers", message: "{count} passengers" }),
    settlementExpedition: msg({
      id: "settlement.status.settlementExpedition",
      message: "settlement expedition"
    }),
    explorationExpedition: msg({
      id: "settlement.status.explorationExpedition",
      message: "exploration expedition"
    }),
    constructionProgress: msg({
      id: "domain.status.withPercent",
      message: "{status} ({percent}%)"
    }),
    buildingComplete: msg({
      id: "settlement.status.buildingComplete",
      message: "{building} is complete."
    }),
    buildingStatus: msg({
      id: "domain.status.buildingStatus",
      message: "{building}: {status}."
    }),
    colonyConquered: msg({
      id: "settlement.status.colonyConquered",
      message: "{island} is conquered!"
    }),
    colonyFailed: msg({
      id: "settlement.status.colonyFailed",
      message: "The colony expedition failed."
    }),
    adventureWon: msg({
      id: "settlement.status.adventureWon",
      message: "{island}: adventure won!"
    }),
    adventureFailed: msg({
      id: "domain.refusal.adventureFailed",
      message: "The adventure failed."
    }),
    fortDestroyed: msg({
      id: "settlement.status.fortDestroyed",
      message: "{fort} destroyed! It burns down."
    }),
    fortNoDefenders: msg({
      id: "settlement.status.fortNoDefenders",
      message: "{fort} has no defenders left: your soldiers attack its walls."
    })
  },
  actions: {
    transition: msg({
      id: "domain.app.islandChanging",
      message: "The island is changing. Try again in a moment."
    }),
    passengerRefused: msg({
      id: "settlement.actions.passengerRefused",
      message: "Passenger voyage cannot be queued."
    }),
    passengerQueued: msg({
      id: "settlement.actions.passengerQueued",
      message: "Passenger voyage queued."
    }),
    explorationRefused: msg({
      id: "settlement.actions.explorationRefused",
      message: "Exploration needs an idle settler, a spyglass, an idle ship and an unexplored reachable shore."
    }),
    explorationQueued: msg({
      id: "settlement.actions.explorationQueued",
      message: "Exploration expedition queued; the scout returns home."
    }),
    expeditionQueued: msg({
      id: "settlement.actions.expeditionQueued",
      message: "Settlement expedition queued."
    }),
    expeditionInvalid: msg({
      id: "settlement.actions.expeditionInvalid",
      message: "No valid shore, or an expedition is already active."
    }),
    expeditionPreparing: msg({
      id: "settlement.actions.expeditionPreparing",
      message: "Preparing expedition: carriers collect supplies and crew await a ship."
    }),
    colonyPreparing: msg({
      id: "settlement.actions.colonyPreparing",
      message: "Colony expedition preparing: troops, crew and supplies gather at the harbour."
    }),
    adventurePreparing: msg({
      id: "settlement.actions.adventurePreparing",
      message: "Adventure expedition preparing: the troops gather at the harbour."
    }),
    colonyCancelled: msg({
      id: "settlement.actions.colonyCancelled",
      message: "Colony expedition cancelled; troops and supplies return."
    }),
    cargoInvalid: msg({
      id: "domain.app.noSeaRouteOrCargo",
      message: "No sea route or cargo available."
    }),
    cargoQueued: msg({
      id: "settlement.actions.cargoQueued",
      message: "Sea cargo order queued."
    }),
    upgradeCancelled: msg({
      id: "settlement.actions.upgradeCancelled",
      message: "Upgrade cancelled; unconsumed deliveries will return to storage."
    }),
    upgradeRequested: msg({
      id: "settlement.actions.upgradeRequested",
      message: "Upgrade requested. Delivered materials and a builder are required."
    }),
    homeSandboxOn: msg({
      id: "settlement.actions.homeSandboxOn",
      message: "Home sandbox on: every building and level is open on your home island."
    }),
    homeSandboxOff: msg({
      id: "settlement.actions.homeSandboxOff",
      message: "Home sandbox off: your player level unlocks buildings again."
    }),
    demolished: msg({
      id: "settlement.actions.demolished",
      message: "Building demolished. Unconsumed stock recovered; its crew returns home."
    }),
    demolishRefused: msg({
      id: "domain.refusal.demolishGeneric",
      message: "Cannot demolish this building"
    }),
    recruitsOrdered: msg({
      id: "settlement.actions.recruitsOrdered",
      message: "Recruits ordered: carriers bring the equipment to the Military Academy."
    }),
    commanderRecruited: msg({
      id: "settlement.actions.commanderRecruited",
      message: "Commander recruited at the Commander's Lodge."
    }),
    commanderReturning: msg({
      id: "settlement.actions.commanderReturning",
      message: "The commander is returning home by ship."
    }),
    tutorialsUnavailable: msg({
      id: "settlement.actions.tutorialsUnavailable",
      message: "Tutorials are unavailable"
    }),
    questsUnavailable: msg({
      id: "domain.refusal.questsUnavailable",
      message: "Quests are unavailable"
    }),
    talentsUnavailable: msg({
      id: "settlement.actions.talentsUnavailable",
      message: "Talents are unavailable"
    }),
    gemShopUnavailable: msg({
      id: "settlement.actions.gemShopUnavailable",
      message: "The gem shop is unavailable"
    }),
    questCompleted: msg({
      id: "settlement.actions.questCompleted",
      message: "Quest completed!"
    }),
    purchaseDelivered: msg({
      id: "settlement.actions.purchaseDelivered",
      message: "Purchase delivered to your home storage."
    }),
    sailingColony: msg({
      id: "domain.app.sailingToColony",
      message: "Sailing to the colony…"
    }),
    disbandingColony: msg({
      id: "settlement.actions.disbandingColony",
      message: "Disbanding the colony; its garrison sails home."
    }),
    sailingHome: msg({ id: "domain.app.sailingHome", message: "Sailing home…" }),
    chooseSite: msg({
      id: "settlement.actions.chooseSite",
      message: "Choose a site for {building}."
    }),
    surveyGeologist: msg({
      id: "settlement.actions.surveyGeologist",
      message: "Choose a connected road endpoint for the geologist."
    }),
    surveyScout: msg({
      id: "settlement.actions.surveyScout",
      message: "Choose a connected road endpoint for the scout."
    }),
    planned: msg({
      id: "settlement.actions.planned",
      message: "Planned {building}. Connect its road endpoint."
    }),
    tutorialComplete: msg({
      id: "settlement.actions.tutorialComplete",
      message: "Tutorial objective complete. Open Quests to claim your reward."
    }),
    marketReload: msg({
      id: "settlement.actions.marketReload",
      message: "{reason}. Reload the cloud save before saving again."
    }),
    chooseBuilding: msg({
      id: "settlement.actions.chooseBuilding",
      message: "Choose a building, then connect its road endpoint with a dirt road."
    }),
    dispatched: msg({ id: "settlement.actions.dispatched", message: "{job} dispatched." })
  }
} as const;
