import { EXPANSION_SHIP_CLOTH } from "./expansion-ship-cloth";
import type { ShipSailArtwork } from "./ship-sail-artwork";

/**
 * Original sail paintings of the Viking, Japanese and Nubian ships, drawn (multiplied) over the sewn
 * linen bitmap in unit canvas space: x across the sail, y down from the top of the texture.
 */
export type SailPainting = (c: CanvasRenderingContext2D, artwork: ShipSailArtwork) => void;

/**
 * Square sail woven in narrow red and cream cloths: plain vertical stripes with their seams, no
 * diagonal lattice (owner 2026-10-13), and a leather-bound head and foot.
 */
const vikingSail: SailPainting = c => {
  const cloths = 10;
  c.fillStyle = "#a3271d";
  for (let cloth = 0; cloth < cloths; cloth += 2) c.fillRect(cloth / cloths, 0, 1 / cloths, 1);
  c.fillStyle = "rgba(70, 44, 30, .35)";
  for (let seam = 1; seam < cloths; seam++) c.fillRect(seam / cloths - .0015, 0, .003, 1);
  c.fillStyle = "#4a2a1c"; c.fillRect(0, 0, 1, .025); c.fillRect(0, .975, 1, .025);
};

/**
 * The coiled dragon printed on the cloth (owner 2026-10-13, after the dragon-7 reference): the
 * illustration over the linen, the weave multiplied back over it so it reads as dyed cloth, then the
 * vertical seams and the battens' shadows across it.
 */
const japaneseSail: SailPainting = (c, { cloth, dragon }) => {
  c.save();
  if (dragon) {
    c.globalCompositeOperation = "source-over"; c.globalAlpha = .96; c.drawImage(dragon, .015, .02, .97, .96);
  }
  c.globalCompositeOperation = "multiply";
  if (cloth) { c.globalAlpha = .55; c.drawImage(cloth, 0, 0, 1, 1); }
  c.globalAlpha = 1;
  c.fillStyle = "rgba(120, 96, 60, .35)";
  for (let seam = 1; seam < 8; seam++) c.fillRect(seam / 8 - .002, 0, .004, 1);
  c.fillStyle = "rgba(60, 46, 30, .3)";
  for (let batten = 1; batten < 6; batten++) c.fillRect(0, batten / 6 - .006, 1, .012);
  c.restore();
};

/**
 * Lateen sail (x along the yard; the canvas foot is the yard, its head the clew): cloths radiating to
 * the clew, an indigo band along the yard and ochre and indigo bands above the clew.
 */
const nubianSail: SailPainting = c => {
  c.fillStyle = "rgba(130, 100, 60, .3)";
  for (let seam = 1; seam < 10; seam++) c.fillRect(seam / 10 - .002, 0, .004, 1);
  c.fillStyle = "#2c3f73"; c.fillRect(0, .94, 1, .06); c.fillRect(0, .32, 1, .04);
  c.fillStyle = "#c27a2c"; c.fillRect(0, .38, 1, .08);
};

export const NATION_SAIL_PAINTINGS = {
  ...EXPANSION_SHIP_CLOTH,
  japaneseCloth: japaneseSail, nubianCloth: nubianSail, vikingCloth: vikingSail
} as const satisfies Record<string, SailPainting>;
