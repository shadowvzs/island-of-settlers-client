export interface ArmourPoseSampling {
  attackSamples: number;
  gaitSamples: number;
  phaseOffset: number;
  runBlends: readonly number[];
}

/** Defaults retain the existing training grid; explicit sampling produces independent phases. */
export const equippedArmourMotions = (sampling?: ArmourPoseSampling) => {
  const motions = [{ name: "idle", action: "idle_breathe", phase: .2,
    progress: null as number | null, defending: false, runBlend: 0 },
  { name: "defending", action: "idle_breathe", phase: .2, progress: null, defending: true, runBlend: 0 }];
  const gaitSamples = sampling?.gaitSamples ?? 8, attackSamples = sampling?.attackSamples ?? 12;
  const offset = sampling?.phaseOffset ?? 0;
  if (!Number.isInteger(gaitSamples) || gaitSamples < 1 || !Number.isInteger(attackSamples)
    || attackSamples < 1 || !Number.isFinite(offset)) throw new Error("Invalid equipped-pose sampling grid");
  for (const action of ["walk", "run"]) for (let sample = 0; sample < gaitSamples; sample++)
    motions.push({ name: `${action}/${sample}/${gaitSamples}`, action,
      phase: ((sample + offset) / gaitSamples) % 1, progress: null, defending: false,
      runBlend: action === "run" ? 1 : 0 });
  for (const blend of sampling?.runBlends ?? []) {
    if (!Number.isFinite(blend) || blend <= 0 || blend >= 1) throw new Error("Choose an interior gait blend");
    for (let sample = 0; sample < gaitSamples; sample++) motions.push({
      name: `blend-${blend}/${sample}/${gaitSamples}`, action: "walk",
      phase: ((sample + offset) / gaitSamples) % 1, progress: null, defending: false, runBlend: blend });
  }
  for (let sample = 0; sample < attackSamples; sample++) motions.push({ name: `attack/${sample}/${attackSamples}`,
    action: "idle_breathe", phase: .2, progress: ((sample + offset) / attackSamples) % 1,
    defending: false, runBlend: 0 });
  return motions;
};
