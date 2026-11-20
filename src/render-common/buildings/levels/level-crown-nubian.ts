import type { Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import { addPole, poleTop } from "./level-banner";
import { crownPoint, crownScale, footprintFloor } from "./level-crown-roman";
import { addDormer } from "./level-dormer";
import { mayCarryFlag } from "./level-flag-policy";
import { heightCap, type LevelKit } from "./level-kit";
import { isLeanPiece } from "./level-lean";
import { addLeanToStore } from "./level-lean-to";
import { addOriel } from "./level-oriel";
import { isRoofSpotFree, liftTilesUnder } from "./level-roof-pieces";
import { addSideCanopy } from "./level-wall-pieces";

const OSTRICH_EGG: Point3 = [.92, .9, .82];
const OCHRE: Point3 = [.74, .5, .26];
const PENNANT_GREEN: Point3 = [.12, .42, .26];
/** Cupola at full size: battered drum, painted band, pointed dome and its finial. */
const CUPOLA = { band: .05, dome: .3, drum: .18, finial: .16, radius: .2 } as const;
const CUPOLA_HEIGHT = CUPOLA.drum + CUPOLA.dome + CUPOLA.finial;
/** Merlon cones along a parapet (small enough to give way to the wind catcher). */
const MERLON = .1;
/** Wind catcher (malqaf): a mud tower on the terrace, its open mouth toward the prevailing wind. */
const MALQAF = { height: .42, width: .26 } as const;

/**
 * The malqaf rises from the parapet: tried along the east, then the north parapet, every step; on
 * the level progression (`cameraSide`) along the east from its south end, then the south parapet,
 * so it stands where the usual camera sees it.
 */
const PARAPET_INSET = .11;
const SCAN_STEP = .1;

const parapetSpots = (kit: LevelKit, cameraSide: boolean): Point3[] => {
  const { envelope } = kit.site.roof!, spots: Point3[] = [];
  const east = envelope.max[0] - PARAPET_INSET, north = envelope.min[2] + PARAPET_INSET;
  const south = envelope.max[2] - PARAPET_INSET;
  for (let z = north + .25; z <= envelope.max[2] - .35; z += SCAN_STEP) spots.push([east, 0, z]);
  if (cameraSide) {
    spots.reverse();
    for (let x = east - .25; x >= envelope.min[0] + .35; x -= SCAN_STEP) spots.push([x, 0, south]);
  } else for (let x = east - .25; x >= envelope.min[0] + .35; x -= SCAN_STEP) spots.push([x, 0, north]);
  return spots.flatMap(([x, , z]) => {
    const deck = kit.site.topAt(x, z);
    return deck === null ? [] : [[x, deck, z] as Point3];
  });
};

/** Level 4 on a terrace: a malqaf wind catcher; pitched Nubian roofs take a mud dormer instead. */
export const addNubianRoofPiece = (kit: LevelKit, cameraSide = false) => {
  const roof = kit.site.roof;
  if (!roof) return;
  if (roof.ridgeAxis !== null) {
    addDormer(kit, NUBIAN_DORMER);
    return;
  }
  const fits = (spot: Point3) => {
    const top = Math.min(spot[1] + MALQAF.height, heightCap(kit.site) - .02);
    // The parapet (up to 0.22 over the deck) carries it; merlons under it are taken off.
    return top - spot[1] >= .25 && isRoofSpotFree(kit, [spot[0], (spot[1] + top) / 2, spot[2]],
      [MALQAF.width + .04, top - spot[1], MALQAF.width + .04], spot[1] + .12, MERLON);
  };
  const spot = parapetSpots(kit, cameraSide).find(fits);
  if (!spot) return;
  liftTilesUnder(kit, [spot[0], spot[1] + .3, spot[2]], [MALQAF.width + .04, .3, MALQAF.width + .04], MERLON);
  const top = Math.min(spot[1] + MALQAF.height, heightCap(kit.site) - .02), [x, deck, z] = spot;
  kit.add({ position: [x, (deck + top) / 2 - .02, z], shape: "box", size: [MALQAF.width, top - deck + .04, MALQAF.width],
    stage: 4, surface: "plaster", topScale: [.9, 1, .9] });
  // The mouth faces the camera side; a sloping lid sheds the sand.
  kit.add({ position: [x, top - .1, z + MALQAF.width * .45 + .004], shape: "window-shadow", size: [MALQAF.width * .62, .13, .01],
    stage: 4, surface: "dark" });
  kit.add({ position: [x, top + .02, z], rotation: [-.3, 0, 0], shape: "box", size: [MALQAF.width + .04, .04,
    MALQAF.width + .08], stage: 4, surface: "plaster" });
  if (kit.detailed) for (const side of [-1, 1]) kit.add({ position: [x + side * (MALQAF.width / 2 + .005), top - .2, z],
    shape: "box", size: [.01, .05, MALQAF.width * .8], stage: 4, surface: "paint", tint: OCHRE });
};

/** Gilded cone finial carrying an ostrich egg (the Nubian roof crown). */
const finial = (kit: LevelKit, base: Point3, scale: number) => {
  const [x, y, z] = base, segments = kit.detailed ? 8 : 4;
  kit.add({ position: [x, y + .03 * scale, z], shape: "cone", size: [.06 * scale, .08 * scale, .06 * scale], stage: 4,
    surface: "gold", radialSegments: segments });
  kit.add({ position: [x, y + .1 * scale, z], shape: "sphere", size: [.07 * scale, .09 * scale, .07 * scale], stage: 4,
    surface: "paint", tint: OSTRICH_EGG, radialSegments: segments });
  kit.add({ position: [x, y + .16 * scale, z], shape: "cone", size: [.03 * scale, .06 * scale, .03 * scale], stage: 4,
    surface: "gold", radialSegments: segments });
};

/** Cupola: a battered drum with an ochre band, a pointed mud dome and the egg finial. */
/** `girth` widens the drum and dome in plan only (a wider crown under the same height cap). */
/** Smallest share of the full cupola height that still reads as a crown. */
const MIN_CUPOLA_SCALE = .45;

/** `floor` is where the drum's foot closes down onto the roof (a curved dome or vault under it). */
const cupola = (kit: LevelKit, crown: Point3, girth = 1, floor = crown[1]) => {
  const scale = crownScale(kit, crown[1], CUPOLA_HEIGHT);
  if (scale < MIN_CUPOLA_SCALE) return false;
  const [x, deck, z] = crown, radius = CUPOLA.radius * scale * girth, drum = CUPOLA.drum * scale;
  if (!isRoofSpotFree(kit, [x, deck + CUPOLA_HEIGHT * scale / 2, z], [radius * 2 + .1, CUPOLA_HEIGHT * scale,
    radius * 2 + .1], deck)) return false;
  const segments = kit.detailed ? 16 : 8, foot = floor - .02;
  kit.add({ position: [x, (foot + deck + drum) / 2, z], radialSegments: segments, shape: "cylinder",
    size: [radius * 2, deck + drum - foot, radius * 2], stage: 4, surface: "plaster", topScale: [.9, 1, .9] });
  kit.add({ position: [x, deck + drum * .7, z], radialSegments: segments, shape: "cylinder",
    size: [radius * 1.86 + .01, CUPOLA.band * scale, radius * 1.86 + .01], stage: 4, surface: "paint", tint: OCHRE });
  const dome = CUPOLA.dome * scale;
  kit.add({ position: [x, deck + drum + dome / 2 - .01, z], shape: "ogive-dome", size: [radius * 1.8, dome, radius * 1.8],
    stage: 4, surface: "roof" });
  finial(kit, [x, deck + drum + dome - .02, z], scale);
  return true;
};

/** Terrace points a cupola could stand on: level deck under its whole drum, inside the parapet, nearest first. */
const cupolaSpots = (kit: LevelKit, crown: Point3, girth: number) => {
  const { envelope } = kit.site.roof!, radius = CUPOLA.radius * girth, spots: Point3[] = [];
  const reach = radius + PARAPET_INSET + .05;
  for (let x = envelope.min[0] + reach; x <= envelope.max[0] - reach; x += SCAN_STEP / 2)
    for (let z = envelope.min[2] + reach; z <= envelope.max[2] - reach; z += SCAN_STEP / 2) {
      const deck = kit.site.deckAt(x, z);
      if (deck !== null && isLevelUnder(kit, [x, deck, z], radius)) spots.push([x, deck, z]);
    }
  const distance = (spot: Point3) => Math.hypot(spot[0] - crown[0], spot[2] - crown[2]);
  return spots.sort((a, b) => distance(a) - distance(b));
};

/** True when the deck at the corners of a plan box round `spot` is as high as at its centre. */
const isLevelUnder = (kit: LevelKit, [x, deck, z]: Point3, halfX: number, halfZ = halfX) =>
  [-1, 1].every(dx => [-1, 1].every(dz => {
    const corner = kit.site.deckAt(x + dx * halfX, z + dz * halfZ);
    return corner !== null && Math.abs(corner - deck) < LEVEL_DECK;
  }));

/** Terrace cupola over the roof centre, else on the nearest level terrace spot with room; false without one. */
export const addTerraceCupola = (kit: LevelKit, girth = 1) => {
  const crown = deckCrownPoint(kit);
  if (!crown || kit.site.roof!.ridgeAxis !== null) return false;
  if (cupola(kit, crown, girth)) return true;
  return cupolaSpots(kit, crown, girth).some(spot => cupola(kit, spot, girth));
};

/**
 * Level 5 crown where the terrace has no room for the cupola (the kit's own dome fills it, or the
 * roof is a vault): a lantern cupola standing on the dome's apex or the vault's crown, its drum
 * closing down onto the curved roof under it. False when it does not fit under the height cap.
 */
export const addRoofLantern = (kit: LevelKit) => {
  const crown = crownPoint(kit), spots = [...crown ? [crown] : [], ...roofLineCrowns(kit), ...archCrowns(kit)];
  return LANTERN_GIRTHS.some(girth => spots.some(spot =>
    cupola(kit, spot, girth, footprintFloor(kit, spot, CUPOLA.radius * girth * .7))));
};

/** Plan step and height band of the search for the highest roof line (a barrel vault's crown). */
const VAULT_SAMPLE = { step: .1, band: .02 } as const;

/** Points along the highest roof line, from its middle outward. */
const roofLineCrowns = (kit: LevelKit): Point3[] => {
  const { extentX, extentZ } = kit.site.limit, samples: Point3[] = [];
  for (let x = -extentX; x <= extentX; x += VAULT_SAMPLE.step)
    for (let z = -extentZ; z <= extentZ; z += VAULT_SAMPLE.step) {
      const top = kit.site.topAt(x, z);
      if (top !== null) samples.push([x, top, z]);
    }
  if (!samples.length) return [];
  const highest = Math.max(...samples.map(([, top]) => top));
  const ridge = samples.filter(([, top]) => top >= highest - VAULT_SAMPLE.band);
  const middle = [0, 2].map(axis => ridge.reduce((sum, point) => sum + point[axis]!, 0) / ridge.length);
  const distance = (point: Point3) => Math.hypot(point[0] - middle[0]!, point[2] - middle[1]!);
  return ridge.sort((a, b) => distance(a) - distance(b));
};

/** The crown of a masonry barrel vault (a mine hall), which is no roof covering: its highest arch's middle. */
const archCrowns = (kit: LevelKit): Point3[] => {
  const arches = kit.site.parts.filter(part => part.shape === "stone-arc").map(part => getRomanPartBounds(part));
  if (!arches.length) return [];
  const { max, min } = arches.reduce((best, bounds) => bounds.max[1] > best.max[1] ? bounds : best);
  return [[(min[0] + max[0]) / 2, max[1] - .01, (min[2] + max[2]) / 2]];
};
/** Lantern widths tried: the stock cupola's, then a slimmer one between a small terrace's pinnacles. */
const LANTERN_GIRTHS = [1, .7, .55] as const;

/** The kit's own terrace dome (when the cupola cannot stand there): a finial on its top instead. */
const crownExistingDome = (kit: LevelKit) => {
  const dome = kit.site.parts.filter(part => part.shape === "dome" && part.surface === "roof")
    .sort((a, b) => b.size[0] - a.size[0])[0];
  if (!dome) return;
  const top = dome.position[1] + dome.size[1] / 2;
  if (top + .18 > heightCap(kit.site)) return;
  finial(kit, [dome.position[0], top - .01, dome.position[2]], 1);
  // A painted ring round the dome's foot.
  kit.add({ position: [dome.position[0], dome.position[1] + .03, dome.position[2]], radialSegments: kit.detailed ? 20 : 10,
    shape: "cylinder", size: [dome.size[0] * 1.01, .06, dome.size[2] * 1.01], stage: 4, surface: "paint", tint: OCHRE });
};

/** The terrace (or ridge) point over the roof centre, if the building has a roof. */
const deckCrownPoint = (kit: LevelKit): Point3 | null => {
  const { roof } = kit.site;
  if (!roof) return null;
  const deck = kit.site.deckAt(roof.centre[0], roof.centre[2]);
  return deck === null ? null : [roof.centre[0], deck, roof.centre[2]];
};

/** A green pennant with a palm-fibre tassel on a pole at the parapet corner. */
const pennant = (kit: LevelKit) => {
  const roof = kit.site.roof!, { envelope } = roof;
  const foot: Point3 = [envelope.max[0] - .1, 0, envelope.max[2] - .1];
  const deck = kit.site.topAt(foot[0], foot[2]);
  if (deck === null) return;
  foot[1] = deck;
  const top = poleTop(kit, foot, .55, .3);
  if (top === null) return;
  addPole(kit, foot, top, .028);
  kit.add({ position: [foot[0] - .12, top - .07, foot[2]], rotation: [0, 0, Math.PI / 2], shape: "paint-triangle",
    size: [.12, .24, .001], stage: 4, surface: "paint", tint: PENNANT_GREEN });
  kit.add({ position: [foot[0] - .12, top - .07, foot[2] - .003], rotation: [0, Math.PI, Math.PI / 2],
    shape: "paint-triangle", size: [.12, .24, .001], stage: 4, surface: "paint", tint: PENNANT_GREEN });
  kit.add({ position: [foot[0], top + .03, foot[2]], shape: "sphere", size: [.06, .07, .06], stage: 4,
    surface: "straw", radialSegments: kit.detailed ? 8 : 4 });
};

/** Rooftop shade (arish): plan size, post height and the least height that still shelters a sleeper. */
const SHADE = { depth: .34, height: .4, minimum: .26, post: .045, width: .46 } as const;
const NUBIAN_DORMER = { gable: "plaster", wall: "plaster", window: "lattice" } as const;
/** Terrace deck points within this of each other are one level floor. */
const LEVEL_DECK = .006;

/** Level deck points anywhere on the plot (terraces, tower platforms), camera side (+x, +z) first. */
const shadeSpots = (kit: LevelKit) => {
  const { extentX, extentZ } = kit.site.limit, spots: Point3[] = [];
  const reachX = extentX - SHADE.width / 2 - .05, reachZ = extentZ - SHADE.depth / 2 - .05;
  for (let x = reachX; x >= -reachX; x -= SCAN_STEP) for (let z = reachZ; z >= -reachZ; z -= SCAN_STEP) {
    const deck = kit.site.deckAt(x, z);
    if (deck !== null) spots.push([x, deck, z]);
  }
  return spots.sort((a, b) => b[0] + b[2] - a[0] - a[2]);
};

/** True when the shade's four posts stand on the same level deck as its centre. */
const isLevelDeck = (kit: LevelKit, spot: Point3) => isLevelUnder(kit, spot, SHADE.width / 2, SHADE.depth / 2);

/** The first terrace spot with room for the shade, and its post height under the height cap. */
const findShadeSpot = (kit: LevelKit) => {
  for (const spot of shadeSpots(kit)) {
    const height = Math.min(SHADE.height, heightCap(kit.site) - .04 - spot[1]);
    if (height < SHADE.minimum || !isLevelDeck(kit, spot)) continue;
    const centre: Point3 = [spot[0], spot[1] + height / 2 + .02, spot[2]];
    if (isRoofSpotFree(kit, centre, [SHADE.width + .06, height + .04, SHADE.depth + .06], spot[1]))
      return { height, spot };
  }
  return null;
};

/**
 * Rooftop shade: four palm-trunk posts and two beams carrying a palm-frond roof (High: on rafters)
 * over a woven sleeping mat on the terrace.
 */
export const addRoofShade = (kit: LevelKit) => {
  const found = findShadeSpot(kit);
  if (!found) return false;
  const { height, spot: [x, deck, z] } = found, { depth, post, width } = SHADE, beamY = deck + height - post / 2;
  kit.add({ position: [x, deck + .006, z], shape: "box", size: [width - .1, .012, depth - .1], stage: 4,
    surface: "sacking" });
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) kit.add({ position: [x + dx * (width - post) / 2,
    deck + (height - post) / 2, z + dz * (depth - post) / 2], radialSegments: kit.detailed ? 6 : 4, shape: "cylinder",
  size: [post, height - post + .02, post], stage: 4, surface: "palm-trunk" });
  for (const dz of [-1, 1]) kit.add({ position: [x, beamY, z + dz * (depth - post) / 2], shape: "box",
    size: [width, post, post], stage: 4, surface: "wood" });
  if (kit.detailed) for (const dx of [-1, 0, 1]) kit.add({ position: [x + dx * (width / 2 - .06), beamY + post * .75,
    z], shape: "box", size: [.025, post / 2, depth + .02], stage: 4, surface: "wood" });
  kit.add({ position: [x, deck + height + .025, z], shape: "box", size: [width + .1, .05, depth + .1],
    stage: 4, surface: "straw" });
  return true;
};

