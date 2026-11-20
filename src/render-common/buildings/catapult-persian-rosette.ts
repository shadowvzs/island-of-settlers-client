import type { BuildingPart, Point3 } from "./building-recipe";

type Add = (part: Omit<BuildingPart, "stage">) => unknown;

/** Original carved floral roundel, informed by Persian floral/beaded stucco, not a copied museum image. */
export const addPersianCatapultRosette = (add: Add, centre: Point3, detailed: boolean) => {
  const relief = (x: number, y: number, z: number, size: Point3, surface: BuildingPart["surface"],
    shape: BuildingPart["shape"], rotation?: Point3, tint?: Point3, radialSegments?: number) =>
    add({ position: [centre[0] + x, centre[1] + y, centre[2] + z], size, surface, shape, rotation, tint,
      radialSegments, compactGeometry: true, catapultWallOrnament: true });
  relief(0, 0, 0, [.34, .025, .34], "paint", "cylinder", [Math.PI / 2, 0, 0], [.035, .20, .43], detailed ? 24 : 8);
  relief(0, 0, .008, [.35, .012, .35], "paint", "ring", [Math.PI / 2, 0, 0], [.72, .57, .31], detailed ? 24 : 7);
  for (let petal = 0; petal < 8; petal++) {
    const angle = petal * Math.PI / 4, x = Math.sin(angle), y = Math.cos(angle);
    relief(x * .075, y * .075, .022, [.047, .105, .018], "plaster", "sphere", [0, 0, -angle]);
    relief(x * .079, y * .079, .029, [.004, .060, .004], "paint", "box", [0, 0, -angle], [.72, .57, .31]);
  }
  const beads = detailed ? 16 : 8;
  for (let bead = 0; bead < beads; bead++) {
    const angle = bead * Math.PI * 2 / beads;
    relief(Math.sin(angle) * .151, Math.cos(angle) * .151, .019, [.012, .012, .010], "plaster", "sphere");
  }
  relief(0, 0, .028, [.053, .014, .053], "paint", "cylinder", [Math.PI / 2, 0, 0], [.72, .57, .31], detailed ? 12 : 4);
};
