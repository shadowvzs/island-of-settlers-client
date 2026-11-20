import type { ScenarioBuilding } from "../../shared/world/map-scenario";
import { validScenarioCatapult } from "../../shared/world/scenario-catapult";
import { scenarioGarrison, scenarioGarrisonCapacity, validScenarioGarrison } from "../../shared/world/scenario-garrison";
import { GARRISON_ROWS } from "./scenario-garrison-controls";
import { createSectionStore } from "./section-store";

type CrewField = `${"shield" | "heavy"}:${0 | 1 | 2}`;
export const CATAPULT_CREW_ROWS = GARRISON_ROWS.filter(row => row.type !== "archer")
  .map(row => ({ ...row, name: row.name as CrewField }));
const rowDefaults = Object.fromEntries(CATAPULT_CREW_ROWS.map(row => [row.name, "0"])) as Record<CrewField, string>;

/** A draft belongs to one authored tower; accepted mutations are owned by editor history. */
export const createCatapultInspector = (apply: (id: number, change: Pick<ScenarioBuilding,
  "catapult" | "defenders" | "garrison">) => boolean) => {
  const section = createSectionStore({ ...rowDefaults, roof: "2", ground: "4", visible: false, invalid: false, id: 0, capacity: 0 });
  let subject: ScenarioBuilding | undefined, signature = "";
  const show = (entry?: ScenarioBuilding, reset = false) => {
    const next = entry?.catapult ? JSON.stringify(entry) : "";
    if (!reset && signature === next) return;
    signature = next; subject = entry?.catapult ? entry : undefined;
    if (!subject?.catapult) { section.update({ visible: false }); return; }
    const roof = subject.catapult.roofStones ?? Math.min(2, subject.catapult.stones);
    const groups = scenarioGarrison(subject);
    section.update({ ...Object.fromEntries(CATAPULT_CREW_ROWS.map(row => [row.name,
      String(groups.find(group => group.type === row.type && group.rank === row.rank)?.count ?? 0)])),
      invalid: false, roof: String(roof), ground: String(subject.catapult.stones - roof), visible: true,
      id: subject.id, capacity: scenarioGarrisonCapacity(subject) });
  };
  const read = () => {
    if (!subject?.catapult || !section.reportValidity("roof", "ground", ...CATAPULT_CREW_ROWS.map(row => row.name))) return;
    const view = section.get();
    const whole = (text: string) => text.trim() === "" ? NaN : Number(text);
    const roof = whole(view.roof), ground = whole(view.ground);
    const garrison = CATAPULT_CREW_ROWS.map(row => ({ type: row.type, rank: row.rank,
      count: whole(view[row.name]!) })).filter(row => row.count !== 0);
    const defenders = garrison.reduce((sum, group) => sum + group.count, 0);
    const catapult = { ...subject.catapult, stones: roof + ground, roofStones: roof };
    const candidate = { ...subject, catapult, defenders, garrison };
    if (!Number.isSafeInteger(ground) || ground < 0 || !validScenarioCatapult(candidate) ||
      !validScenarioGarrison(candidate)) return;
    return { catapult, defenders, garrison };
  };
  return { section, show, cancel: () => show(subject, true), apply: () => {
    const change = read();
    const accepted = !!change && !!subject && apply(subject.id, change);
    section.update({ invalid: !accepted });
    return accepted;
  } };
};
