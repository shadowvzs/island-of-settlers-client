import { TICKS_PER_DAY } from "../../../island-of-settlers-shared/src/time/constants";
import type { SettlementRuin } from "../shared/settlement/settlement-ruins";

/**
 * Scorched ground around ruins (GROUND-PALETTE step 7, BD2 ruins): one disc per ruin (centre, radius just past the
 * plot, strength), an ash ring around a sooty core that fades back into the ground over a few game days. Render only:
 * read from the ruins' plots and fall tick each frame, at most `maxDiscs` (the youngest), deterministic (sorted by
 * fall tick, then uid). The ground shader draws them (ground-scorch-glsl.ts); without ruins it does no work.
 */
export const RUIN_SCORCH = {
  /** Discs the ground shader takes (a uniform array). */
  maxDiscs: 16,
  /** Game days over which a scorch fades out completely. */
  fadeDays: 3,
  /** Radius: half the plot's longer side times this, plus `margin` cells. */
  plotShare: 0.6,
  margin: 0.8
} as const;

const FADE_TICKS = RUIN_SCORCH.fadeDays * TICKS_PER_DAY;
/** The fade is slow (days): the strengths are refreshed every game minute or so. */
const REFRESH_TICKS = 1200;

/** Strength 1 when fallen .. 0 after the fade (eased: the dark core goes first, the ash ring lingers). */
export const getScorchStrength = (fallTick: number, tick: number) => {
  const age = Math.min(1, Math.max(0, (tick - fallTick) / FADE_TICKS));
  return (1 - age) * (1 - age * 0.5);
};

type ScorchRuin = Pick<SettlementRuin, "depth" | "fallTick" | "uid" | "width" | "x" | "z">;

const youngestFirst = (a: ScorchRuin, b: ScorchRuin) => b.fallTick! - a.fallTick! || a.uid - b.uid;

/**
 * The scorch discs of the ruins for the ground shader: `discs` (x, z, radius, strength per disc, maxDiscs × 4) is
 * refilled in place; `count` discs are live and `revision` changes when they do.
 */
export const createRuinScorchSource = () => {
  const discs = new Float32Array(RUIN_SCORCH.maxDiscs * 4);
  const state = { count: 0, discs, revision: 0 };
  let ruinKey = -1, strengthTick = -Infinity;
  const refill = (ruins: readonly ScorchRuin[], tick: number) => {
    const scorched = ruins.filter(ruin => ruin.fallTick !== undefined && tick - ruin.fallTick < FADE_TICKS)
      .sort(youngestFirst).slice(0, RUIN_SCORCH.maxDiscs);
    scorched.forEach((ruin, index) => {
      const radius = Math.max(ruin.width, ruin.depth) * RUIN_SCORCH.plotShare + RUIN_SCORCH.margin;
      discs.set([ruin.x, ruin.z, radius, getScorchStrength(ruin.fallTick!, tick)], index * 4);
    });
    state.count = scorched.length;
    state.revision += 1;
  };
  return {
    state,
    /** Per frame: allocation free unless a ruin fell or was cleared, or the slow fade stepped (REFRESH_TICKS). */
    update: (ruins: readonly ScorchRuin[], tick: number) => {
      let key = ruins.length;
      for (const ruin of ruins) key = (key * 31 + ruin.uid) % 1_000_000_007;
      if (key === ruinKey && tick - strengthTick < REFRESH_TICKS) return state;
      if (!ruins.length && !state.count) return state;
      ruinKey = key;
      strengthTick = tick;
      refill(ruins, tick);
      return state;
    }
  };
};

export type RuinScorchState = ReturnType<typeof createRuinScorchSource>["state"];
