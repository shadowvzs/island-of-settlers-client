import { PERSIAN_LATEEN_SAIL, persianLateenUV } from "../../../render-common/ships/persian-lateen-layout";
import type { SailPainting } from "./ship-nation-sails";

/** Original woven borders stay readable over the shared linen relief in both detail levels. */
const seams = (c: CanvasRenderingContext2D, count: number) => {
  c.fillStyle = "rgba(95,65,33,.2)";
  for (let index = 1; index < count; index++) c.fillRect(index / count - .0014, 0, .0028, 1);
};
const border = (c: CanvasRenderingContext2D, color: string) => {
  c.strokeStyle = color; c.lineWidth = .025; c.strokeRect(.035, .035, .93, .93);
};
const paintedEmblem = (c: CanvasRenderingContext2D, image: CanvasImageSource | undefined,
  cloth: CanvasImageSource | undefined, bounds: readonly [number, number, number, number]) => {
  if (!image) return;
  c.save(); c.globalCompositeOperation = "source-over"; c.globalAlpha = .94;
  c.drawImage(image, ...bounds);
  if (cloth) { c.globalCompositeOperation = "multiply"; c.globalAlpha = .28; c.drawImage(cloth, 0, 0, 1, 1); }
  c.restore();
};
const chinese: SailPainting = c => {
  c.fillStyle = "#ba5030"; c.fillRect(0, 0, 1, 1); seams(c, 9);
  c.strokeStyle = "#743e2a"; c.lineWidth = .008; c.strokeRect(.012, .012, .976, .976);
  // Slightly different weathering in the sewn panels; the real dark bamboo battens are modeled separately.
  for (let panel = 0; panel < 8; panel++) {
    c.fillStyle = panel % 2 ? "rgba(230,139,74,.10)" : "rgba(105,39,24,.08)";
    c.fillRect(.02, panel / 8 + .01, .96, .105);
  }
};
const persian: SailPainting = (c, artwork) => {
  c.fillStyle = "#ecdfc1"; c.fillRect(0, 0, 1, 1); seams(c, 10);
  const corners = [PERSIAN_LATEEN_SAIL.peak, PERSIAN_LATEEN_SAIL.tack, PERSIAN_LATEEN_SAIL.clew]
    .map(point => { const [u, v] = persianLateenUV(point); return [u, 1 - v] as const; });
  for (const [inset, color, width] of [[.025, "#2d536f", .014], [.055, "#ae7b40", .005]] as const) {
    c.beginPath(); c.strokeStyle = color; c.lineWidth = width; c.lineJoin = "round";
    corners.forEach(([x, y], index) => {
      const px = x + (.639 - x) * inset, py = y + (.656 - y) * inset;
      if (index) c.lineTo(px, py); else c.moveTo(px, py);
    });
    c.closePath(); c.stroke();
  }
  // The phoenix sits in the broad lower-aft cloth with Cartesian UVs, not a pinched barycentric image.
  paintedEmblem(c, artwork.persianPhoenix, artwork.cloth, [.48, .43, .45, .55]);
};
const maya: SailPainting = (c, artwork) => {
  c.fillStyle = "#eee3c7"; c.fillRect(0, 0, 1, 1); seams(c, 9);
  c.fillStyle = "#af6b3a"; c.fillRect(.025, .045, .95, .014); c.fillRect(.025, .945, .95, .014);
  paintedEmblem(c, artwork.mayaSun, artwork.cloth, [.15, .08, .70, .84]);
};
const indigenous: SailPainting = (c, artwork) => {
  c.fillStyle = "#e6d7b7"; c.fillRect(0, 0, 1, 1); seams(c, 7);
  paintedEmblem(c, artwork.bison, artwork.cloth, [.195, .065, .61, .865]);
  border(c, "#9c633d");
};
export const EXPANSION_SHIP_CLOTH = {
  chineseCloth: chinese, persianCloth: persian, mayaCloth: maya, indigenousCloth: indigenous
} as const;
