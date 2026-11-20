import { SPECIES } from "../wildlife-species";

/**
 * Winter coat grade of a species (cosmetic season, `visualWinter`): colour saturation kept
 * (0 grey .. 1 summer) and an rgb tint, applied after the coat zones. The zones themselves
 * also change in winter (cervid-coat: duller rump, darker elk neck). Reference markings:
 * - Red deer: the thick winter coat is a dull grey-brown with little contrast between back and
 *   flanks, the rump patch duller buff.
 * - Wapiti (elk): the body coat turns a paler, greyer tan while the shaggy maned neck, head and
 *   legs go dark chocolate; the cream rump patch stays light. Real elk show no prominent dark
 *   dorsal line, so none is added.
 * - Wild rabbit: the winter coat is greyer and a little paler, never white.
 */
export const WINTER_GRADES: Record<number, readonly [saturation: number, r: number, g: number, b: number]> = {
  [SPECIES.rabbit]: [0.55, 1.06, 1.06, 1.08],
  [SPECIES.deer]: [0.42, 0.9, 0.88, 0.88],
  [SPECIES.elk]: [0.5, 1.08, 1.04, 0.98]
};
