import { type CargoBox, cargoBoxValues, wareBoxUnits } from "./ship-cargo-boxes";

const manifests = new WeakMap<object, { signature: string; boxes: readonly CargoBox[] }>();
/**
 * Transient visible boxes, never a ledger. Unlimited logistics visitors already show only a full
 * hold: their other real boxes stay out of view rather than overfilling a represented container.
 */
export const cargoPresentation = (cargo: Readonly<Record<string, number>>, visible: number) => {
  const signature = `${visible}|${Object.entries(cargo).map(([ware, count]) => `${ware}:${count}`).join("|")}`;
  const cached = manifests.get(cargo);
  if (cached?.signature === signature) return cached.boxes;
  const boxes = cargoBoxValues(cargo, visible)
    .map(box => ({ ...box, count: Math.min(box.count, wareBoxUnits(box.ware)) }));
  manifests.set(cargo, { signature, boxes });
  return boxes;
};

/** Unloading removes the leading boxes; loading adds them in transfer order. */
export const deckCargoPresentation = (manifest: readonly CargoBox[] | undefined, visible: number, unloading: boolean) => {
  if (!manifest) return [];
  const count = Math.max(0, Math.min(visible, manifest.length));
  return unloading ? manifest.slice(manifest.length - count) : manifest.slice(0, count);
};
