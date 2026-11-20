import { BuildingType } from "../../../shared/settlement/building-type-ids";
import type { WorkerNation } from "../../workers/worker-unit";
import type { BuildingLevel } from "./building-level";
import { addHouseBench } from "./level-bench";
import { addNubianRoofPiece, addRoofLantern, addRoofShade, addTerraceCupola } from "./level-crown-nubian";
import { addRidgeTurret, VIKING_DORMER } from "./level-crown-viking";
import { addDoorHood } from "./level-door-hood";
import { addDormer } from "./level-dormer";
import { addDressedLevel, addRaisedBand } from "./level-dressing";
import { mayCarryFlag } from "./level-flag-policy";
import type { LevelKit } from "./level-kit";
import { addWorkAnnex } from "./level-lean-to";
import { addPaintedFrieze } from "./level-nubian-frieze";
import { addOriel } from "./level-oriel";
import { addDripPaving, addPavedApron } from "./level-paved-apron";
import { addPaintedGables } from "./level-viking-gables";
import { addSideCanopy } from "./level-wall-pieces";
import { addYardProps } from "./level-yard-props";

export type LevelStep = Exclude<BuildingLevel, 1>;
export type LevelSteps = Readonly<Record<LevelStep, (kit: LevelKit) => void>>;

/**
 * An escalating level progression (docs/plans/level-progression-design-2026-11-08.md): each level
 * adds one category, climbing from the ground to the roof top, and the ridge or terrace crown is
 * reserved for level 5. The level 4 roof review (ridge monitors, terrace vents) does not apply: it
 * would take the crown's place.
 */
export interface LevelProgression { steps: LevelSteps }

/** Level 2 for both nations: stone foundation course, framing and shutters, a paved forecourt and a bench. */
const addFoundationAndForecourt = (kit: LevelKit) => {
  addDressedLevel(kit);
  addPavedApron(kit);
  addDripPaving(kit);
  addHouseBench(kit);
};

/** Dormer shares along the ridge: a pair reads as a lived-in loft storey. */
const LOFT_DORMERS = [-.42, .42] as const;

/**
 * Level 3 for both nations: the walls rise (plan) under a string course and a pent-roofed annex
 * leans on the most camera-facing wall with room: over the yard's work area, or as a store.
 */
const addRaisedWallsAndAnnex = (kit: LevelKit) => {
  addRaisedBand(kit);
  const facing = addWorkAnnex(kit);
  // An annex hidden on a back wall (or none): a side canopy shows the step from the usual camera.
  if (facing === null || facing <= 0) addSideCanopy(kit);
};

const VIKING: LevelProgression = {
  steps: {
    2: addFoundationAndForecourt,
    3: addRaisedWallsAndAnnex,
    4: kit => {
      for (const share of LOFT_DORMERS) addDormer(kit, VIKING_DORMER, share);
      addDoorHood(kit);
      addYardProps(kit);
    },
    5: kit => {
      addRidgeTurret(kit);
      addPaintedGables(kit);
    }
  }
};

/** The level 5 cupola is the crown: half again as wide as the stock one, so it dominates the terrace. */
const CROWN_CUPOLA_GIRTH = 1.5;

const NUBIAN: LevelProgression = {
  steps: {
    2: addFoundationAndForecourt,
    3: addRaisedWallsAndAnnex,
    4: kit => {
      if (!addRoofShade(kit)) addNubianRoofPiece(kit, true);
      addDoorHood(kit);
      addYardProps(kit);
    },
    5: kit => {
      // The wide crown cupola, else the stock one beside the level 4 shade, else a lantern on the
      // kit's own dome or vault.
      if (!addTerraceCupola(kit, CROWN_CUPOLA_GIRTH) && !addTerraceCupola(kit)) addRoofLantern(kit);
      addOriel(kit);
      addPaintedFrieze(kit);
    }
  }
};

/** Nations on the escalating progression (owner accepted the prototype 2026-11-09). */
const PROGRESSIONS: Readonly<Partial<Record<WorkerNation, LevelProgression>>> = {
  nubian: NUBIAN,
  viking: VIKING
};

/** The Monument has no levels; military buildings and the HQ keep their banner and standard steps. */
const isProgressionType = (typeId: number) => typeId !== BuildingType.Monument && !mayCarryFlag(typeId);

/** The nation's escalating progression for a civilian building type, else null (the default steps). */
export const levelProgressionOf = (nation: WorkerNation, typeId: number): LevelProgression | null =>
  isProgressionType(typeId) ? PROGRESSIONS[nation] ?? null : null;
