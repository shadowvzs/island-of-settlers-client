import {
  banditByMilitaryBuilding, banditEntry, banditMilitaryBuildingCode, type BanditSiteRef
} from "@shared/catalog";

import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "./building-recipe";

export type { BanditSiteRef } from "@shared/catalog";
export interface BanditCampPlan {
  name: string;
  tier: "Medium" | "Hard" | "Very hard";
  cells: readonly [number, number];
  capacity: number;
  kind: "camp" | "tower" | "stronghold";
  lookouts: readonly Point3[];
  door: Point3;
}
/** Layouts per bandit site (the widest `bandit.models` list); the plan cache index is `code * stride + layout`. */
const LAYOUT_STRIDE = 8;
/** The `bandit:` catalog codes by key, for rules and art that single out one site. */
export const BANDIT_SITE_CODE = { banditEncampment: 1, outlawStronghold: 2, raiderHideout: 0 } as const;

const plans: BanditCampPlan[] = [];
const siteRefs: BanditSiteRef[] = [];
/** The shared, frozen reference of one site layout (saves, map files and render frames store its two fields). */
export const banditSiteRef = (code: number, layout: number): BanditSiteRef =>
  siteRefs[code * LAYOUT_STRIDE + layout] ??= Object.freeze({ code, layout });
/** The open archer scaffold: the first layout of `bandit:banditEncampment`. */
export const ARCHER_SCAFFOLD_SITE = banditSiteRef(BANDIT_SITE_CODE.banditEncampment, 0);
export const sameBanditSite = (first?: BanditSiteRef, second?: BanditSiteRef) =>
  first?.code === second?.code && first?.layout === second?.layout;
/** One text key per site layout (render and cache keys). */
export const banditSiteKey = (site: BanditSiteRef) => `${site.code}:${site.layout}`;
/** The building type whose military rules the site borrows; a site's run-time `typeId`. */
export const banditMilitaryTypeId = (site: BanditSiteRef) => {
  const typeId = banditMilitaryBuildingCode(site.code);
  if (typeId === undefined) throw new Error("Unknown bandit site");
  return typeId;
};
/**
 * The site that borrows this military building type (colony fort plans pick the military strength first); the
 * layout cycles through the site's layouts with `layoutSeed`.
 */
export const banditSiteOfMilitaryType = (typeId: number, layoutSeed: number) => {
  const site = banditByMilitaryBuilding(typeId);
  if (!site) throw new Error("No bandit site borrows this building type");
  return banditSiteRef(site.code, layoutSeed % site.bandit.models.length);
};

export const isOpenArcherTower = (building: { bandit?: BanditSiteRef }) =>
  building.bandit !== undefined &&
  banditEntry(building.bandit.code)?.bandit.models[building.bandit.layout]?.kind === "tower";

export const banditSiteName = (site: BanditSiteRef, enclosure?: "building") => {
  const plan = banditCampPlan(site);
  if (!enclosure || plan.kind === "tower") return plan.name;
  return banditEntry(site.code)!.text.variants!.enclosure!.en;
};
const createBanditCampPlan = ({ code, layout: layoutIndex }: BanditSiteRef): BanditCampPlan => {
  const site = banditEntry(code);
  const layout = site?.bandit.models[layoutIndex];
  if (!site || !layout) throw new Error("Unknown bandit site layout");
  const [width, depth] = layout.cells;
  const tower = layout.kind === "tower";
  // The stronghold's first layout keeps its second lookout on the gate side.
  const gateSideLookout = code === BANDIT_SITE_CODE.outlawStronghold && layoutIndex === 0;
  const corners: Point3[] = [
    [-width / 2 + 0.65, 1.65, -depth / 2 + 0.65],
    [width / 2 - 0.65, 1.85, gateSideLookout ? depth / 2 - 0.75 : -depth / 2 + 0.65],
    [width / 2 - 0.65, 1.5, depth / 2 - 0.75]
  ];
  const texts = site.text;
  return {
    cells: layout.cells,
    capacity: layout.capacity ?? site.bandit.capacity,
    kind: layout.kind,
    name: tower ? texts.variants!.tower!.en : texts.name.en,
    tier: site.bandit.tier,
    door: [-0.38, 0, depth / 2 - 0.12],
    lookouts: tower ? [[0, 2.6, 0]] : corners.slice(0, layout.lookouts)
  };
};
/** Version-one saved camp layouts, independent of the four nations' military recipes. */
export const banditCampPlan = (site: BanditSiteRef): BanditCampPlan =>
  plans[site.code * LAYOUT_STRIDE + site.layout] ??= createBanditCampPlan(site);

/** Exact world-space gate and access anchors for new, saved compounds. */
export const placedBanditCamp = (
  site: BanditSiteRef,
  x: number,
  z: number,
  turns = 0
) => {
  const plan = banditCampPlan(site),
    angle = (turns * Math.PI) / 2;
  const point = (localX: number, localZ: number) => ({
    x: x + localX * DMath.cos(angle) + localZ * DMath.sin(angle),
    z: z - localX * DMath.sin(angle) + localZ * DMath.cos(angle)
  });
  return {
    width: plan.cells[turns % 2 ? 1 : 0],
    depth: plan.cells[turns % 2 ? 0 : 1],
    doorThreshold: point(0, plan.door[2]),
    workerApproach: point(0, plan.door[2] + 0.42),
    access: point(0, plan.cells[1] / 2 + 0.5)
  };
};

/** Visible defender-hall walls, shared by the mesh recipe and melee contact checks. */
export const banditDefenderHallSize = (site: BanditSiteRef) => {
  const plan = banditCampPlan(site);
  const width = Math.min(3.4, plan.cells[0] - 0.6);
  const depth = Math.max(0.8, Math.min(3.5, plan.cells[1] - (plan.lookouts.length ? 1.3 : 0.45)));
  return { width, depth, front: plan.door[2] };
};
