import { IconButton } from "../../components/icon-button";
import type { ShipTroopView } from "./troop-panel";
import type { ShipTroopAction } from "./troop-types";

interface ShipTroopSectionProps {
  view: ShipTroopView;
  onAction: (action: ShipTroopAction) => void;
}

/** Troops aboard, boarding and landing, with the context actions valid on this map (military controls §9.3). */
export const ShipTroopSection = ({ view, onAction }: ShipTroopSectionProps) => (
  <section aria-label={view.heading} data-ship-troops="">
    <h3>{view.heading}</h3>
    {view.lines.map(line => <p key={line}>{line}</p>)}
    {view.hint && <p data-ship-troop-hint="">{view.hint}</p>}
    <div className="settlement-ui__building-actions">
      {view.buttons.map(button => (
        <IconButton
          caption={button.caption}
          data={{ "data-ship-troop-action": button.action }}
          icon={button.icon}
          key={button.action}
          label={button.label}
          pressed={button.pressed}
          title={button.title}
          onClick={() => onAction(button.action)}
        />
      ))}
    </div>
  </section>
);
