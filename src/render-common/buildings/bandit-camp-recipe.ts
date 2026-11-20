import { BANDIT_SITE_CODE, banditCampPlan, type BanditSiteRef } from "./bandit-camp-plan";
import { addBanditDefenderHall } from "./bandit-defender-hall";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { type Add,runBetween } from "./nation-kit-parts";
import { enemyBuildingDesign, type EnemyBuildingStyle } from "./themed-neutral-building-style";

type EnemyDesign = ReturnType<typeof enemyBuildingDesign>;
const { banditEncampment: ENCAMPMENT, outlawStronghold: STRONGHOLD, raiderHideout: HIDEOUT } = BANDIT_SITE_CODE;
/** The layout drawn with plain gabled shelters (the third one of every site). */
const GABLED_SHELTER_LAYOUT = 2;
/** The layout whose first lookout carries an awning. */
const AWNING_LOOKOUT_LAYOUT = 1;

const getPerimeterSurface = (citadel: boolean, timber: EnemyDesign["timber"]) => {
  if (citadel) return "stone";
  return timber === "buttress" ? "plaster" : "bark";
};

const getCampWallHeight = (code: number, citadel: boolean) => {
  if (citadel) return 1.6;
  if (code === HIDEOUT) return 0.75;
  return code === ENCAMPMENT ? 1 : 1.2;
};

const getTentWidthLimit = (code: number, citadel: boolean) => {
  if (code === HIDEOUT) return 1.25;
  return citadel ? 2 : 2.6;
};

const getBoothLift = (code: number, citadel: boolean) => {
  if (code !== STRONGHOLD) return 0;
  return citadel ? 0.95 : 0.5;
};

/** Ground x/z of the nautical lifebuoy: tower scaffold, enclosed hall or open stockade. */
const getLifebuoyPosition = (
  plan: ReturnType<typeof banditCampPlan>,
  building: boolean,
  width: number,
  depth: number
): [number, number] => {
  if (plan.kind === "tower") return [-0.32, .37];
  if (building) return [-Math.min(3.4, width - .6) / 2 + .22, plan.door[2] + .09];
  return [-width / 2 + .33, depth / 2 - .6];
};

const getShelterRoofSurface = (design: EnemyDesign): BuildingPart["surface"] => {
  if (design.snow) return "plaster";
  return design.nautical ? "roof-shingles" : "cloth";
};

