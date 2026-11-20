interface PopulationResidenceTimer {
  id: string;
  seconds: number;
  timer: number;
}

/** The pure timed part of `updatePopulationGrowth`: base timer, residences and the people limit. */
export interface PopulationTimerState {
  baseSeconds: number;
  baseTimer: number;
  growthSpeed: number;
  limit: number;
  people: number;
  residences: readonly PopulationResidenceTimer[];
}

interface PopulationBirth {
  source: string;
}

export interface PopulationTimerAdvance {
  births: PopulationBirth[];
  state: PopulationTimerState;
}

/** One scheduler fire (`updatePopulationGrowth(context, .5)`), with the same float order and guards. */
export const advancePopulationTimers = (state: PopulationTimerState, dt: number): PopulationTimerAdvance => {
  if (state.people >= state.limit) return { births: [], state };
  const scaled = dt * (1 + state.growthSpeed);
  let people = state.people, baseTimer = state.baseTimer;
  const births: PopulationBirth[] = [];
  baseTimer += scaled;
  if (baseTimer + 1e-9 >= state.baseSeconds) {
    baseTimer = Math.max(0, baseTimer - state.baseSeconds);
    people++;
    births.push({ source: "base" });
  }
  const residences: PopulationResidenceTimer[] = [];
  for (const residence of state.residences) {
    if (people >= state.limit) { residences.push(residence); continue; }
    let timer = residence.timer + scaled;
    if (timer + 1e-9 < residence.seconds) {
      residences.push({ ...residence, timer });
      continue;
    }
    timer = Math.max(0, timer - residence.seconds);
    people++;
    births.push({ source: residence.id });
    residences.push({ ...residence, timer });
  }
  return { births, state: { ...state, baseTimer, people, residences } };
};
