import type { ExternalStore } from "../components/external-store";
import { SettlementIcon } from "../components/settlement-icon";
import { useMinimapHeader } from "./use-minimap-header";

const TERRITORY_LABEL = "Show occupied territory";

interface MinimapHeaderProps {
  territory: ExternalStore<boolean>;
  /** The standalone editor has no player territory; the toggle would do nothing there. */
  showTerritory?: boolean;
}
/** Minimap title and territory toggle, inside the DOM header that is the drag handle. */
export const MinimapHeader = ({ showTerritory = true, territory }: MinimapHeaderProps) => {
  const { shown, onToggle } = useMinimapHeader(territory);
  return (
    <>
      <strong>Minimap</strong>
      {showTerritory && (
        <button
          aria-label={TERRITORY_LABEL}
          aria-pressed={shown}
          className="minimap__territory-toggle"
          title={TERRITORY_LABEL}
          type="button"
          onClick={onToggle}
        >
          <SettlementIcon name="territory" />
        </button>
      )}
    </>
  );
};
