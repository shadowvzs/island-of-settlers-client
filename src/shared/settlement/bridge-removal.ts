import { sampleSmooth } from "../world/grid-geometry";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import {
  BRIDGE_STRUCTURE_HALF_WIDTH,
  type BridgeDeck,
  deckCoordinates,
  deckPoint,
  segmentEntersDeck
} from "./bridge-deck";
import { bridgeTiles } from "./bridge-road";
import { beginBridgeWait } from "./bridge-wait";
import { carrierRoadRecoveryPath } from "./settlement-carrier-road-recovery";
import { isMountedNavigationClear, isNavigationClear, isTerrainClear } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import { bumpNavigationRevision } from "./settlement-reservations";
import { afterRoadsRemoved } from "./settlement-road-removal";
import { ROAD_TRAVEL_PHASES } from "./settlement-road-rerouting";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** Anything standing over the structure (deck, railings, abutment tops) counts as on the bridge. */
const STANDING_HALF_WIDTH = BRIDGE_STRUCTURE_HALF_WIDTH + 0.15;
/** The anchors themselves are dry shore: people there are already on a bank. */
const ANCHOR_MARGIN = 0.1;
/** Beyond an anchor, a person over a river cell still holds a closing deck. */
const MOUTH_REACH = 0.75;
/** A journey that only reaches an anchor (a shore road ending there) never used the deck. */
const CROSSING_CLEARANCE = 0.3;
/**
 * Bank spots behind an anchor, along its shore approach: nearest first. A rider needs more room than
 * a person on foot (a horse's clearance circle must not reach the river beside the mouth).
 */
const BANK_SETBACKS = [0.5, 1, 1.5, 2, 2.5, 3];
/** Lateral offsets kept on the bank, so a crowd does not land on one point. */
const BANK_LATERAL = 0.9;

export const isStandingOnDeck = (deck: BridgeDeck, actor: SettlementActor) => {
  if (!actor.visible || actor.phase === "retired") return false;
  const { across, along } = deckCoordinates(deck, actor);
  return along > ANCHOR_MARGIN && along < deck.length - ANCHOR_MARGIN && Math.abs(across) <= STANDING_HALF_WIDTH;
};

/**
 * Still using the deck: on it past the anchors, or just beyond an anchor but over river water (a
 * shore mouth beside an angled deck); people waiting on dry shore at an anchor do not hold it.
 */
export const occupiesDeck = (context: SettlementContext, deck: BridgeDeck, actor: SettlementActor) => {
  if (isStandingOnDeck(deck, actor)) return true;
  if (!actor.visible || actor.phase === "retired") return false;
  const { across, along } = deckCoordinates(deck, actor);
  if (along < -MOUTH_REACH || along > deck.length + MOUTH_REACH || Math.abs(across) > STANDING_HALF_WIDTH)
    return false;
  const { world } = context.options;
  return world.walkCost[Math.floor(actor.z) * world.cellsX + Math.floor(actor.x)] === 0;
};

const crossesDeck = (deck: BridgeDeck, from: SettlementPoint, to: SettlementPoint) =>
  segmentEntersDeck(deck, from, to, STANDING_HALF_WIDTH, CROSSING_CLEARANCE);

/** True when the rest of the actor's path uses the deck (a leg enters it past its anchors). */
export const pathCrossesDeck = (deck: BridgeDeck, actor: SettlementActor) => {
  let previous: SettlementPoint = actor;
  for (let index = actor.pathIndex; index < actor.path.length; index += 1) {
    const point = actor.path[index]!;
    if (crossesDeck(deck, previous, point)) return true;
    previous = point;
  }
  return false;
};

