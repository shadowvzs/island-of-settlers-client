import { getPeachProductionAtlasSources } from "./peach-production-assets";
import { loadPeachProductionResources } from "./peach-production-resources";
import { createFloweringPeachProductionModel, type PeachProductionTier } from "./peach-tree-production-model";

/** Atomic atlas owner shared by the three forms and all runtime tiers in one map/quality. */
export const createPeachProductionTemplates = (detailed: boolean,
  load = () => loadPeachProductionResources(getPeachProductionAtlasSources(detailed), detailed)) => {
  let pending: ReturnType<typeof load> | undefined;
  let resources: Awaited<ReturnType<typeof load>> | undefined;
  let users = 0;
  const release = () => {
    if (--users) return;
    resources?.dispose(); resources = undefined; pending = undefined;
  };
  const create = async (variant: number, tier: PeachProductionTier, active = () => true) => {
    users++;
    try {
      pending ??= load().then(owner => { resources = owner; return owner; });
      const owner = await pending;
      if (!active()) { release(); return undefined; }
      const model = createFloweringPeachProductionModel(owner.materialsForVariant(variant), detailed,
        variant, tier, owner.templates);
      let disposed = false;
      return { ...model, dispose: () => {
        if (disposed) return;
        disposed = true; model.dispose(); release();
      } };
    } catch (error) { release(); throw error; }
  };
  return { create, statistics: () => ({ users, ready: Boolean(resources), pending: Boolean(pending && !resources) }) };
};
