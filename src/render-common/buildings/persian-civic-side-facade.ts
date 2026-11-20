import { srgbToLinear } from "../color";
import type { Add } from "./nation-kit-parts";
import { addPersianDiamondLattice, addPersianPointedArch } from "./persian-arched-facade";

const COBALT = srgbToLinear(.14, .35, .58);

/** A real perforated three-bay wall replaces the solid long wing side; interior backing stays architectural. */
export const addPersianCivicSideFacade = (add: Add, side: number, detailed: boolean) => {
  const yaw = side * Math.PI / 2, originX = side * 3.62, originZ = -.35;
  const local: Add = part => add({ ...part, rotation: [part.rotation?.[0] ?? 0,
    yaw + (part.rotation?.[1] ?? 0), part.rotation?.[2] ?? 0],
  position: [originX + part.position[0] * Math.cos(yaw) + part.position[2] * Math.sin(yaw),
    part.position[1], originZ - part.position[0] * Math.sin(yaw) + part.position[2] * Math.cos(yaw)] });
  const base = .65, spring = .60, rise = .90, top = 2.65, bay = 1.9, opening = 1.12;
  local({ position: [0, base / 2, 0], shape: "box", size: [5.7, base, .26], stage: 1, surface: "plaster" });
  for (const x of [-bay, 0, bay]) {
    const shoulder = (bay - opening) / 2;
    for (const direction of [-1, 1]) local({ position: [x + direction * (opening / 2 + shoulder / 2),
      base + spring / 2, 0], shape: "box", size: [shoulder, spring, .26], stage: 1, surface: "plaster" });
    local({ position: [x, (base + spring + top) / 2, 0], shape: "persian-arch-spandrel",
      pointedArchOpening: [opening / bay, rise / (top - base - spring)],
      size: [bay, top - base - spring, .26], stage: 2, surface: "plaster" });
    addPersianPointedArch(part => local({ ...part, compactGeometry: true }), x, base, .13,
      opening, spring, rise, .07, .20, false);
    addPersianDiamondLattice(local, x, base, .035, opening, spring, rise, detailed, .19);
    local({ position: [x, base, .11], shape: "bevel-box", compactGeometry: true,
      size: [opening + .20, .065, .35], stage: 2, surface: "cut-stone", tint: [.93, .84, .67] });
  }
  for (const x of [-2.77, -.95, .95, 2.77]) {
    local({ position: [x, 1.30, .18], shape: "bevel-box", compactGeometry: true,
      size: [.18, 2.6, .17], stage: 2, surface: "plaster" });
    local({ position: [x, 2.60, .18], shape: "bevel-box", compactGeometry: true,
      size: [.28, .10, .23], stage: 3, surface: "plaster" });
  }
  for (const y of [.35, 2.51]) local({ position: [0, y, .137], shape: "box",
    size: [5.67, .045, .018], stage: 2, surface: "paint", tint: COBALT });
};