/** A second mud dormer, mirrored along the ridge from the level 4 one; false when it has no room. */
const addSecondDormer = (kit: LevelKit) => {
  const before = kit.added.length;
  addDormer(kit, NUBIAN_DORMER, SECOND_DORMER_SHARE);
  return kit.added.length > before;
};
const SECOND_DORMER_SHARE = .35;

/** Civilian level 5 where no cupola fits: a rooftop shade on a level deck, else a second dormer on a pitched roof. */
const addCivilianRoofPiece = (kit: LevelKit) => addRoofShade(kit) ||
  Boolean(kit.site.roof && kit.site.roof.ridgeAxis !== null && addSecondDormer(kit));

/** Real civilian level 5 structures, tried in turn until one has room (the side canopy last). */
const CIVILIAN_STRUCTURES: readonly ((kit: LevelKit) => boolean)[] = [addOriel, addCivilianRoofPiece, addLeanToStore,
  kit => {
    const before = kit.added.length;
    addSideCanopy(kit);
    return kit.added.length > before;
  }];

const addCivilianStructure = (kit: LevelKit) => CIVILIAN_STRUCTURES.some(add => add(kit));

/**
 * Level 5 Nubian crown: a cupola on the terrace (or a finial on its dome). A civilian building
 * without room for the cupola adds a real structure instead: a mashrabiya oriel, a rooftop shade, a
 * second dormer, a palm-frond lean-to store or a side canopy. Military buildings and the HQ (owner
 * 2026-11-09) try the civilian progression's crown too (a terrace cupola, else a lantern on the
 * dome or vault) and then add their pennant.
 */
export const addNubianCrown = (kit: LevelKit) => {
  const crown = deckCrownPoint(kit), military = mayCarryFlag(kit.site.definition.id);
  let domed = crown !== null && cupola(kit, crown);
  if (military && !domed) domed = addTerraceCupola(kit) || addRoofLantern(kit);
  if (crown && !domed) crownExistingDome(kit);
  if (!military) {
    if (!domed) addCivilianStructure(kit);
    return;
  }
  if (crown && !isLeanPiece(kit.site, "banner")) pennant(kit);
};
