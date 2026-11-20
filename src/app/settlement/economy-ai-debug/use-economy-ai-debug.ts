import { useState } from "react";

import { useExternalStore } from "../../components/external-store";
import type { EconomyAiSession } from "./session";

/** The "why" panel's subscriptions: the polled state, the map-mark switch and the faction shown. */
export const useEconomyAiDebug = (session: Pick<EconomyAiSession, "marksShown" | "state">) => {
  const { clock, factions } = useExternalStore(session.state);
  const marksShown = useExternalStore(session.marksShown);
  const [chosen, setChosen] = useState<number>();
  const selected = factions.find(view => view.faction === chosen) ?? factions[0];
  return {
    clock,
    factions: factions.map(({ faction, title }) => ({ faction, pressed: faction === selected?.faction, title })),
    marksShown,
    /** More than one faction: the panel shows the faction switch. */
    switchable: factions.length > 1,
    selected,
    onMarksChange: session.marksShown.set,
    onSelect: setChosen
  };
};
