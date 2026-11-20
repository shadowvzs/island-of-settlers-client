import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { RoofEnvelope } from "./nation-kit-classify";
import { isTablet, onTablet, TABLET_SIZE } from "./nation-kit-nubian-support";
import { insideRoof, MASONRY_SURFACES } from "./nation-kit-parts";

/** A porch tie beam: long, low, running across the front below the tablet. */
const BEAM_MAX_HEIGHT = .2;
const BEAM_MAX_SETBACK = .4;
/** A sign hangs only on a beam clear above the door lane (door height .77), never on a door lintel. */
const BEAM_MIN_BOTTOM = .9;
const BEAM_SURFACES: ReadonlySet<string> = new Set([...MASONRY_SURFACES, "wood"]);

export interface PorchSigns {
  /** Pictograms of tablets that lost their gable and have no beam to move to. */
  dropped: ReadonlySet<BuildingPart>;
  /** Tablet and pictogram parts with their new placement on the porch beam. */
  signs: ReadonlyMap<BuildingPart, BuildingPart>;
}

/** The highest porch beam under the tablet and behind it, spanning its whole width. */
const porchBeam = (tablet: BuildingPart, keep: readonly BuildingPart[]) => keep
  .filter(part => part.shape === "box" && !part.stock && !part.rotation && BEAM_SURFACES.has(part.surface) &&
    part.size[1] <= BEAM_MAX_HEIGHT && part.size[0] >= TABLET_SIZE[0] &&
    part.position[1] - part.size[1] / 2 >= BEAM_MIN_BOTTOM &&
    Math.abs(part.position[0] - tablet.position[0]) <= (part.size[0] - TABLET_SIZE[0]) / 2 &&
    part.position[1] + part.size[1] / 2 <= tablet.position[1] &&
    part.position[2] < tablet.position[2] && tablet.position[2] - part.position[2] < BEAM_MAX_SETBACK)
  .sort((a, b) => b.position[1] - a.position[1])[0];

/** Face-on scale (x, y) only: the painted layers keep their depth spacing, so they never z-fight. */
const faceScale = (axis: number, scale: number) => axis === 2 ? 1 : scale;

/** Scales a sign part across its face about the tablet centre and moves that centre to `centre`. */
const placed = (part: BuildingPart, tablet: BuildingPart, centre: Point3, scale: number): BuildingPart => ({
  ...part,
  position: part.position.map((value, axis) =>
    centre[axis]! + (value - tablet.position[axis]!) * faceScale(axis, scale)) as Point3,
  size: part.size.map((value, axis) => value * faceScale(axis, scale)) as Point3
});

/**
 * Timber nations replace the Roman porch gable the occupation tablet hung on. The tablet and its
 * pictogram become a signboard on the front of the porch tie beam, scaled to the beam's height;
 * without a beam the pictogram is left out instead of floating in the new roof.
 */
export const remountPorchSigns = (keep: readonly BuildingPart[], roofs: readonly RoofEnvelope[]): PorchSigns => {
  const signs = new Map<BuildingPart, BuildingPart>(), dropped = new Set<BuildingPart>();
  for (const tablet of keep.filter(isTablet)) {
    if (!insideRoof(tablet, roofs, getRomanPartBounds(tablet))) continue;
    const pictogram = keep.filter(part => onTablet(part, tablet)), beam = porchBeam(tablet, keep);
    if (!beam) {
      for (const part of pictogram) dropped.add(part);
      continue;
    }
    const scale = Math.min(1, beam.size[1] / TABLET_SIZE[1]);
    const centre: Point3 = [tablet.position[0], beam.position[1],
      beam.position[2] + beam.size[2] / 2 + TABLET_SIZE[2] / 2 + .001];
    for (const part of [tablet, ...pictogram]) signs.set(part, placed(part, tablet, centre, scale));
  }
  return { dropped, signs };
};