/** Bank spots behind the nearer anchor first (same side of the deck axis), then the other anchor. */
const bankCandidates = (deck: BridgeDeck, actor: SettlementActor) => {
  const { across, along } = deckCoordinates(deck, actor);
  const lateral = Math.max(-BANK_LATERAL, Math.min(BANK_LATERAL, across));
  const nearStart = along <= deck.length / 2;
  const behind = (start: boolean) => BANK_SETBACKS.flatMap(setback => {
    const reach = start ? -setback : deck.length + setback;
    return [deckPoint(deck, reach, lateral), deckPoint(deck, reach, 0)];
  });
  return [...behind(nearStart), ...behind(!nearStart)];
};

/**
 * Ground the actor may stand on and walk away from: a stand that fails its own clearance would let
 * the "walk off blocked ground" escape step it anywhere, the river included.
 */
const isStandClear = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  actor.mounted ? isMountedNavigationClear(context, point) : isNavigationClear(context, point);

/** Puts a person who stood on the removed deck on the safe bank of the nearer anchor. */
export const moveToBank = (context: SettlementContext, deck: BridgeDeck, actor: SettlementActor) => {
  const candidates = bankCandidates(deck, actor);
  const nearAnchor = deckCoordinates(deck, actor).along <= deck.length / 2 ? deck.start : deck.end;
  const bank = candidates.find(point => isStandClear(context, actor, point)) ??
    candidates.find(point => isTerrainClear(context, point)) ?? nearAnchor;
  const { world } = context.options;
  actor.x = bank.x;
  actor.z = bank.z;
  actor.y = sampleSmooth(world, world.heights, bank.x, bank.z);
  actor.queueTarget = undefined;
  actor.queueWait = 0;
};

/**
 * A road journey that used the deck re-joins the graph from where the actor stands; with no road
 * connection left it waits there (carriers keep their cargo and delivery) instead of wandering.
 * Actors still indoors re-validate when they reach public ground.
 */
const replanRoadJourney = (context: SettlementContext, actor: SettlementActor) => {
  const destination = actor.path.at(-1);
  if (!destination || !actor.visible) return;
  const resumed = carrierRoadRecoveryPath(context, actor, destination);
  if (resumed) setActorPath(actor, resumed.path, actor.phase);
  else beginBridgeWait(actor, destination);
};

/**
 * Re-plans every road journey that would use the deck. `keepStanding`: people already on a closing
 * deck walk off along their own paths.
 */
export const replanDeckCrossings = (context: SettlementContext, deck: BridgeDeck, keepStanding: boolean) => {
  for (const actor of context.actors)
    if (ROAD_TRAVEL_PHASES.has(actor.phase) && !actor.bridgeWait && actor.path.length &&
      !(keepStanding && isStandingOnDeck(deck, actor)) && pathCrossesDeck(deck, actor))
      replanRoadJourney(context, actor);
};

/** Takes the closed deck's edges out of the road graph: whoever still stands on it goes to a bank. */
export const removeClosedDeck = (context: SettlementContext, deck: BridgeDeck) => {
  const roads = context.options.roads;
  const tiles = bridgeTiles(roads.segments?.() ?? [], deck.id);
  if (!tiles.length || !roads.removeRoad?.(tiles[0]!.start, tiles[0]!.end)) return false;
  for (const actor of context.actors) if (isStandingOnDeck(deck, actor)) moveToBank(context, deck, actor);
  afterRoadsRemoved(context, tiles);
  bumpNavigationRevision(context);
  bumpBuildRevision(context.options.world, null);
  replanDeckCrossings(context, deck, false);
  return true;
};

/** The bridge owning a road edge, if the edge is a bridge tile. */
export const bridgeIdAt = (context: SettlementContext, start: SettlementPoint, end: SettlementPoint) =>
  context.options.roads.segments?.().find(segment => segment.bridge && (
    (segment.start.x === start.x && segment.start.z === start.z && segment.end.x === end.x &&
      segment.end.z === end.z) ||
    (segment.start.x === end.x && segment.start.z === end.z && segment.end.x === start.x &&
      segment.end.z === start.z)))?.bridge!.id;
