import { mountReactIsland } from "../components/react-island";
import { ObservationContent, type ObservationContentProps } from "./observation-content";

/** Mounter for `createLazyReactContent`: the Observe body loads with React on the window's first open. */
export const createObservationMount = (props: ObservationContentProps) => (content: HTMLElement) =>
  mountReactIsland(content, <ObservationContent {...props} />);
