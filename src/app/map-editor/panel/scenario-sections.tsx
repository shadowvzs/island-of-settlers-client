import { GARRISON_CAPACITIES } from "../../../shared/balance/military";
import { useMapRewardsShown } from "../map-rules/use-map-rules";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import type { ScenarioEditor } from "../scenario-editor";
import { PEACEFUL_HOME_NOTE } from "../scenario-enemy-policy";
import {
  BUILDING_APPEARANCES, ENEMY_BUILDINGS, GROUP_FACINGS, GROUP_FORMATIONS, SCENARIO_KINDS, SCENARIO_NATIONS,
  SCENARIO_OBJECTIVES, SCENARIO_THEMES, TROOPS
} from "../scenario-form-controls";
import { GARRISON_MODES, GARRISON_ROWS } from "../scenario-garrison-controls";
import {
  SCENARIO_SELECTION_LABELS, type ScenarioSelectionScope, type ScenarioSelectionView
} from "../scenario-selection-controls";
import { type FieldOption, toTextOptions } from "../section-store";
import {
  ActionButton, ActionRow, AuthoringControls, ChoiceField, EditorSection, ListSelect, NumberField, TextValue
} from "./fields";
import { CatapultInspector } from "./scenario-catapult-inspector";
import { useSection } from "./use-section";

const garrisonModeOption = (option: FieldOption): FieldOption => {
  if (option.value === GARRISON_MODES[0])
    return { ...option, label: M.option.garrisonMode.shieldDefenders };
  return { ...option, label: M.option.garrisonMode.authoredComposition };
};
const GARRISON_MODE_OPTIONS = toTextOptions(GARRISON_MODES).map(garrisonModeOption);

interface SelectionControlsProps {
  editor: ScenarioEditor;
  scope: ScenarioSelectionScope;
  view: ScenarioSelectionView;
}
/** The tab's authored objects: list, select / move on the map, rotate, remove. */
const SelectionControls = ({ editor, scope, view }: SelectionControlsProps) => {
  const labels = SCENARIO_SELECTION_LABELS[scope];
  return (
    <AuthoringControls>
      <ListSelect label={labels.list} options={view.options} value={view.selected}
        onChange={id => editor.select(scope, id)} />
      <ActionRow>
        <ActionButton caption={M.captions.select} label={labels.select} onClick={() => editor.activate("select", scope)} />
        <ActionButton caption={M.captions.move} disabled={view.moveDisabled} label={labels.move}
          onClick={() => editor.activate("move", scope)} />
        <ActionButton caption={M.captions.rotate} disabled={view.rotateDisabled} label={labels.rotate}
          onClick={() => editor.rotate(scope)} />
        <ActionButton caption={M.captions.remove} disabled={view.removeDisabled} label={labels.remove}
          onClick={() => editor.remove(scope)} />
      </ActionRow>
    </AuthoringControls>
  );
};

interface MapRewardFieldsProps {
  editor: ScenarioEditor;
}
/** Reward coins and claim/expiry times: shown only in the home-island mode (owner Q2). */
const MapRewardFields = ({ editor }: MapRewardFieldsProps) => {
  const { field } = useSection(editor.mapSection);
  return (
    <>
      <NumberField {...field("reward")} label={M.fields.rewardCoins} max={100000} min={0} />
      <NumberField {...field("claim")} label={M.fields.claimSeconds} max={31536000} min={0} size="long" />
      <NumberField {...field("expiry")} label={M.fields.expirySeconds} max={31536000} min={0} size="long" />
    </>
  );
};

interface ScenarioMapSectionProps {
  editor: ScenarioEditor;
}
/** The authored scenario: kind, nation, rewards, HQ / landing, validation and Play (start setup: Map rules). */
export const ScenarioMapSection = ({ editor }: ScenarioMapSectionProps) => {
  const { field, view } = useSection(editor.mapSection);
  const isHome = view.kind === "home";
  const rewardsShown = useMapRewardsShown(view.kind);
  return (
    <EditorSection title={M.sections.authoredScenario}>
      <AuthoringControls>
        <ChoiceField {...field("kind")} label={M.fields.scenario} options={SCENARIO_KINDS} onChange={editor.setKind} />
        <ChoiceField {...field("nation")} label={M.fields.startNation} options={SCENARIO_NATIONS}
          onChange={editor.setNation} />
        <ChoiceField {...field("theme")} hidden={isHome} label={M.fields.enemyTheme} options={SCENARIO_THEMES}
          onChange={editor.setTheme} />
        <NumberField {...field("hqRotation")} label={M.fields.hqRotation} max={3} min={0} size="narrow"
          onBlur={editor.commitRotation} onChange={editor.setRotationText} />
        {!isHome && (
          <>
            <ChoiceField {...field("objective")} label={M.fields.victoryObjective} options={SCENARIO_OBJECTIVES} />
            {rewardsShown && <MapRewardFields editor={editor} />}
          </>
        )}
        <ActionRow>
          {!isHome && <ActionButton caption={M.captions.applyRules} label={M.actions.applyRules}
            onClick={editor.applyRules} />}
          <ActionButton caption={M.captions.placeHq} label={M.actions.placeHq}
            onClick={() => editor.activate("hq")} />
          {!isHome && <ActionButton caption={M.captions.placeLanding} label={M.actions.placeLanding}
            onClick={() => editor.activate("landing")} />}
        </ActionRow>
      </AuthoringControls>
      <SelectionControls editor={editor} scope="map" view={view} />
      <ActionRow>
        <ActionButton caption={M.captions.validate} label={M.actions.validateBeforePlay}
          onClick={editor.validate} />
        <ActionButton caption={M.captions.play} label={M.actions.playMap} onClick={editor.play} />
      </ActionRow>
    </EditorSection>
  );
};

