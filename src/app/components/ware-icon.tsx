import { wareDisplayName } from "../../shared/settlement/ware-names";
import { getWareIconSource } from "../settlement-ui/inventory";

interface WareIconProps {
  title?: string;
  ware: string;
}
/**
 * A ware's rendered 3D icon. Hovering shows the ware's name (owner rule 2026-10-19: every resource icon
 * carries its name as title); `title` overrides it.
 */
export const WareIcon = ({ title, ware }: WareIconProps) => (
  <img
    alt=""
    aria-hidden="true"
    decoding="sync"
    draggable={false}
    src={getWareIconSource(ware)}
    title={title ?? wareDisplayName(ware)}
  />
);
