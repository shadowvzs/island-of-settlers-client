import { mountReactIsland } from "../../components/react-island";
import { SettlementHud } from "./settlement-hud";
import type { SettlementHudProps } from "./types";

/** Mounts the settlement HUD's React root into its host in `.settlement-ui`; returns its unmount. */
export const mountSettlementHud = (props: SettlementHudProps) =>
  mountReactIsland(props.hosts.hud, <SettlementHud {...props} />);
