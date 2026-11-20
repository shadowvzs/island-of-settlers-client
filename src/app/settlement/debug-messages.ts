import { msg } from "@lingui/core/macro";

/**
 * Development-tool and military control copy. Descriptors stay lazy; controllers resolve them
 * through the active Lingui instance at display time. Simulation notices keep their English
 * source and are localized by the shared domain pipeline, so they are not repeated here.
 */
export const SETTLEMENT_DEBUG_MESSAGES = {
  military: {
    /** The map script's lock rule (TRG5a): a selected soldier is busy with a non-overridable story action. */
    storyLocked: msg({ id: "settlement.military.storyLocked", message: "Busy with a story task." }),
    actions: {
      heading: msg({ id: "settlement.military.actions.heading", message: "Soldier actions" }),
      loading: msg({ id: "settlement.military.actions.loading", message: "Loading soldier actions…" }),
      loadFailed: msg({
        id: "settlement.military.actions.loadFailed",
        message: "Soldier actions could not load. Close and reopen to retry."
      })
    },
    soldierSpawn: {
      label: msg({ id: "settlement.military.soldierSpawn.label", message: "Spawn soldier on click" }),
      title: msg({
        id: "settlement.military.soldierSpawn.title",
        message: "Click the map to spawn one random friendly soldier with a random rank. Escape or the button turns it off."
      })
    },
    training: {
      label: msg({ id: "settlement.military.training.label", message: "Start training encounter" }),
      title: msg({
        id: "settlement.military.training.title",
        message: "One-time skirmish: 20 soldiers of each type in HQ and an opposing army."
      })
    },
    debugSection: {
      label: msg({
        id: "settlement.military.debugSection.label", message: "Military development actions"
      })
    },
    ai: {
      title: msg({ id: "settlement.military.ai.title", message: "Military AI" }),
      mode: msg({ id: "settlement.military.ai.mode", message: "Mode: {mode}" }),
      overlay: msg({
        id: "settlement.military.ai.overlay", message: "AI debug overlay (flow, influence)"
      }),
      legend: msg({
        id: "settlement.military.ai.legend",
        message: "Overlay: blue/orange flow arrows, red/blue influence and squad decisions from the commander. Diagnostics refresh four times a second; drawing is bounded and may sample large maps."
      }),
      shippedMode: msg({
        id: "settlement.military.ai.shippedMode", message: "Flow fields + commander (shipped)"
      })
    }
  },
  debug: {
    roadsUpgraded: msg({ id: "settlement.debug.roadsUpgraded",
      message: "Upgraded {count} owned road segments by one tier." }),
    shipSpawn: {
      on: msg({ id: "settlement.debug.shipSpawn.on",
        message: "Create ship: click clear, deep sea. Escape or the button turns it off." }),
      off: msg({ id: "settlement.debug.shipSpawn.off", message: "Create ship is off." }),
      created: msg({ id: "settlement.debug.shipSpawn.created", message: "Ship created in your fleet." }),
      water: msg({ id: "settlement.debug.shipSpawn.water", message: "No ship created: choose deep sea water." }),
      clearance: msg({ id: "settlement.debug.shipSpawn.clearance",
        message: "No ship created: the full hull needs deeper water and room to turn." }),
      occupied: msg({ id: "settlement.debug.shipSpawn.occupied",
        message: "No ship created: another vessel or shipyard hull needs this space." })
    },
    accessDenied: msg({
      id: "settlement.debug.accessDenied",
      message: "Development tools are available only to administrators."
    }),
    buildAll: {
      doneOne: msg({
        id: "settlement.debug.buildAll.doneOne", message: "Built 1 finished building with roads."
      }),
      done: msg({
        id: "settlement.debug.buildAll.done",
        message: "Built {count} finished buildings with roads."
      }),
      skippedOne: msg({
        id: "settlement.debug.buildAll.skippedOne",
        message: "Built 1 finished building with roads. Skipped: {reasons}."
      }),
      skipped: msg({
        id: "settlement.debug.buildAll.skipped",
        message: "Built {count} finished buildings with roads. Skipped: {reasons}."
      }),
      skipItem: msg({
        id: "settlement.debug.buildAll.skipItem", message: "{building} ({reason})"
      })
    },
    expedition: {
      nameAdventure: msg({
        id: "development.tool.testAdventure", message: "Test adventure"
      }),
      nameColony: msg({
        id: "development.tool.testColony", message: "Test colony expedition"
      }),
      difficultyEasy: msg({
        id: "settlement.debug.expedition.difficultyEasy", message: "easy"
      }),
      difficultyMedium: msg({
        id: "settlement.debug.expedition.difficultyMedium", message: "medium"
      }),
      difficultyHard: msg({
        id: "settlement.debug.expedition.difficultyHard", message: "hard"
      }),
      failed: msg({ id: "settlement.debug.expedition.failed", message: "{name}: {reason}." }),
      started: msg({
        id: "settlement.debug.expedition.started",
        message: "{name}: granted {grants}. {target} to {island} ({difficulty}) is preparing with normal timers: {timers}. {arrival}"
      }),
      startedComplete: msg({
        id: "settlement.debug.expedition.startedComplete",
        message: "{name}: nothing was missing. {target} to {island} ({difficulty}) is preparing with normal timers: {timers}. {arrival}"
      }),
      grantHarbour: msg({
        id: "settlement.debug.expedition.grantHarbour", message: "a finished harbour with a road"
      }),
      grantShipOne: msg({ id: "settlement.debug.expedition.grantShipOne", message: "1 ship" }),
      grantShips: msg({ id: "settlement.debug.expedition.grantShips", message: "{count} ships" }),
      grantVeteranOne: msg({
        id: "settlement.debug.expedition.grantVeteranOne", message: "1 veteran soldier"
      }),
      grantVeterans: msg({
        id: "settlement.debug.expedition.grantVeterans", message: "{count} veteran soldiers"
      }),
      grantCrewOne: msg({
        id: "settlement.debug.expedition.grantCrewOne", message: "1 crew settler"
      }),
      grantCrew: msg({ id: "settlement.debug.expedition.grantCrew", message: "{count} crew settlers" }),
      arrivalAdventure: msg({
        id: "settlement.debug.expedition.arrivalAdventure",
        message: "The troops land by gangway on an island without buildings: only enemy field camps."
      }),
      arrivalColony: msg({
        id: "settlement.debug.expedition.arrivalColony",
        message: "The crew lands at a pre-built harbour; ore mines unlock once the garrisoned enemy forts fall."
      }),
      timerVoyage: msg({
        id: "settlement.debug.expedition.timerVoyage", message: "{seconds} s voyage"
      }),
      timerColony: msg({
        id: "settlement.debug.expedition.timerColony",
        message: "{seconds} s voyage, supply ship every {supplySeconds} s, ore ship every {oreSeconds} s, colony freed {days} days after conquest"
      }),
      targetAdventure: msg({ id: "settlement.colony.adventureKind", message: "Adventure" }),
      targetColony: msg({ id: "settlement.debug.expedition.targetColony", message: "Colony" })
    },
    placement: {
      clickUpgrade: msg({
        id: "settlement.debug.placement.clickUpgrade", message: "Click to upgrade to {tier}"
      }),
      sendJob: msg({ id: "settlement.debug.placement.sendJob", message: "Send {job} here" }),
      berthsOne: msg({ id: "settlement.debug.placement.berthsOne", message: "1 berth" }),
      berthsMany: msg({
        id: "settlement.debug.placement.berthsMany", message: "{count} berths (level 3)"
      }),
      readyRotate: msg({
        id: "settlement.debug.placement.readyRotate",
        message: "{building} · {width}×{depth} · R to rotate"
      }),
      readyTap: msg({
        id: "settlement.debug.placement.readyTap",
        message: "{building} · {width}×{depth} · tap again to build"
      }),
      vergeStart: msg({
        id: "settlement.debug.placement.vergeStart", message: "Choose the flower stretch's start"
      }),
      vergeEnd: msg({
        id: "settlement.debug.placement.vergeEnd", message: "Choose the flower stretch's end"
      }),
      vergeCost: msg({
        id: "settlement.debug.placement.vergeCost",
        message: "{tiles, plural, one {# tile} other {# tiles}} · {planks, plural, one {# plank} other {# planks}}"
      }),
      vergeOrdered: msg({
        id: "settlement.debug.placement.vergeOrdered",
        message: "Roadside flowers ordered: {tiles} tiles, {planks} planks delivered by carriers."
      }),
      vergeCancel: msg({
        id: "settlement.debug.placement.vergeCancel", message: "Cancel flower planting ({percent}%)?"
      }),
      vergeCancelled: msg({
        id: "settlement.debug.placement.vergeCancelled",
        message: "Flower planting cancelled; delivered planks return to storage."
      }),
      vergeCancelGone: msg({
        id: "settlement.debug.placement.vergeCancelGone",
        message: "That flower planting order is no longer running."
      }),
      vergeInvalidKind: msg({
        id: "settlement.debug.placement.vergeInvalidKind", message: "Unknown roadside plant kind"
      }),
      vergeNoRoad: msg({
        id: "settlement.debug.placement.vergeNoRoad", message: "No road stretch between these points"
      }),
      vergeNothingToPlant: msg({
        id: "settlement.debug.placement.vergeNothingToPlant", message: "This stretch already has flowers"
      }),
      vergeBusy: msg({
        id: "settlement.debug.placement.vergeBusy", message: "Another crew is planting this stretch"
      }),
      vergeNoStorage: msg({
        id: "settlement.debug.placement.vergeNoStorage",
        message: "Connect this stretch to a storage by road"
      })
    },
    hostile: {
      title: msg({ id: "settlement.debug.hostile.title", message: "{name} (enemy)" }),
      empty: msg({ id: "settlement.debug.hostile.empty", message: "No soldiers inside" }),
      row: msg({ id: "settlement.debug.hostile.row", message: "{troop} · Tier {tier}" })
    },
    enemySpawn: {
      on: msg({
        id: "settlement.debug.enemySpawn.on",
        message: "Spawn enemy on click: click the map. Escape or the button turns it off."
      }),
      off: msg({
        id: "settlement.debug.enemySpawn.off", message: "Spawn enemy on click is off."
      })
    },
    soldierSpawn: {
      on: msg({
        id: "settlement.debug.soldierSpawn.on",
        message: "Spawn soldier on click: click the map. Escape or the button turns it off."
      }),
      off: msg({
        id: "settlement.debug.soldierSpawn.off", message: "Spawn soldier on click is off."
      })
    }
  }
} as const;
