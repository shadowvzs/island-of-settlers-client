import { mountReactIsland } from "../../components/react-island";
import { EconomyAiPanel } from "./economy-ai-panel";
import { createEconomyAiSession, type EconomyAiSessionOptions } from "./session";

/** Mounts the panel with its live session; the unmount ends the session (probe, timer, map marks). */
export const createEconomyAiPanelMount = (options: EconomyAiSessionOptions) => (content: HTMLElement) => {
  const session = createEconomyAiSession(options);
  const unmount = mountReactIsland(content, <EconomyAiPanel session={session} />);
  return () => {
    unmount();
    session.dispose();
  };
};
