import clothIcon from "../../../assets/ware-icons/cloth.png?url";
import flaxIcon from "../../../assets/ware-icons/flax.png?url";
import spyglassIcon from "../../../assets/ware-icons/spyglass.png?url";
import teaLeafIcon from "../../../assets/ware-icons/teaLeaves.png?url";
import type { WorkerNation } from "../workers/worker-unit";

/** New textile producers use their actual output art in both menus and road signs. */
export const productionBuildingIconSource = (type: number,nation?:WorkerNation): string | undefined => {
  if(type===6&&nation==="chinese")return teaLeafIcon;
  if (type === 14) return spyglassIcon;
  if (type === 60) return flaxIcon;
  if (type === 61) return clothIcon;
  return undefined;
};
