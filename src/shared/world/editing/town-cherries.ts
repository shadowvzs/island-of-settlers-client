import { sinHash2 } from "../noise";
import { BROADLEAF, encodeTreeForm, getFormCompetition } from "../tree-forms";
import { PROP, type WorldData } from "../world-data";

/** Broadleaf trees within this many cells of the town centre may blossom as cherries. */
export const TOWN_CHERRY_RADIUS = 30;
/** Share of those trees that are cherries: highest at the centre, fading towards the edge. */
const CHERRY_SHARE = .6;


/**
 * On a Japanese island, broadleaf trees near the town centre become blossoming cherries
 * (owner decision 2026-10-12); other nations keep oaks. Only the broadleaf form byte changes:
 * gameplay sees the same tree kind, wood and felling.
 */
export const plantTownCherries = (world: WorldData, nation: string, centre = world.start) => {
  if (nation !== "japanese") return 0;
  const { props } = world;
  let planted = 0;
  for (let index = 0; index < props.count; index++) {
    if (props.types[index] !== PROP.broadleafTree) continue;
    const distance = Math.hypot(props.x[index]! - centre.x, props.z[index]! - centre.z);
    if (distance > TOWN_CHERRY_RADIUS) continue;
    const share = CHERRY_SHARE * (1 - .5 * distance / TOWN_CHERRY_RADIUS);
    // Deterministic per tree position, so a reload or a revisit plants the same cherries.
    if (sinHash2(props.x[index]!, props.z[index]!) >= share) continue;
    props.form[index] = encodeTreeForm(BROADLEAF.cherry, getFormCompetition(props.form[index]!));
    planted++;
  }
  return planted;
};
