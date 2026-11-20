import { createComponentMount } from "../../components/react-island";
import { SupportPanel } from "./support-panel";

/** Mounter for `createLazyReactContent`: the support window loads with React on its first open. */
export const createSupportMount = () => createComponentMount(SupportPanel, {});
