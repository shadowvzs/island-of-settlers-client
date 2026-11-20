import { mapAudioAssetKinds } from "../../../../island-of-settlers-shared/src/script/audio";
import {
  type ScriptValidationResult, scriptValidationResult
} from "../../../../island-of-settlers-shared/src/script/issues";
import {
  type ScriptValidationContext, validateMapScript
} from "../../../../island-of-settlers-shared/src/script/validate";
import { checkWorldPlacedObjects } from "./placed-object-fingerprint";
import { scriptFactionAiView } from "./scenario-faction-ai-script";
import type { WorldData } from "./world-data";

/**
 * The map script's Ready check on a whole map (TRG1): `validateMapScript` with the map's computer faction AI (EAI2c)
 * plus the placed fingerprints against the map's authored objects. Null for a map without a script. The editor's save flow (TRG11) calls it.
 */
export const validateWorldScript = (
  world: Pick<WorldData, "audioAssets" | "cellsX" | "scenario" | "script">, context: ScriptValidationContext
): ScriptValidationResult | null => {
  if (!world.script) return null;
  // Uploaded audio references are checked against the map's own assets.
  const audioAssets = context.audioAssets ?? mapAudioAssetKinds(world.audioAssets);
  const factionAi = context.factionAi ?? scriptFactionAiView(world.scenario);
  const result = validateMapScript(world.script, { ...context, audioAssets, factionAi });
  const issues = [...result.errors, ...result.warnings, ...result.infos, ...checkWorldPlacedObjects(world)];
  return scriptValidationResult(issues, result.scriptReadsEnvironment);
};
