import type { Point3 } from "./building-recipe";
import type { RoofEnvelope } from "./nation-kit-classify";
import { envelopeCenter, envelopeSize, type KitContext } from "./nation-kit-parts";

/** Replace inherited Roman canopy columns with a frame under the true barrel spring-foot lines. */
export const addPersianVaultSupports = (context: KitContext, roof: RoofEnvelope) => {
  const { add } = context, { depth, height, width } = envelopeSize(roof);
  const [x, spring, z] = envelopeCenter(roof), turned = width > depth;
  const across = turned ? depth : width, length = turned ? width : depth;
  const rise = Math.min(Math.max(.25, height * .95), across * .57);
  const beamTop = spring - .06 * rise + .003, beamBottom = beamTop - .08;
  const pier = Math.min(.14, across * .18), cap = pier + .035;
  const rotation: Point3 | undefined = turned ? [0, Math.PI / 2, 0] : undefined;
  const at = (side: number, along: number, y: number, inset: number): Point3 => turned
    ? [x + along, y, z - side * (across / 2 - inset)]
    : [x + side * (across / 2 - inset), y, z + along];
  for (const side of [-1, 1]) {
    add({ position: at(side, 0, beamTop - .04, .045), rotation, shape: "bevel-box",
      size: [.09, .08, length], stage: 2, surface: "plaster" });
    for (const along of [-1, 1].map(sign => sign * Math.max(.08, length / 2 - cap / 2))) {
      const top = beamBottom - .04;
      if (top < .25) continue;
      add({ position: at(side, along, top / 2, cap / 2), rotation, shape: "bevel-box",
        size: [pier, top, pier], stage: 1, surface: "plaster" });
      add({ position: at(side, along, top + .03, cap / 2), rotation, shape: "bevel-box",
        size: [cap, .07, cap], stage: 2, surface: "plaster" });
    }
  }
};
