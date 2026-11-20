import { expect, it } from "vitest";

import { encodeSceneData } from "../src/app/scene-replay/codec";
import { createSceneJournal, readSceneReplay } from "../src/app/scene-replay/journal";
import { getAvatarGenderOptions } from "../src/app/settings/customization/helpers";
import { resolveExplorationAppearance } from "../src/renderers/three/exploration/exploration-portrait";
import {
  commanderMaximumHealth, commanderRecruitCatalog, type CommanderState, isCommanderState
} from "../src/shared/settlement/settlement-commander";
import {
  type CommanderManifest, commanderManifestError
} from "../src/shared/settlement/settlement-commander-transport";

it.each(["indigenous", "chinese", "persian", "maya"] as const)(
  "%s retains its identity in replay and commander transport with its published roster", nation => {
    const journal = createSceneJournal();
    journal.beginSegment("home", nation, "H4sI");
    expect(readSceneReplay(encodeSceneData(journal.report())).segments[0]!.nation).toBe(nation);
    const definition = commanderRecruitCatalog(nation)[0]!;
    // CAT5 (7006cad86): the published roster is Roman's, but the portrait icon is the nation's own.
    expect(definition).toEqual({ ...commanderRecruitCatalog("roman")[0], icon: nation });
    const state: CommanderState = { definitionId: definition.id, healingSeconds: 0, homeIslandSeed: 1,
      homeLodgeUid: 2, id: "commander-1", level: 1, location: "lodge", name: "Aurelius", nation,
      recoverySeconds: 0, xp: 0 };
    expect(isCommanderState(state)).toBe(true);
    const manifest: CommanderManifest = { casualty: false, definitionId: definition.id,
      destinationName: "Island", healingSeconds: 0, homeIslandSeed: 1, hp: commanderMaximumHealth(1),
      id: state.id, level: 1, maximumHp: commanderMaximumHealth(1), name: state.name, nation,
      operationId: 1, phase: "outward", recoverySeconds: 0, xp: 0 };
    expect(commanderManifestError(manifest)).toBeNull();
    expect(isCommanderState({ ...state, nation: "moche" })).toBe(false);
    expect(commanderManifestError({ ...manifest, nation: "moche" })).not.toBeNull();
    expect(isCommanderState({ ...state, definitionId: `${nation}-guardian` })).toBe(false);
    for (const gender of ["female", "male"] as const) {
      const appearance = resolveExplorationAppearance({ gender, nation });
      expect(appearance.nationFallback).toBe(false);
      expect(appearance.gender).toBe(gender);
      expect(appearance.appearance.nation).toBe(nation);
      expect(appearance.appearance.variant).toContain(`${nation}-${gender}`);
      const own = getAvatarGenderOptions(nation, gender).find(option => option.gender === gender)!;
      expect(own.face).toBeTruthy();
      expect(own.checked).toBe(true);
    }
  }
);
