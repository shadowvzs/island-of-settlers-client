import { packBits, packFog, packSparseCells } from "../../src/shared/settlement/save-cell-codecs";
import { FOG } from "../../src/shared/world/world-data";

/**
 * Converts version 3 saves to version 4 (research 12, S04): every game save and settlement save
 * found anywhere in the JSON. `progress.fog` and `permanentVisible` become packed,
 * `settlement.occupied` sparse cells, and both versions 4.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

const permanentSight = (progress: Json) => {
  const cells = progress.permanentVisible as number[] | undefined;
  const fog = progress.fog as number[];
  if (!cells) return undefined;
  const flags = new Uint8Array(fog.length);
  for (const cell of cells) flags[cell] = FOG.visible;
  return packBits(flags, FOG.visible);
};

const convertProgress = (progress: Json) => {
  const { permanentVisible: _permanentVisible, ...rest } = progress;
  return { ...rest, fog: packFog(progress.fog as number[]), permanentSight: permanentSight(progress) };
};

const convertSettlement = (settlement: Json): Json => ({
  ...settlement, occupied: packSparseCells(settlement.occupied as number[]), version: 4
});

export const convertSaveToV4 = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(convertSaveToV4);
  if (!isObject(node)) return node;
  const converted = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, convertSaveToV4(value)]));
  if (node.format === "island-settlers-game" && node.version === 3) {
    return { ...converted, progress: convertProgress(node.progress as Json), version: 4 };
  }
  if (node.format === "island-settlers-settlement" && node.version === 3) {
    return convertSettlement({ ...converted, occupied: node.occupied });
  }
  return converted;
};
