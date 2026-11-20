import type { BuildingFirstNation } from "../workers/worker-nation";
import type { Point3 } from "./building-recipe";

export interface ExpansionDrinkWorkstation {
  /** Recipe-space position beside the front of the input vessel, behind the first output row. */
  workerStand: Point3;
  /** Faces towards -z into the workbench. */
  heading: number;
  machineBase: Point3;
  leftGrip: Point3;
  rightGrip: Point3;
  /** The original raw-input stock contact remains unchanged behind the work surface. */
  rawInput: Point3;
  workHeight: number;
}

const LAYOUTS: Readonly<Record<BuildingFirstNation, ExpansionDrinkWorkstation>> = {
  chinese: { heading: Math.PI, leftGrip: [.79, .46, .23], machineBase: [.87, 0, .24],
    rawInput: [.87, .19, -.13], rightGrip: [.95, .46, .23], workerStand: [.87, 0, .49], workHeight: .36 },
  persian: { heading: Math.PI, leftGrip: [.79, .54, .23], machineBase: [.87, 0, .24],
    rawInput: [.87, .19, -.13], rightGrip: [.95, .54, .23], workerStand: [.87, 0, .49], workHeight: .36 },
  maya: { heading: Math.PI, leftGrip: [.77, .44, .25], machineBase: [.87, 0, .24],
    rawInput: [.87, .19, -.13], rightGrip: [.97, .44, .25], workerStand: [.87, 0, .49], workHeight: .36 },
  indigenous: { heading: Math.PI, leftGrip: [.79, .46, .24], machineBase: [.87, 0, .24],
    rawInput: [.87, .19, -.13], rightGrip: [.95, .46, .24], workerStand: [.87, 0, .49], workHeight: .36 }
};

/** Canonical shared layout for the rendered tools, worker positioning and production animation. */
export const expansionDrinkWorkstation = (nation: BuildingFirstNation): ExpansionDrinkWorkstation => LAYOUTS[nation];
