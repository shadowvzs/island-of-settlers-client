import type { Point3 } from "../building-recipe";
import { type LevelKit, ridgeHalfLength, roofHalves, slopePoint } from "./level-kit";
import { hasOwnChimney } from "./level-occupation";
import { addSmallGableRoof, fitTop, isRoofSpotFree, ridgeAxisOf } from "./level-roof-pieces";

/** Along the ridge from the roof centre (share of its half length), clear of a central crown. */
const CHIMNEY_ALONG = .5;
const STACK = .2;

/** Roman: an ashlar stack rising from the back slope past the ridge, with a capping slab. */
const romanStack = (kit: LevelKit) => {
  const roof = kit.site.roof!, along = roofHalves(kit.site).along * CHIMNEY_ALONG;
  const foot = slopePoint(kit.site, along, -1, .4);
  if (!foot) return;
  const bottom = foot[1] - .14, top = fitTop(kit, roof.top + .16, foot[1] + .22);
  if (top === null || !isRoofSpotFree(kit, [foot[0], (bottom + top) / 2, foot[2]], [STACK, top - bottom, STACK], foot[1]))
    return;
  kit.add({ position: [foot[0], (bottom + top) / 2, foot[2]], shape: "box", size: [STACK, top - bottom, STACK],
    stage: 2, surface: "stone" });
  kit.add({ position: [foot[0], top + .025, foot[2]], shape: "bevel-box", size: [.27, .05, .27], stage: 3,
    surface: "cut-stone" });
  if (kit.detailed) kit.add({ position: [foot[0], top + .052, foot[2]], shape: "window-shadow", size: [.12, .006, .12],
    stage: 3, surface: "dark", windowShadowDecorative: true });
};

/** On the ridge: a drum (louver or vent) under a little roof of its own. */
const ridgeVent = (kit: LevelKit, drum: { surface: "planks" | "wood"; height: number; width: number }) => {
  const roof = kit.site.roof!, axis = ridgeAxisOf(kit), along = ridgeHalfLength(kit.site) * CHIMNEY_ALONG;
  const centre: Point3 = [...roof.centre];
  centre[axis] += along;
  const ridge = kit.site.topAt(centre[0], centre[2]);
  if (ridge === null) return;
  const bottom = ridge - .08, eave = bottom + drum.height;
  if (fitTop(kit, eave + .16, eave + .16) === null ||
    !isRoofSpotFree(kit, [centre[0], eave, centre[2]], [drum.width + .1, drum.height + .2, drum.width + .1], ridge))
    return;
  kit.add({ position: [centre[0], bottom + drum.height / 2, centre[2]], shape: "box",
    size: [drum.width, drum.height, drum.width], stage: 3, surface: drum.surface });
  // Smoke slots on the two long faces.
  for (const side of [-1, 1]) {
    const slot: Point3 = [centre[0], bottom + drum.height * .62, centre[2]];
    slot[axis === 0 ? 2 : 0] += side * (drum.width / 2 + .003);
    kit.add({ position: slot, shape: "window-shadow", size: axis === 0 ? [drum.width * .6, .05, .01] : [.01, .05, drum.width * .6],
      stage: 3, surface: "dark", windowShadowDecorative: true });
  }
  addSmallGableRoof(kit, [centre[0], 0, centre[2]], axis, { eave, length: drum.width + .12, width: drum.width });
};

/** Nubian: a battered mud flue on the terrace's back corner. */
const mudFlue = (kit: LevelKit) => {
  const roof = kit.site.roof!, { envelope } = roof;
  const x = envelope.max[0] - .3, z = envelope.min[2] + .3, deck = kit.site.topAt(x, z);
  if (deck === null) return;
  const top = fitTop(kit, deck + .45, deck + .25);
  if (top === null || !isRoofSpotFree(kit, [x, (deck + top) / 2, z], [.2, top - deck, .2], deck)) return;
  kit.add({ position: [x, (deck + top) / 2 - .02, z], shape: "box", size: [.2, top - deck + .04, .2], stage: 3,
    surface: "plaster", topScale: [.72, 1, .72] });
  kit.add({ position: [x, top - .05, z + .074], shape: "window-shadow", size: [.08, .06, .01], stage: 3, surface: "dark",
    windowShadowDecorative: true });
};

/** Level 3 chimney in the nation's own form (furnace trades and homes already have theirs). */
export const addLevelChimney = (kit: LevelKit) => {
  const roof = kit.site.roof;
  if (!roof || hasOwnChimney(kit.site.definition)) return;
  const { nation } = kit.site;
  if (roof.ridgeAxis === null) {
    if (nation === "nubian") mudFlue(kit);
    return;
  }
  if (nation === "roman") romanStack(kit);
  else if (nation === "viking") ridgeVent(kit, { height: .16, surface: "planks", width: .24 });
  else if (nation === "japanese") ridgeVent(kit, { height: .1, surface: "wood", width: .2 });
  else mudFlue(kit);
};