/** Full compounds in world units: canvas shelters, broken stockades and optional lookout scaffolds. */
export const createBanditCampRecipe = (
  site: BanditSiteRef,
  style: EnemyBuildingStyle,
  detailed: boolean
): BuildingRecipe => {
  const { code, layout } = site;
  const plan = banditCampPlan(site),
    design = enemyBuildingDesign(style);
  const [width, depth] = plan.cells,
    parts: BuildingPart[] = [],
    archerPositions: Point3[] = [];
  const add: Add = (part) => parts.push({ stage: 2, ...part });
  const box = (position: Point3, size: Point3, surface: BuildingPart["surface"], stage = 2, campWallSide?: number) =>
    add({ position, size, surface, shape: detailed ? "bevel-box" : "box", stage, campWallSide });
  const citadel = code === STRONGHOLD && layout === GABLED_SHELTER_LAYOUT;
  const perimeter = getPerimeterSurface(citadel, design.timber);
  const wallHeight = getCampWallHeight(code, citadel);
  const wallZ = depth / 2 - 0.17,
    wallX = width / 2 - 0.17;
  if (plan.kind !== "tower" && style.enclosure === "building")
    addBanditDefenderHall(add, site, style);
  if (plan.kind !== "tower" && style.enclosure !== "building") {
    // The only ground entrance is centred in the front boundary, with a full civilian-width gate.
    for (const side of [-1, 1]) {
      box(
        [side * (width / 4 + 0.2), wallHeight / 2, wallZ],
        [width / 2 - 0.57, wallHeight, 0.13],
        perimeter,
        1, 2
      );
      box([side * wallX, wallHeight / 2, 0], [0.13, wallHeight, depth - 0.34], perimeter, 1, side < 0 ? 3 : 1);
      box([side * 0.43, 0.64, wallZ], [0.1, 1.28, 0.13], "wood", 1, 2);
    }
    box([0, wallHeight / 2, -wallZ], [width - 0.34, wallHeight, 0.13], perimeter, 1, 0);
    box([0, 1.27, wallZ], [0.98, 0.1, 0.15], "wood", 2, 2);
    // Irregular stakes and horizontal lashings break the outline of the stockade at gameplay zoom.
    const stakes = detailed ? Math.max(4, Math.floor(width * 2)) : Math.max(3, Math.floor(width));
    for (let index = 0; index < stakes; index++) {
      const x = -wallX + 0.1 + ((width - 0.54) * index) / (stakes - 1);
      box(
        [x, wallHeight * 0.53, -wallZ],
        [0.055, wallHeight * (1.04 + (index % 3) * 0.08), 0.17],
        "wood",
        1, 0
      );
    }
    const tentWidth = Math.min(width - 0.65, getTentWidthLimit(code, citadel)),
      tentDepth = Math.min(depth - 0.8, code === HIDEOUT ? 0.8 : 2.1);
    const tentZ = code === HIDEOUT ? 0.25 : 0;
    shelter(
      add,
      [code === HIDEOUT ? 0 : width / 6, 0, tentZ],
      [code === ENCAMPMENT ? 1.7 : tentWidth, code === HIDEOUT ? 1.05 : 1.35, code === ENCAMPMENT ? 1.5 : tentDepth],
      style,
      layout,
      detailed
    );
    if (code !== HIDEOUT) {
      const annexX = -(width / 2 - 0.9),
        annexZ = depth / 2 - 1.2;
      shelter(add, [annexX, 0, annexZ], [1.25, 0.85, 1], style, GABLED_SHELTER_LAYOUT, detailed);
      box([width / 2 - 0.65, 0.28, depth / 2 - 1], [0.65, 0.56, 0.75], "planks");
      box([width / 2 - 0.65, 0.58, depth / 2 - 1], [0.7, 0.04, 0.8], "cloth", 3);
      if (code === STRONGHOLD) {
        add({
          position: [-1.25, 0.14, 0.2],
          size: [0.95, 0.28, 0.95],
          shape: "camp-dressing",
          campDecoration: "firepit",
          campTheme: style.theme,
          surface: "paint",
          stage: 3
        });
        add({
          position: [0, 0.65, -depth / 2 + 0.75],
          size: [1.25, 1.3, 0.45],
          shape: "camp-dressing",
          campDecoration: "rack",
          campTheme: style.theme,
          surface: "paint",
          stage: 3
        });
      }
    }
  }
  for (const [index, at] of plan.lookouts.entries()) {
    const [x, y, z] = at,
      half = 0.4;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        add({
          position: [x + sx * 0.32, y / 2, z + sz * 0.32],
          size: [0.1, y, 0.1],
          shape: "cylinder",
          radialSegments: detailed ? 7 : 3,
          surface: "bark",
          stage: 1
        });
        add({
          position: [x + sx * 0.32, 0.07, z + sz * 0.32],
          size: [0.16, 0.14, 0.16],
          shape: "rock",
          surface: "stone",
          stage: 0
        });
      }
    box([x, y - 0.04, z], [0.85, 0.08, 0.85], "planks", 3);
    for (const side of [-1, 1]) {
      box([x + side * half, y + 0.13, z], [0.05, 0.26, 0.85], "wood", 3);
      box([x, y + 0.13, z + side * half], [0.75, 0.26, 0.05], "wood", 3);
      runBetween(
        add,
        [x - 0.32, 0.1, z + side * 0.32],
        [x + 0.32, y - 0.1, z + side * 0.32],
        [0.045, 0.05],
        { shape: "box", surface: "wood" }
      );
    }
    for (const side of [-1, 1]) box([x + side * 0.09, y / 2, z - 0.3], [0.025, y, 0.03], "wood");
    for (let rung = 0.2; rung < y; rung += detailed ? 0.22 : 0.35)
      box([x, rung, z - 0.3], [0.22, 0.025, 0.03], "wood");
    archerPositions.push([x - 0.19, y, z], [x + 0.19, y, z]);
    if (plan.kind === "tower") archerPositions.push([x, y, z - 0.2]);
    // Model-specific awnings sit above the standing archer rather than through its head.
    if (index === 0 && layout === AWNING_LOOKOUT_LAYOUT) {
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          add({
            position: [x + sx * 0.35, y + 0.66, z + sz * 0.35],
            size: [0.045, 1.32, 0.045],
            shape: "box",
            surface: "wood",
            stage: 3
          });
      shelter(add, [x, y + 1.25, z], [0.88, 0.3, 0.88], style, layout, detailed, true);
    }
  }
  // A low firing booth provides actual slit positions on layouts without elevated towers.
  if (plan.kind !== "tower" && style.enclosure !== "building" && (!plan.lookouts.length || code === STRONGHOLD)) {
    const x = width / 2 - 0.55,
      z = code === STRONGHOLD ? 0 : -depth / 2 + 0.45;
    const lift = getBoothLift(code, citadel);
    const boothBox = (
      position: Point3,
      size: Point3,
      surface: BuildingPart["surface"],
      stage = 2
    ) => box([position[0], position[1] + lift, position[2]], size, surface, stage);
    if (lift)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          box(
            [x + sx * 0.24, lift / 2, z + sz * 0.17],
            [0.1, lift, 0.1],
            citadel ? "stone" : "wood",
            1
          );
    boothBox([x, 0.69, z - 0.2], [0.65, 1.38, 0.1], design.walls, 1);
    for (const side of [-1, 1]) {
      boothBox([x + side * 0.275, 0.69, z], [0.1, 1.38, 0.5], design.walls, 1);
      boothBox([x + side * 0.2325, 0.69, z + 0.2], [0.185, 1.38, 0.1], design.walls, 1);
    }
    boothBox([x, 0.4125, z + 0.2], [0.28, 0.825, 0.1], design.walls, 1);
    boothBox([x, 1.2375, z + 0.2], [0.28, 0.285, 0.1], design.walls, 1);
    boothBox([x, 0.17, z], [0.45, 0.06, 0.35], "planks", 1);
    boothBox([x, 0.96, z + 0.257], [0.28, 0.27, 0.012], "dark");
    boothBox([x, 0.81, z + 0.27], [0.4, 0.045, 0.1], "wood");
    boothBox([x, 1.39, z], [0.73, 0.06, 0.58], "planks", 3);
  }
  if (design.nautical) {
    const [x, z] = getLifebuoyPosition(plan, style.enclosure === "building", width, depth);
    add({
      position: [x, 0.4, z],
      size: [0.42, 0.07, 0.42],
      shape: "ring",
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: detailed ? 14 : 6,
      innerRadius: 0.65,
      surface: "rope",
      stage: 3
    });
    box([x, 0.38, z], [0.5, 0.045, 0.07], "wood", 3);
  }
  const visibleParts = parts.filter(part => part.campWallSide === undefined || !style.breachedWalls?.includes(part.campWallSide));
  for (const side of style.breachedWalls ?? []) for (let index = 0; index < 4; index++) {
    const horizontal = side === 0 || side === 2;
    const along = index - 1.5;
    const position: Point3 = horizontal
      ? [along * width / 5, .045, side === 2 ? wallZ : -wallZ]
      : [side === 1 ? wallX : -wallX, .045, along * depth / 5];
    visibleParts.push({ shape: "box", surface: "wood", stage: 1, position,
      size: horizontal ? [.55, .09, .16] : [.16, .09, .55] });
  }
  return {
    parts: visibleParts,
    door: [...plan.door],
    doorProfile: "flat",
    doorDimensions: { width: 0.76, height: 1.2, spring: 1.2 },
    workerExit: [0, 0, plan.door[2] + 0.42],
    workPoint: [0, 0, plan.door[2] + 0.7],
    mechanism: [0, 0, 0],
    archerPositions,
    hideFlag: true,
    hideDoor: plan.kind === "tower" || Boolean(style.breachedWalls?.includes(2))
  };
};

const shelter = (
  add: Add,
  at: Point3,
  size: Point3,
  style: EnemyBuildingStyle,
  layout: number,
  detailed: boolean,
  roofOnly = false
) => {
  const design = enemyBuildingDesign(style),
    [x, y, z] = at,
    [width, height, depth] = size;
  const gabled = layout === GABLED_SHELTER_LAYOUT;
  const profile = gabled ? "gable" : design.profile;
  if (!roofOnly) {
    add({
      position: [x, y + (height + 0.45) / 2, z],
      size: [width, height + 0.45, depth],
      shape: "camp-dressing",
      campDecoration: "tent",
      campTheme: style.theme,
      campTentVariant: gabled ? "shelter" : "command",
      surface: "paint",
      stage: 3
    });
    return;
  }
  add({
    position: [x, y + 0.22, z],
    size: [width, 0.5, depth],
    shape: "occupation-roof",
    occupationRoof: profile,
    surface: getShelterRoofSurface(design),
    stage: 4
  });
};
