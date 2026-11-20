import { SettlementIcon } from "../components/settlement-icon";
import { WareIcon } from "../components/ware-icon";
import type { ArtImage as ArtImageData } from "./art-helpers";

interface ArtImageProps {
  art: ArtImageData;
}
/** Renders `ArtImage` data: a ware icon (rendered PNG or drawn SVG), a settlement icon or a decorative image. */
export const ArtImage = ({ art }: ArtImageProps) => {
  if (art.kind === "ware") return <WareIcon ware={art.ware} />;
  if (art.kind === "icon") return <SettlementIcon name={art.name} />;
  return <img alt="" className={art.className} draggable={false} src={art.source} />;
};
