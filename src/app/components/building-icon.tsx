import { banditSiteKey, type BanditSiteRef } from "../../render-common/buildings/bandit-camp-plan";
import { getSettlementBuildingIconSource } from "../settlement-ui/building-icons";
import { SettlementIcon } from "./settlement-icon";

interface BuildingIconProps {
  bandit?: BanditSiteRef;
  enclosure?: "building";
  theme?: string;
  type: number;
}
/**
 * A building thumbnail in the selected nation (`data-building-icon` lets a nation change swap it, as
 * `setSettlementBuildingIconNation` does for every such image) or a bandit site; the build icon when no thumbnail exists.
 */
export const BuildingIcon = ({ bandit, enclosure, theme, type }: BuildingIconProps) => {
  const source = getSettlementBuildingIconSource(type, bandit, theme, enclosure);
  if (!source) return <SettlementIcon name="build" />;
  return (
    <img
      alt=""
      data-bandit-site={bandit && banditSiteKey(bandit)}
      data-building-icon={type}
      decoding="sync"
      draggable={false}
      loading="lazy"
      src={source}
    />
  );
};
