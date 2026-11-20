import { useExternalStore } from "../components/external-store";
import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import { type NationChooserOptions,NationChooserPanel } from "./nation-chooser-panel";

interface Options extends NationChooserOptions { openings:ReadableStore<number> }
const NationChooserMount = ({ openings,...options }:Options) => {
  const opened = useExternalStore(openings);
  return <NationChooserPanel key={opened} {...options} />;
};
export const createNationChooserMount = (options:Options)=>(content:HTMLElement)=>
  mountReactIsland(content,<NationChooserMount {...options} />);
