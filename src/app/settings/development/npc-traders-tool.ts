import { settingsStorage } from "../graphics-settings";
import { createDevelopmentTool } from "./development-tool";
import { DEVELOPMENT_MESSAGES as M } from "./messages";

/** The island simulation's trade switch (journalled command `tradeSetNpcTraders`). */
interface NpcTradersTarget {
  tradeSetNpcTraders: (enabled: boolean) => boolean;
}

/**
 * Development tools > Economy > "NPC traders" (owner 2026-10-19). The choice is a device debug preference
 * (localStorage, like the other debug toggles); the island simulation keeps its own saved switch, set by the
 * journalled command on every change and when an island loads, so recordings and offline catch-up replay it.
 */
export const createNpcTradersTool = (target: () => NpcTradersTarget | undefined) => {
  let enabled = settingsStorage.readNpcTraders();
  const apply = () => { target()?.tradeSetNpcTraders(enabled); };
  const tool = createDevelopmentTool({
    icon: new URL("../../../../assets/ui-icons/actions/market.webp", import.meta.url).href,
    label: M.tool.npcTraders,
    title: M.title.npcTraders,
    onClick: () => {
      enabled = !enabled;
      settingsStorage.writeNpcTraders(enabled);
      tool.update({ active: enabled });
      apply();
    }
  });
  tool.update({ active: enabled });
  return { apply, enabled: () => enabled, tool };
};
