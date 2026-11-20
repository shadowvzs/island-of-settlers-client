import { SPECIES } from "../../wildlife/wildlife-species";
import { CRITTER } from "../critter-species";

/** How a roaming species moves and spends its time (critter-roam.ts). */
export interface RoamStyle {
  /** Body-size-specific heading speed; larger animals need wider turning arcs. */
  turnRate?: number;
  /** World units per gait cycle at a walk, a trot and in flight (GAIT). */
  cycle: readonly [walk: number, trot: number, run: number];
  feed: readonly [number, number];
  fleeRadius: number;
  /** Rolls up where it is instead of running from a threat (hedgehog). */
  curls?: boolean;
  /** Climbs rocky slopes off the animals' navigation (chamois: critter-rock.ts). */
  climber?: boolean;
  /** Which wildlife navigation mask its body fits (rabbit small, deer, elk large). */
  nav: number;
  /** Calm choices: walk, feed, look, rest (the rest of the share: standing). */
  odds: readonly [number, number, number, number];
  /** Rests longer around midday (fox, boar) or at night (wolf, bear). */
  restsByDay: boolean;
  /** Distance followers keep behind / around their leader. */
  spacing: number;
  speed: readonly [walk: number, trot: number, run: number];
}

/** Gait index into a style's `cycle` and `speed`. */
export const GAIT = { walk: 0, trot: 1, run: 2 } as const;
export type Gait = (typeof GAIT)[keyof typeof GAIT];

const FOX: RoamStyle = {
  turnRate: 3.0,
  cycle: [0.26, 0.42, 0.42],
  feed: [1.5, 4],
  fleeRadius: 5,
  nav: SPECIES.rabbit,
  odds: [0.35, 0.25, 0.2, 0.1],
  restsByDay: true,
  spacing: 0.5,
  speed: [0.22, 0.9, 0.9]
};

const BOAR: RoamStyle = {
  turnRate: 1.8,
  cycle: [0.3, 0.46, 0.78],
  feed: [3, 9],
  fleeRadius: 4,
  nav: SPECIES.deer,
  odds: [0.3, 0.45, 0.1, 0.08],
  restsByDay: true,
  spacing: 0.55,
  speed: [0.18, 0.75, 1.35]
};

const WOLF: RoamStyle = {
  turnRate: 2.4,
  cycle: [0.42, 0.7, 0.7],
  feed: [1.5, 3.5],
  fleeRadius: 7,
  nav: SPECIES.deer,
  odds: [0.4, 0.15, 0.2, 0.12],
  restsByDay: false,
  spacing: 0.7,
  speed: [0.3, 0.95, 0.95]
};

const BEAR: RoamStyle = {
  turnRate: 1.3,
  cycle: [0.55, 0.8, 0.8],
  feed: [4, 10],
  fleeRadius: 4.5,
  nav: SPECIES.elk,
  odds: [0.3, 0.35, 0.15, 0.1],
  restsByDay: false,
  spacing: 1,
  speed: [0.2, 0.55, 0.55]
};

const CHAMOIS: RoamStyle = {
  climber: true,
  cycle: [0.32, 0.5, 0.95],
  feed: [2, 7],
  fleeRadius: 6,
  nav: SPECIES.rabbit,
  odds: [0.35, 0.35, 0.2, 0.05],
  restsByDay: true,
  spacing: 0.6,
  speed: [0.22, 1.1, 1.8]
};

const HEDGEHOG: RoamStyle = {
  curls: true,
  cycle: [0.05, 0.08, 0.08],
  feed: [3, 9],
  fleeRadius: 2.2,
  nav: SPECIES.rabbit,
  odds: [0.45, 0.4, 0.05, 0.04],
  restsByDay: true,
  spacing: 0.3,
  speed: [0.07, 0.15, 0.15]
};
/** A rolled up hedgehog stays a ball this long (seconds) after the threat. */
export const CURL_SECONDS = 9;

const STYLES: Record<number, RoamStyle> = {
  [CRITTER.hedgehog]: HEDGEHOG,
  [CRITTER.chamois]: CHAMOIS,
  [CRITTER.chamoisKid]: CHAMOIS,
  [CRITTER.fox]: FOX,
  [CRITTER.boar]: BOAR,
  [CRITTER.piglet]: BOAR,
  [CRITTER.wolf]: WOLF,
  [CRITTER.bear]: BEAR
};

/** The roaming style of a species (the fox's for any other). */
export const getRoamStyle = (species: number) => STYLES[species] ?? FOX;
