import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { translateMessage } from "../../../shared/i18n/translate";
import { materialBuildingGroup } from "../../../shared/settlement/advanced-material-production";
import { nationDrinkChain } from "../../../shared/settlement/nation-drinks";
import { SETTLEMENT_MESSAGES as M } from "../messages";

const editor = import.meta.glob<string>("../../../../assets/editor-icons/*", {
  eager: true, import: "default", query: "?url"
});
const resources = import.meta.glob<string>("../../../../assets/resource-previews/*.png", {
  eager: true, import: "default", query: "?url"
});

const preview = (file: string, label: string) => {
  const source = editor[`../../../../assets/editor-icons/${file}`] ?? resources[`../../../../assets/resource-previews/${file}`];
  return source ? { label, source } : null;
};

/** Context only: these source images never add stored goods, demand or quantities. */
export const getProductionResourceInput = (
  type: number, nation: WorkerNation = "roman", i18n?: I18n
) => {
  const label = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  const material = materialBuildingGroup(type);
  if (material?.quarry === type) return preview(`${material.stone}-deposit.png`, label(M.details.production.deposit));
  if (type === 19) return preview("doodad-large-stone@2x.webp", label(M.details.production.deposit));
  if (type === 20 || material?.forester === type)
    return preview("tree-sapling@2x.webp", label(M.details.production.seedlings));
  if (material?.woodcutter === type)
    return preview(`tree-${material.tree.replace("Tree", "")}@2x.webp`, label(M.details.production.trees));
  if (type === 17) return preview("tree-oak@2x.webp", label(M.details.production.trees));
  if (type === 18) return preview("fish.png", label(M.details.production.fishingGround));
  if (type === 22) return preview("animal-deer@2x.webp", label(M.details.production.wildlife));
  if (type === 35) return preview("relief-lake@2x.webp", label(M.details.production.waterSource));
  if (type === 37) return preview("wheat.png", label(M.details.production.wheatField));
  if (type !== 5) return null;
  const labels = {
    hive: M.details.production.beehive, palm: M.details.production.palmTree,
    rice: M.details.production.ricePlants, vine: M.details.production.vinePlant,
    tea: M.details.production.teaBush, pomegranate: M.details.production.pomegranateTree,
    cacao: M.details.production.cacaoTree, berries: M.details.production.berryBush
  };
  const { plantation } = nationDrinkChain(nation);
  if (plantation === "palm") return preview("tree-palm@2x.webp", label(labels.palm));
  return preview(`${plantation}.png`, label(labels[plantation]));
};
