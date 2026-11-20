import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import {
  CATAPULT_AMMO_KINDS, type CatapultAmmoKind, catapultAmmoProfile
} from "../../../shared/settlement/catapult-ammo-kinds";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { catapultAmmoFacts, signedPercent } from "./catapult-ammo-helpers";

interface CatapultAmmoSectionProps {
  ammo: CatapultAmmoKind;
  uid: number;
  onChange?: (uid: number, kind: CatapultAmmoKind) => boolean;
}
const useAmmoDescription = (ammo: CatapultAmmoKind) => {
  const { i18n } = useLingui();
  const facts = catapultAmmoFacts(ammo), normal = translateMessage(i18n, M.details.catapultAmmo.normal);
  const value = (percent: number) => signedPercent(percent) ?? normal;
  const rangeChange = signedPercent(facts.rangePercent);
  const summary = translateMessage(i18n, M.details.catapultAmmo.summary, {
    damage: value(facts.damagePercent), flight: value(facts.flightPercent), impact: value(facts.impactPercent),
    name: wareDisplayName(ammo), range: rangeChange ? ` (${rangeChange})` : "", tiles: facts.rangeTiles
  });
  const special = facts.special ? translateMessage(i18n, M.details.catapultAmmo[facts.special]) : undefined;
  return { special, summary };
};

/** View-only selector (icons only, names in tooltips); the simulation command validates the choice. */
export const CatapultAmmoSection = ({ ammo, uid, onChange }: CatapultAmmoSectionProps) => {
  const { i18n } = useLingui();
  const description = useAmmoDescription(ammo);
  return (
    <section aria-label={translateMessage(i18n, M.details.catapultAmmo.aria)} className="settlement-ui__catapult-ammo">
      <b>{translateMessage(i18n, M.details.catapultAmmo.title)}</b>
      <div className="settlement-ui__catapult-ammo-choices" role="radiogroup">
        {CATAPULT_AMMO_KINDS.map(kind => {
          const name = wareDisplayName(kind), profile = catapultAmmoProfile(kind);
          const title = translateMessage(i18n, M.details.catapultAmmo.effect, {
            damage: profile.damage, flight: profile.flightTime, impact: profile.impactRadius,
            name, range: profile.range
          });
          return (
            <button
              aria-checked={ammo === kind}
              aria-label={translateMessage(i18n, M.details.catapultAmmo.choose, { name })}
              className="settlement-ui__catapult-ammo-choice"
              data-catapult-ammo={kind}
              disabled={!onChange}
              key={kind}
              role="radio"
              title={title}
              type="button"
              onClick={() => onChange?.(uid, kind)}
            >
              <WareIcon ware={kind} />
            </button>
          );
        })}
      </div>
      <p className="settlement-ui__catapult-ammo-description">
        {description.summary}
        {description.special && <><br />{description.special}</>}
      </p>
    </section>
  );
};
