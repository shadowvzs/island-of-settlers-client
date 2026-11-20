import { mountReactIsland } from "../../components/react-island";
import { SettingsSections, type SettingsSectionsProps } from "./settings-sections";

/** Mounter for `createLazyReactContent`: the sections load with React on the panel's first open. */
export const createSettingsSectionsMount = (props: SettingsSectionsProps) => (content: HTMLElement) =>
  mountReactIsland(content, <SettingsSections {...props} />);
