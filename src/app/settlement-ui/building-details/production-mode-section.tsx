import { useLingui } from "@lingui/react";

import { useKeyedStatus } from "../../components/use-command-status";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";
import { OutputRadioChoices } from "./output-radio-choices";
import {
  getOutputRadioChoices, getSawmillRecipeChoices, getSawmillRecipes, getSawmillRefused, isSawmill,
  selectSawmillOutput
} from "./production-mode-helpers";

type CommandResult = boolean | void;

interface OutputSelectProps {
  building: SettlementBuildingSummary;
  choices: NonNullable<ReturnType<typeof getOutputRadioChoices>>;
  onSelect: (ware: string) => CommandResult;
}
/** Refused commands retain the authoritative selection and explain the refusal. */
const OutputSelect = ({ building, choices, onSelect }: OutputSelectProps) => {
  const { i18n } = useLingui();
  const { setStatus, status } = useKeyedStatus(`${building.id}:${building.selectedOutput}`);
  const select = (output: string) => {
    if (onSelect(output) === false) setStatus(i18n._(M.details.production.outputRefused));
  };
  return (
    <section className="settlement-ui__production-mode settlement-ui__output-choices" data-building-uid={building.id}>
      <h3>{i18n._(M.details.production.chooseOutput)}</h3>
      <OutputRadioChoices choices={choices} onSelect={select} />
      {status && <p role="status">{status}</p>}
    </section>
  );
};

interface SawmillRecipesProps {
  building: SettlementBuildingSummary;
  onSawmillMode?: (mode: "planks" | "handcart") => CommandResult;
  onSelect: (ware: string) => CommandResult;
}
const SawmillRecipes = ({ building, onSawmillMode, onSelect }: SawmillRecipesProps) => {
  const { i18n } = useLingui();
  const recipes = getSawmillRecipes(building, i18n);
  const { setStatus, status } = useKeyedStatus(`${building.id}:${building.selectedOutput}:${building.sawmillMode}`);
  const select = (output: string) => {
    if (selectSawmillOutput(output, onSelect, onSawmillMode) === false)
      setStatus(getSawmillRefused(i18n));
  };
  return (
    <section className="settlement-ui__production-mode settlement-ui__sawmill-recipes" data-building-uid={building.id}>
      <h3>{i18n._(M.details.production.chooseOutput)}</h3>
      <OutputRadioChoices
        choices={getSawmillRecipeChoices(building, recipes, Boolean(onSawmillMode), i18n)}
        onSelect={select}
      />
      <SawmillStatus input={recipes.input} refusal={status} text={recipes.status} />
    </section>
  );
};

interface SawmillStatusProps {
  input: string;
  refusal: string;
  text: string;
}
const SawmillStatus = ({ input, refusal, text }: SawmillStatusProps) => {
  if (refusal) return <p role="status">{refusal}</p>;
  return (
    <p role="status">
      <WareIcon ware={input} />
      {text}
    </p>
  );
};

interface ProductionModeSectionProps {
  building: SettlementBuildingSummary;
  onSawmillMode?: SawmillRecipesProps["onSawmillMode"];
  onSelect: (ware: string) => CommandResult;
}
/** A real per-building choice for multi-output workshops: the sawmill recipes or an output select. */
export const ProductionModeSection = ({ building, onSawmillMode, onSelect }: ProductionModeSectionProps) => {
  const { i18n } = useLingui();
  if (isSawmill(building)) return <SawmillRecipes building={building} onSawmillMode={onSawmillMode} onSelect={onSelect} />;
  const choices = getOutputRadioChoices(building, i18n);
  if (!choices) return null;
  return <OutputSelect building={building} choices={choices} onSelect={onSelect} />;
};
