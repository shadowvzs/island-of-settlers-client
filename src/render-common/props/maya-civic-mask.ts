import { addMayaCarving, mayaCarvingRectangle } from "./maya-relief-carving";
import { MeshBuilder, type VertexStyle } from "./mesh-builder";

type Point = readonly [number, number];
const stoneGold: VertexStyle = { flutter: 0, color: ([x, y, z], normal) => {
  const grain = Math.sin(x * 191 + y * 97) * Math.sin(y * 173 - x * 31);
  const cavity = .88 + Math.max(0, normal[2]) * .09 + grain * .022;
  const patina = z < -.12 ? .78 : 1;
  return [cavity * patina, cavity * patina, cavity * patina];
} };
const recess: VertexStyle = { flutter: 0, color: () => [.25, .26, .21] };

/** Original architectural mask: stepped diadem, chiselled lids, long nose and stone ear spools. */
export const createMayaCivicMask = (detailed: boolean, compact=false) => {
  const builder = new MeshBuilder();
  const carve = (points: readonly Point[], front: number, bevel = .012, style = stoneGold, back = -.32) =>
    addMayaCarving(builder, points, front, back, compact&&!detailed?0:bevel, style,compact);
  const rectangle = (x: number, y: number, width: number, height: number, front: number, bevel = .01,
    style = stoneGold, back = -.32) => carve(mayaCarvingRectangle(x, y, width, height), front, bevel, style, back);
  // The square plaque is continuous and backed; the sculpted face is bonded directly into it.
  rectangle(0, 0, 1, 1, -.30, .014, stoneGold, -.5);
  carve([[-.30, -.30], [-.24, -.39], [.24, -.39], [.30, -.30], [.31, .15],
    [.20, .26], [-.20, .26], [-.31, .15]], -.13, .027);
  rectangle(0, -.345, .44, .065, -.035, .009);
  // Three stepped crown levels have a broad cornice and a central maize-like crest.
  rectangle(0, .285, .66, .075, .005, .009);
  rectangle(0, .35, .48, .07, -.015, .008);
  rectangle(0, .414, .27, .065, .025, .008);
  rectangle(0, .445, .12, .045, .07, .007);
  for (const side of [-1, 1]) {
    const mirror = (points: readonly Point[]): Point[] => {
      const result = points.map(([x, y]): Point => [x * side, y]);
      return side < 0 ? result.reverse() : result;
    };
    // Faceted cheek bones leave an actual recessed eye cavity between cheek and brow.
    carve(mirror([[.075, -.15], [.265, -.20], [.31, -.10], [.295, .005], [.11, -.015]]), .005, .025);
    carve(mirror([[.07, .10], [.10, .175], [.245, .19], [.30, .145], [.275, .095], [.15, .12]]), .13, .013);
    carve(mirror([[.095, .055], [.165, .025], [.265, .055], [.20, .095], [.125, .09]]), -.105, .005, recess);
    carve(mirror([[.10, .026], [.175, .008], [.27, .035], [.265, .055], [.165, .035]]), -.015, .006);
    carve(mirror([[.155, .05], [.177, .039], [.191, .061], [.17, .08]]), -.065, .004);
    rectangle(side * .30, .225, .065, .055, .035, .007);
    // Hollow ear-spool rims consist of individual bevelled stone segments, with a recessed centre.
    let segments=8;
    if(detailed)segments=12;
    else if(compact)segments=5;
    const cx = side * .39, cy = -.035;
    for (let index = 0; index < segments; index++) {
      const a = index / segments * Math.PI * 2, b = (index + 1) / segments * Math.PI * 2;
      carve([[cx + Math.cos(a) * .055, cy + Math.sin(a) * .088],
        [cx + Math.cos(a) * .095, cy + Math.sin(a) * .138],
        [cx + Math.cos(b) * .095, cy + Math.sin(b) * .138],
        [cx + Math.cos(b) * .055, cy + Math.sin(b) * .088]], .015, .006);
    }
    rectangle(cx, -.22, .075, .075, -.025, .009);
    rectangle(side * .205, -.27, .05, .09, .065, .008);
  }
  // A long angular nose has a raised ridge and a broad carved tip, rather than a smooth human blob.
  carve([[-.052, -.10], [.052, -.10], [.065, .18], [0, .24], [-.065, .18]], .28, .024);
  carve([[-.095, -.155], [0, -.19], [.095, -.155], [.075, -.07], [-.075, -.07]], .47, .018);
  rectangle(0, -.235, .26, .055, -.105, .004, recess);
  carve([[-.17, -.22], [0, -.19], [.17, -.22], [.145, -.18], [0, -.145], [-.145, -.18]], .075, .008);
  rectangle(0, -.285, .27, .038, .015, .006);
  if (detailed) for (const x of [-.18, -.09, 0, .09, .18]) {
    rectangle(x, .284, .035, .035, .035, .004);
    rectangle(x * .7, -.347, .025, .025, -.005, .003);
  }
  const mesh = builder.finish({ flex: 0 }); mesh.wind.fill(0);
  return mesh;
};
