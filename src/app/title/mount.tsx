import { mountReactIsland } from "../components/react-island";
import { TitlePage, type TitlePageProps } from "./title-page";

/** The title page's lazy chunk: React mounts it into its own host above the loading scene. */
export const mountTitlePage = (host: HTMLElement, props: TitlePageProps) =>
  mountReactIsland(host, <TitlePage {...props} />);
