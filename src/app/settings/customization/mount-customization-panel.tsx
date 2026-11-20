import { mountReactIsland } from "../../components/react-island";
import { type CustomizationOptions,CustomizationPanel } from "./customization-panel";

/** Mounter for `createLazyReactContent`: React loads with the first opening of the window. */
export const createCustomizationMount = (options: CustomizationOptions) => (content: HTMLElement) =>
  mountReactIsland(content, <CustomizationPanel {...options} />);
