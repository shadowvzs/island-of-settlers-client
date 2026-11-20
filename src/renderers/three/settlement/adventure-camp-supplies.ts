import { CylinderGeometry, LatheGeometry, TorusGeometry, Vector2 } from "three";

import type { AdventureCampStyle } from "../../../render-common/adventure/adventure-camp-style";
import type { CampGeometryBuilder } from "./adventure-camp-geometry";

/** Shelved camp provisions are scenery only, placed inside the already reserved tent envelope. */
export const addCampSupplies = (
  builder: CampGeometryBuilder, style: AdventureCampStyle,
  width: number, depth: number, floor: number, detailed: boolean
) => {
  const left = -width * .27, rear = -depth * .26;
  builder.box([.52, .42, .48], [left, floor + .21, rear]);
  for (const x of [-.22, .22]) {
    builder.box([.045, .45, .52], [left + x, floor + .23, rear], style.trim);
    builder.box([.045, .025, .48], [left + x, floor + .44, rear], style.wood);
  }
  const right = width * .27;
  const barrel = detailed ? new LatheGeometry([new Vector2(.2, 0), new Vector2(.25, .12),
    new Vector2(.27, .27), new Vector2(.25, .43), new Vector2(.21, .54)], 16)
    : new CylinderGeometry(.21, .23, .54, 8).translate(0, .27, 0);
  builder.add(barrel, style.wood, right, floor, rear);
  builder.add(new CylinderGeometry(.21, .21, .025, detailed ? 16 : 8), style.trim,
    right, floor + .54, rear);
  if (detailed) for (const height of [.13, .42]) {
    const hoop = new TorusGeometry(.255, .017, 4, 16); hoop.rotateX(Math.PI / 2);
    builder.add(hoop, [.18, .2, .22], right, floor + height, rear);
  }
};
