import type { CatalogVersionWarning as Warning } from "./helpers";
import { useCatalogVersionWarning } from "./use-catalog-version-warning";

import "./catalog-version-warning.css";

interface CatalogVersionWarningProps {
  warning: Warning | null;
}

/** Warning panel on top of the editor when the loaded map was authored with another content catalog. */
export const CatalogVersionWarning = ({ warning }: CatalogVersionWarningProps) => {
  const view = useCatalogVersionWarning(warning);
  if (!view) return null;
  return (
    <section aria-label={view.title} className="map-editor__catalog-warning" role="alert">
      <strong>{view.title}</strong>
      <p>{view.body}</p>
      <button className="map-editor__catalog-warning-dismiss" type="button" onClick={view.onDismiss}>
        {view.dismiss}
      </button>
    </section>
  );
};
