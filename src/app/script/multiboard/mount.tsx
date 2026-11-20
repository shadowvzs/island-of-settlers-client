import { createComponentMount } from "../../components/react-island";
import { MultiboardStack } from "./multiboard-stack";

/** Mounter of the board stack: React and the view load with the first visible board. */
export const mountMultiboardStack = createComponentMount(MultiboardStack, {});
