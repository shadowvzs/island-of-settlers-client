import { msg } from "@lingui/core/macro";

/** Smart right-click order feedback (military controls §6); written to the settlement message line. */
export const ARMY_TARGET_MESSAGES = {
  attackUnit: msg({ id: "settlement.armyTarget.attackUnit", message: "Soldiers attack the enemy." }),
  gather: msg({ id: "settlement.armyTarget.gather", message: "Soldiers gather at the building." }),
  garrison: msg({
    id: "settlement.armyTarget.garrison",
    message: "{count, plural, one {# soldier entering the garrison.} other {# soldiers entering the garrison.}}"
  }),
  garrisonFull: msg({ id: "settlement.armyTarget.garrisonFull", message: "That building has no room for infantry." }),
  garrisonRiders: msg({
    id: "settlement.armyTarget.garrisonRiders",
    message: "{count, plural, one {# soldier entering} other {# soldiers entering}}; riders wait outside (riders cannot garrison)."
  }),
  ground: {
    attackMove: msg({ id: "settlement.armyTarget.attackMove", message: "Attack move: soldiers fight on the way." }),
    move: msg({ id: "settlement.armyTarget.move", message: "Move: soldiers strike back only when attacked." }),
    retreat: msg({ id: "settlement.armyTarget.retreat", message: "Retreat: soldiers ignore enemies on the way." })
  },
  noGround: msg({ id: "settlement.armyTarget.noGround", message: "Choose reachable land." }),
  onlyRiders: msg({
    id: "settlement.armyTarget.onlyRiders",
    message: "Riders cannot garrison; they wait outside the building."
  }),
  queued: msg({
    id: "settlement.armyTarget.queued",
    message: "{count, plural, one {Order queued: # order waits after the current one.} other {Order queued: # orders wait after the current one.}}"
  }),
  board: msg({ id: "settlement.armyTarget.board", message: "Soldiers board the ship." }),
  queueStarted: msg({ id: "settlement.armyTarget.queueStarted", message: "Order started." }),
  queueFull: msg({ id: "settlement.armyTarget.queueFull", message: "This group's order queue is full." }),
  queueUnsupported: msg({
    id: "settlement.armyTarget.queueUnsupported",
    message: "Shift cannot queue that order."
  }),
  siege: msg({ id: "settlement.armyTarget.siege", message: "Soldiers besiege the building." }),
  siegeArchers: msg({
    id: "settlement.armyTarget.siegeArchers",
    message: "Soldiers besiege the building; {archers, plural, one {# archer moves} other {# archers move}} up to shoot the defenders."
  }),
  siegeOnlyArchers: msg({
    id: "settlement.armyTarget.siegeOnlyArchers",
    message: "Archers cannot storm the door; they move up to shoot the defenders until it falls."
  }),
  targetUnit: msg({ id: "settlement.armyTarget.targetUnit", message: "Soldiers chase the targeted enemy." }),
  targetRefused: {
    noTroops: msg({ id: "settlement.armyTarget.targetNoTroops", message: "No eligible troops can reach that target." }),
    targetHidden: msg({ id: "settlement.armyTarget.targetHidden", message: "That enemy is out of sight." }),
    targetMissing: msg({ id: "settlement.armyTarget.targetMissing", message: "That enemy is gone." }),
    targetNotHostile: msg({
      id: "settlement.armyTarget.targetNotHostile", message: "Only enemy units can be targeted."
    }),
    targetUnreachable: msg({
      id: "settlement.armyTarget.targetUnreachable", message: "That enemy cannot be reached on land."
    })
  },
  store: msg({ id: "settlement.armyTarget.store", message: "Soldiers return to this storehouse." }),
  storeRefused: msg({
    id: "settlement.armyTarget.storeRefused",
    message: "No soldier of this selection can reach that storehouse."
  })
};
