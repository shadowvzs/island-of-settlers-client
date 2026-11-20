import { CylinderGeometry, SphereGeometry } from "three";

import type { CampDecorationKind } from "../../../render-common/adventure/adventure-camp";
import {
  adventureCampStyle, type AdventureCampTheme, type CampTentVariant
} from "../../../render-common/adventure/adventure-camp-style";
import {addCampBarricade} from "./adventure-camp-barricade";
import { createCampGeometryBuilder } from "./adventure-camp-geometry";
import { addCampTent } from "./adventure-camp-tents";

/** Original theme-specific silhouettes share geometry and one palette batch per camp. */
export const createAdventureCampDecoration = (
  kind: CampDecorationKind, detailed: boolean, theme: AdventureCampTheme = "bandit",
  variant: CampTentVariant = "shelter", surfaceDensity = 1
) => {
  const style = adventureCampStyle(theme), builder = createCampGeometryBuilder(detailed, style.wood, surfaceDensity);
  const { add, pole } = builder;
  const iron = [.25, .28, .29] as const;
  if (kind === "tent") addCampTent(builder, style, variant, detailed);
  else if (kind === "palisade") {
    addCampBarricade(builder,style.wood,detailed);
  } else if (kind === "firepit") {
    for (let index = 0; index < (detailed ? 12 : 7); index++) {
      const angle = index * Math.PI * 2 / (detailed ? 12 : 7);
      const stone = new SphereGeometry(.14, detailed ? 7 : 4, detailed ? 5 : 3); stone.scale(1.2, .65, 1);
      add(stone, [.36, .34, .3], Math.cos(angle) * .56, .08, Math.sin(angle) * .56);
    }
    pole([-.35, .12, -.18], [.35, .12, .18], .075, [.09, .06, .035]);
    pole([-.3, .14, .28], [.3, .14, -.28], .065, [.12, .065, .025]);
    if (detailed) for (let index = 0; index < 6; index++)
      add(new SphereGeometry(.065, 5, 3), [.79, .2, .02], (index % 3 - 1) * .14, .075,
        (Math.floor(index / 3) - .5) * .18);
    if (theme === "swamp") for (const x of [-.48, .48]) pole([x, 0, -.35], [x, .7, -.35], .04);
  } else if (kind === "rack") {
    for (const x of [-.7, .7]) pole([x, 0, -.18], [x, 1.25, 0], .075);
    pole([-.8, .9, 0], [.8, .9, 0], .055);
    for (const x of [-.45, 0, .45]) {
      pole([x, .05, .2], [x, 1.65, -.08], .025);
      add(new CylinderGeometry(0, .07, .3, 4), iron, x, 1.8, -.08);
    }
    const shield = new CylinderGeometry(.3, .3, .06, detailed ? 12 : 8); shield.rotateX(Math.PI / 2);
    add(shield, style.accent, .5, .6, .09);
    const boss = new SphereGeometry(.085, detailed ? 6 : 5, detailed ? 3 : 5); boss.scale(1, 1, .45);
    add(boss, iron, .5, .6, .14);
  }
  const geometry = builder.finish();
  geometry.userData.theme = theme; geometry.userData.variant = variant;
  return geometry;
};
