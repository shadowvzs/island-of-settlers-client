import { RULE_ISLAND_ROLES } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import type { RuleIslandRole } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  checkMapRules, formatGameSettingsIssue, hasGameSettingsErrors
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings-issues";
import type { MapRules } from "../../../../island-of-settlers-shared/src/game-settings/map-rules";

export type { MapRules };

interface ScenarioRulesSource {
  kind?: unknown;
  rules?: unknown;
}

const isRuleRole = (kind: unknown): kind is RuleIslandRole => (RULE_ISLAND_ROLES as readonly unknown[]).includes(kind);

/** The issues of a map file's own rules for its kind (GS0 `checkMapRules`); none when the map has no rules. */
export const scenarioMapRulesIssues = ({ kind, rules }: ScenarioRulesSource) => {
  if (rules === undefined || !isRuleRole(kind)) return [];
  return checkMapRules(rules, kind);
};

/** Absent, or well shaped with no option the map kind forbids (plan §5.3: the guard refuses them). */
export const validScenarioMapRules = (scenario: ScenarioRulesSource) =>
  !hasGameSettingsErrors(scenarioMapRulesIssues(scenario));

/** The English messages of the map rules' errors and warnings (the editor's validation line). */
export const scenarioMapRulesMessages = (scenario: ScenarioRulesSource) =>
  scenarioMapRulesIssues(scenario).map(formatGameSettingsIssue);
