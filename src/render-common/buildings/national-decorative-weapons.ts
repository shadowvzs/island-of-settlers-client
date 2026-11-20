import type { WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

type Weapon = "sword" | "spear" | "axe" | "bow" | "club";
const WEAPONS: Readonly<Record<WorkerNation, readonly Weapon[]>> = {
  roman: ["sword", "spear"], viking: ["axe", "axe"], japanese: ["sword", "bow"],
  nubian: ["spear", "bow"], chinese: ["sword", "spear"], persian: ["sword", "bow"],
  maya: ["club", "spear"], indigenous: ["bow", "club"]
};

/** Decorative arms are independent of real sword/axe stock and never imply a production recipe. */
export const decorativeWeaponsFor = (nation: WorkerNation, id: number): readonly Weapon[] => {
  if (id === 14 || id === 40) return [];
  const choices = WEAPONS[nation];
  return id % 2 ? [choices[id % choices.length]!] : choices;
};

/** One small working rack with one or two modeled national arms, authored inside a bounded prop bay. */
export const createDecorativeWeaponRack = (nation: WorkerNation, id: number, centre: Point3,
  detailed: boolean, width = .49, height = .76): BuildingPart[] => {
  const weapons = decorativeWeaponsFor(nation, id);
  if (!weapons.length) return [];
  const parts: BuildingPart[] = [], sx = width / .49, sy = height / .76;
  const add = (shape: BuildingPart["shape"], surface: BuildingPart["surface"], x: number, y: number,
    z: number, w: number, h: number, d: number, angle = 0) => parts.push({
    decorativeRack: id, position: [centre[0] + x * sx, centre[1] + y * sy, centre[2] + z],
    size: [w * sx, h * sy, d], shape, surface, rotation: angle ? [0, 0, angle] : undefined,
    radialSegments: detailed ? 8 : 4, stage: 3
  });
  for (const side of [-1, 1]) add("box", "wood", side * .22, .31, 0, .04, .62, .055);
  for (const y of [.29, .57]) add("box", "wood", 0, y, 0, .49, .04, .055);
  weapons.forEach((weapon, index) => {
    const x = weapons.length === 1 ? 0 : (index - .5) * .22, z = .045;
    if (weapon === "sword") {
      const long = nation === "chinese" || nation === "persian" || nation === "japanese";
      add("box", "steel", x, long ? .39 : .43, z, long ? .032 : .055, long ? .46 : .38, .018);
      add("box", "gold", x, .63, z, nation === "chinese" ? .1 : .085, .024, .035);
      add("box", "wood", x, .68, z, .028, .08, .027);
      add(nation === "persian" ? "ring" : "sphere", "gold", x, .731, z, .042, .035, .035);
      if (detailed) add("box", "steel", x, long ? .39 : .43, z + .01, .008, long ? .43 : .3, .008);
    } else if (weapon === "spear") {
      add("cylinder", "wood", x, .36, z, .018, .69, .018);
      add("cone", nation === "maya" ? "dark" : "steel", x, .72, z, .055, .085, .024);
      if (detailed) add("cylinder", "rope", x, .665, z, .025, .045, .025);
    } else if (weapon === "axe") {
      add("cylinder", "wood", x, .38, z, .026, .65, .026);
      add("box", "iron", x + .04, .65, z, .12, .11, .025, -.12);
      add("box", "steel", x + .095, .645, z, .03, .125, .028, -.12);
      if (detailed) add("cylinder", "rope", x, .58, z, .032, .06, .032);
    } else if (weapon === "club") {
      add("cylinder", "wood", x, .35, z, .032, .61, .032);
      add(nation === "maya" ? "bevel-box" : "sphere", "stone", x, .65, z, .1, .13, .07);
      if (detailed) add("cylinder", "rope", x, .61, z, .044, .1, .044);
    } else {
      const segments = detailed ? 6 : 4;
      for (let segment = 0; segment < segments; segment++) {
        const a = -.5 + segment / segments, b = -.5 + (segment + 1) / segments;
        const ax = .065 * Math.cos(a * Math.PI), bx = .065 * Math.cos(b * Math.PI);
        const ay = .4 + a * .59, by = .4 + b * .59;
        add("box", "wood", x + (ax + bx) / 2, (ay + by) / 2, z,
          .017, Math.hypot(bx - ax, by - ay) + .005, .018, -Math.atan2(bx - ax, by - ay));
      }
      add("box", "rope", x, .4, z, .004, .59, .004);
      add("box", "wood", x + .065, .4, z, .026, .09, .024);
    }
  });
  return parts;
};

/** Only explicitly tagged original decorative rack parts are exchanged; all operational stock is untouched. */
export const withNationDecorativeRacks = (recipe: BuildingRecipe, nation: WorkerNation,
  detailed: boolean): BuildingRecipe => {
  const groups = new Map<number, BuildingPart[]>();
  for (const part of recipe.parts) if (!part.stock && part.decorativeRack !== undefined) {
    const group = groups.get(part.decorativeRack) ?? [];
    group.push(part); groups.set(part.decorativeRack, group);
  }
  if (!groups.size) return recipe;
  const parts = recipe.parts.filter(part => part.stock || part.decorativeRack === undefined);
  for (const [id, group] of groups) {
    const bounds = group.map(part => getRomanPartBounds(part));
    const minX = Math.min(...bounds.map(box => box.min[0])), maxX = Math.max(...bounds.map(box => box.max[0]));
    const minY = Math.min(...bounds.map(box => box.min[1])), maxY = Math.max(...bounds.map(box => box.max[1]));
    const minZ = Math.min(...bounds.map(box => box.min[2]));
    parts.push(...createDecorativeWeaponRack(nation, id, [(minX + maxX) / 2, minY, minZ + .0275],
      detailed, maxX - minX, maxY - minY));
  }
  return { ...recipe, parts };
};
