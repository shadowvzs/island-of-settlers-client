import { Box3, type Group, type MeshStandardMaterial, Vector3 } from "three";

import type { BuildingRecipe,BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { isIndigenousGraniteQuarry } from "../../../render-common/buildings/indigenous-quarry-bearing";
import { getRomanWareStockSlots, isCanonicalRomanWareStock, romanWareStockPlacement } from "../../../render-common/buildings/roman-ware-stock";
import { createWareRecipe } from "../../../render-common/wares/ware-recipe";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { createWareModel, mergeWareShapeMeshes } from "../settlement/ware-models";
import { createRomanWaterStock } from "./roman-water-stock";

const canonicalBounds = new Map<string, Box3>();

/** Slots own one current ware mesh, including mixed tool/ore output, rather than permanent proxies. */
export const createRomanWareStockModels = (
  parent: Group, recipe: BuildingRecipe, scale: number, detailed: boolean,
  materials: Record<BuildingSurface, MeshStandardMaterial>, nation: WorkerNation = "roman",
  stockReference: BuildingRecipe = recipe
) => {
  const referenceSlots = getRomanWareStockSlots(stockReference, scale);
  // Keep the authored LOD's display count and aliases; share only its physical transforms.
  const slots = getRomanWareStockSlots(recipe).filter(slot => isCanonicalRomanWareStock(slot.stock) &&
    !slot.parts.some(part => part.shape === "catapult-rock")).map(slot => {
    const reference = referenceSlots.find(candidate => candidate.stock.slot === slot.stock.slot &&
      (candidate.stock.kind ?? "output") === (slot.stock.kind ?? "output") && candidate.stock.ware === slot.stock.ware);
    return reference ? { ...reference, stock: slot.stock } : slot;
  });
  const residents = slots.map(slot => ({ slot, ware: "", model: undefined as ReturnType<typeof createWareModel> | undefined }));
  const choose = (slot: typeof slots[number], inventory: Record<string, number> | undefined) => {
    if (!inventory) {
      const capacity = slot.stock.ware === "fish" && slot.stock.kind !== "input" ? 9 : 6;
      return slot.stock.slot < capacity ? slot.stock.ware : undefined;
    }
    let index = slot.stock.slot;
    for (const ware of slot.stock.wares ?? [slot.stock.ware]) {
      const count = Math.max(0, inventory[ware] ?? 0);
      if (index < count) return ware;
      index -= count;
    }
    return undefined;
  };
  const replace = (resident: typeof residents[number], ware: string) => {
    resident.model?.dispose();
    const compact = ware === "water" ? undefined : createWareRecipe(ware, detailed, true, ware === "grain" && recipe.parts.some(part=>part.shape === "pig-residents") ? .35 : 1);
    if(compact && ware === "grain" && recipe.parts.some(part=>part.shape === "pig-residents"))
      for(const part of compact.parts) if(part.shape === "cord") part.shape="box";
    if(detailed && compact && ware === "pig" && recipe.parts.some(part=>part.shape === "pig-residents"))
      for(const part of compact.parts) if(part.surface === "dark") part.shape="box";
    const model = ware === "water" ? createRomanWaterStock(materials, detailed, recipe.parts.some(part=>part.shape === "pig-residents"), nation)
      : createWareModel(ware, detailed, materials, "stock", compact);
    const key = `${ware}:${detailed}`;
    let reference = canonicalBounds.get(key);
    if (!reference) {
      const canonical = createWareModel(ware, detailed, materials);
      canonical.root.updateMatrixWorld(true); reference = new Box3().setFromObject(canonical.root);
      canonicalBounds.set(key, reference); canonical.dispose();
    }
    // Compact individual stems retain the same physical bale envelope as the carried bundle.
    if (compact) {
      model.root.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(model.root), size = bounds.getSize(new Vector3());
      const target = reference.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
      const shape = model.root.getObjectByName("ware_geometry")!;
      shape.scale.copy(target.divide(size));
      shape.position.copy(reference.getCenter(new Vector3()).sub(center.multiply(shape.scale)));
    }
    mergeWareShapeMeshes(model.root);
    const placement = romanWareStockPlacement(resident.slot, ware, scale);
    model.root.position.set(...placement.position); model.root.rotation.y = placement.yaw;
    model.root.scale.setScalar(ware === "water" ? 1 / scale : placement.ratio);
    if (ware === "granite" && isIndigenousGraniteQuarry(recipe)) {
      // The irregular rock primitive is inset from its analytic recipe box. Seat its actual
      // lowest vertex on the authored rack, rather than leaving air beneath the displayed goods.
      model.root.updateMatrixWorld(true);
      const actual = new Box3().setFromObject(model.root);
      model.root.position.y += resident.slot.bottom - actual.min.y;
    }
    model.root.name = `stock_${resident.slot.stock.kind ?? "output"}_${resident.slot.stock.slot}_${ware}`;
    model.root.traverse(object => {
      object.userData.stock = { ...resident.slot.stock, ware, wares: undefined };
      object.userData.canonicalStock = true;
    });
    parent.add(model.root); resident.model = model; resident.ware = ware;
  };
  const update = (input: Record<string, number> | undefined, output: Record<string, number> | undefined) => {
    for (const resident of residents) {
      const inventory = resident.slot.stock.kind === "input" ? input : output;
      const ware = choose(resident.slot, inventory);
      if (ware && resident.ware !== ware) replace(resident, ware);
      if (resident.model) {
        resident.model.root.visible = Boolean(ware);
        resident.model.root.traverse(object => { object.visible = Boolean(ware); });
      }
    }
  };
  update(undefined, undefined);
  const dispose = () => { for (const resident of residents) resident.model?.dispose(); };
  return { update, dispose };
};