interface GarrisonControlsProps {
  editor: ScenarioEditor;
}
/** Troop counts per type and rank of a camp or military building (authored composition). */
const GarrisonControls = ({ editor }: GarrisonControlsProps) => {
  const { field, view } = useSection(editor.garrison.section);
  const { view: enemy } = useSection(editor.unitsSection);
  const catapult = enemy.building.endsWith("-catapult");
  let capacity = 12;
  if (catapult) capacity = GARRISON_CAPACITIES[16] ?? 0;
  return (
    <details>
      <summary><TextValue value={view.summary} /></summary>
      <AuthoringControls>
        <ChoiceField {...field("mode")} label={M.fields.garrisonMode} options={GARRISON_MODE_OPTIONS} />
        {GARRISON_ROWS.filter(row => !catapult || row.type !== "archer").map(row => (
          <NumberField {...field(row.name)} key={row.name} label={row.label} max={capacity} min={0}
            size="narrow" />
        ))}
      </AuthoringControls>
    </details>
  );
};

interface EditorProps {
  editor: ScenarioEditor;
}
/** The scenario kind (shared with the Map tab): enemies need an adventure or colony scenario. */
const EnemyScenarioKind = ({ editor }: EditorProps) => {
  const { field } = useSection(editor.mapSection);
  return <ChoiceField {...field("kind")} label={M.fields.scenario} options={SCENARIO_KINDS} onChange={editor.setKind} />;
};

interface EnemyAuthoringProps {
  blocked: boolean;
  editor: ScenarioEditor;
}
/** The useful empty state on a peaceful home, or the full enemy form on an adventure/colony. */
const EnemyAuthoring = ({ blocked, editor }: EnemyAuthoringProps) => {
  const { field, view } = useSection(editor.unitsSection);
  const catapultFieldsHidden = !view.building.endsWith("-catapult");
  if (blocked) {
    return (
      <div className="map-editor__empty-state">
        <p className="map-editor__note"><TextValue value={PEACEFUL_HOME_NOTE} /></p>
        <ActionButton caption={M.captions.switchToAdventure} label={M.actions.switchToAdventure}
          onClick={() => editor.setKind("adventure")} />
      </div>
    );
  }
  return (
    <>
      <NumberField {...field("unitRotation")} label={M.fields.rotation} max={3} min={0} size="narrow"
        onBlur={editor.commitRotation} onChange={editor.setRotationText} />
      <NumberField {...field("faction")} label={M.fields.enemyFaction} max={16} min={1} size="narrow" />
      <NumberField {...field("rank")} label={M.fields.unitRank} max={2} min={0} size="narrow" />
      <NumberField {...field("group")} label={M.fields.groupId} max={1000} min={0} size="narrow" />
      <NumberField {...field("count")} label={M.fields.groupCount} max={32} min={1} size="narrow" />
      <NumberField {...field("spacing")} label={M.fields.groupSpacing} max={4} min={1} size="narrow" />
      <ChoiceField {...field("formation")} label={M.fields.formation} options={GROUP_FORMATIONS} />
      <ChoiceField {...field("facing")} label={M.fields.groupFacing} options={GROUP_FACINGS} />
      <ChoiceField {...field("troop")} label={M.fields.troop} options={TROOPS} />
      <ChoiceField {...field("building")} label={M.fields.enemyBuilding} options={ENEMY_BUILDINGS}
        onChange={editor.setEnemyBuilding} />
      <ChoiceField {...field("model")} hidden={!catapultFieldsHidden}
        label={M.fields.buildingAppearance} options={BUILDING_APPEARANCES} />
      <NumberField {...field("defenders")} label={M.fields.defenders} max={12} min={0} size="narrow" />
      {!catapultFieldsHidden && <NumberField {...field("catapultStones")}
        label={M.fields.catapultStones} max={6} min={0} size="narrow" />}
      <GarrisonControls editor={editor} />
      <ActionRow>
        <ActionButton caption={M.captions.placeGroup} label={M.actions.placeEnemyGroup}
          onClick={() => editor.activate("unit", "units")} />
        <ActionButton caption={M.captions.placeBuilding} label={M.actions.placeEnemyBuilding}
          onClick={() => editor.activate("building", "units")} />
        <ActionButton caption={M.captions.applyToSelected} label={M.actions.applySelectedEnemy}
          onClick={editor.applySelectedEnemy} />
      </ActionRow>
    </>
  );
};

/** Enemy groups and camps of adventure / colony scenarios. */
export const ScenarioUnitsSection = ({ editor }: EditorProps) => {
  const { view } = useSection(editor.unitsSection);
  const blocked = view.enemiesBlocked;
  return (
    <EditorSection info={M.help.garrison} title={M.sections.units}>
      <AuthoringControls>
        <EnemyScenarioKind editor={editor} />
        <EnemyAuthoring blocked={blocked} editor={editor} />
      </AuthoringControls>
      {!blocked && <SelectionControls editor={editor} scope="units" view={view} />}
      {!blocked && <CatapultInspector editor={editor} />}
    </EditorSection>
  );
};
