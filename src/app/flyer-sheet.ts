import { getWingTuck } from "../render-common/birds/bird-flight";
import type { BirdManager } from "../render-common/birds/bird-manager";
import { type BirdFrame,createBirdFrame } from "../render-common/birds/bird-pool";
import { BIRD_SPECIES } from "../render-common/birds/bird-species";
import {
  createViewRegion,
  fromViewAxes,
  HEIGHT_TO_V,
  updateViewRegion
} from "../render-common/birds/bird-view";
import type { ButterflyManager } from "../render-common/butterflies/butterfly-manager";
import {
  type ButterflyFrame,
  createButterflyFrame} from "../render-common/butterflies/butterfly-pool";
import { BUTTERFLY_SPECIES } from "../render-common/butterflies/butterfly-species";
import type { CameraState } from "../render-common/camera-state";
import type { EnvironmentState } from "../render-common/environment";
import { BUTTERFLY_VARIANTS } from "../render-common/flyers/flyer-atlas-layout";

type SurfaceAt = (x: number, z: number) => number;

/** Height of the specimens above the ground (world units). */
const SHEET_HEIGHT = 1.5;
/** Screen right, slightly towards the viewer. */
const SHEET_HEADING = -Math.PI / 8;
/** Bird columns: flap (wings up), glide, tight turn (banked, tucked). */
const BIRD_POSES = [
  { bank: 0, flapAmount: 1, flapPhase: Math.PI / 2 },
  { bank: 0, flapAmount: 0, flapPhase: 0 },
  { bank: 0.75, flapAmount: 0.3, flapPhase: Math.PI }
];
/** Butterfly wing angle of odd sheets (open, upper side) and even ones (raised, under side). */
const SHEET_WINGS = [0.05, 1.15];

interface SheetLook {
  /** Wing pattern variant: sheets 1-2 the first, 3-4 the second, 5-6 the third. */
  variant: number;
  wing: number;
}

const getSheetLook = (sheet: number): SheetLook => ({
  variant: Math.floor((sheet - 1) / 2) % BUTTERFLY_VARIANTS,
  wing: SHEET_WINGS[(sheet - 1) % 2]!
});
/**
 * Butterfly specimens (the pool holds 6): every species enlarged for a close look, then the first
 * two at their true size.
 */
const BUTTERFLY_CELLS = [
  ...BUTTERFLY_SPECIES.map((_, species) => ({ column: 0, enlarge: 2.5, row: species, species })),
  { column: 1, enlarge: 1, row: 0, species: 0 },
  { column: 1, enlarge: 1, row: 1, species: 1 }
];

interface SheetCell {
  column: number;
  columns: number;
  row: number;
  rows: number;
}

/** Ground point and height of a cell: birds on the left 60 % of the screen, butterflies right. */
const placeCell = (camera: CameraState, cell: SheetCell, left: number, width: number) => {
  const region = updateViewRegion(createViewRegion(), camera);
  const screenU = left + (width * (cell.column + 0.5)) / cell.columns;
  const screenV = -0.55 + (1.45 * (cell.row + 0.5)) / cell.rows;
  const u = screenU * region.halfU;
  const v = screenV * region.halfV + SHEET_HEIGHT * HEIGHT_TO_V;
  return fromViewAxes(region, u, v);
};

const writeBirds = (frame: BirdFrame, camera: CameraState, surface: SurfaceAt) => {
  let count = 0;
  BIRD_SPECIES.forEach((species, row) => {
    BIRD_POSES.forEach((pose, column) => {
      const cell = { column, columns: BIRD_POSES.length, row, rows: BIRD_SPECIES.length };
      const { x, z } = placeCell(camera, cell, -0.95, 1.15);
      frame.bank[count] = pose.bank;
      frame.flapAmount[count] = pose.flapAmount;
      frame.flapPhase[count] = pose.flapPhase;
      frame.ground[count] = surface(x, z);
      frame.heading[count] = SHEET_HEADING;
      frame.pitch[count] = 0;
      frame.scale[count] = species.size;
      frame.shade[count] = 1;
      frame.species[count] = row;
      frame.tuck[count] = getWingTuck(pose.bank, -1);
      frame.visibility[count] = 1;
      frame.x[count] = x;
      frame.y[count] = frame.ground[count]! + SHEET_HEIGHT;
      frame.z[count] = z;
      count += 1;
    });
  });
  frame.count = count;
  return frame;
};

const writeButterflies = (
  frame: ButterflyFrame,
  camera: CameraState,
  surface: SurfaceAt,
  sheet: SheetLook
) => {
  BUTTERFLY_CELLS.forEach(({ column, enlarge, row, species }, index) => {
    const cell = { column, columns: 2, row, rows: BUTTERFLY_SPECIES.length };
    const { x, z } = placeCell(camera, cell, 0.3, 0.65);
    frame.bend[index] = 0;
    frame.ground[index] = surface(x, z);
    frame.heading[index] = SHEET_HEADING;
    frame.scale[index] = BUTTERFLY_SPECIES[species]!.size * enlarge;
    frame.shade[index] = 1;
    frame.species[index] = species;
    frame.variant[index] = sheet.variant;
    frame.visibility[index] = 1;
    frame.wing[index] = sheet.wing;
    frame.x[index] = x;
    frame.y[index] = frame.ground[index]! + SHEET_HEIGHT;
    frame.z[index] = z;
  });
  frame.count = BUTTERFLY_CELLS.length;
  return frame;
};

/**
 * Specimen sheet (?flyers=1, model reviews): every bird species flapping, gliding and in a tight
 * turn, every butterfly species with open (odd sheets) or raised wings (even sheets) in a pattern
 * variant, held still in front of the camera.
 */
const createFlyerSheet = (surface: SurfaceAt, sheet: number) => {
  const birds = createBirdFrame(BIRD_SPECIES.length * BIRD_POSES.length);
  const butterflies = createButterflyFrame(BUTTERFLY_CELLS.length);
  const look = getSheetLook(Math.max(1, Math.round(sheet)));
  return {
    birds: (camera: CameraState) => writeBirds(birds, camera, surface),
    butterflies: (camera: CameraState) => writeButterflies(butterflies, camera, surface, look)
  };
};

interface FlyerSources {
  birds: BirdManager;
  butterflies: ButterflyManager;
  /** Specimen sheet number (?flyers), 0 for the ambient flyers. */
  sheet: number;
  sound: { trackBirds: (frame: BirdFrame) => BirdFrame };
}

/** The render loop's bird and butterfly updates: the ambient managers or the specimen sheet. */
export const connectFlyers = ({ birds, butterflies, sheet, sound }: FlyerSources) => {
  if (sheet <= 0) {
    return {
      updateBirds: (time: number, view: CameraState, state: EnvironmentState) =>
        sound.trackBirds(birds.update(time, view, state)),
      updateButterflies: butterflies.update
    };
  }
  const specimens = createFlyerSheet(birds.habitat.surface, sheet);
  return {
    updateBirds: (_time: number, view: CameraState) => specimens.birds(view),
    updateButterflies: (_time: number, view: CameraState) => specimens.butterflies(view)
  };
};
