/** Presentation identity changes when the same real actor mounts, dismounts or obtains a new lease. */
export interface CommanderRenderSubject {
  actor: number;
  generation: number;
  mounted: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
}
interface DrawnCommanderBody { actorId?: number; x: number; y: number; z: number; heading: number }
export interface CommanderRenderedBodies {
  workers?: readonly DrawnCommanderBody[];
  cavalryMounts?: readonly DrawnCommanderBody[];
}

/** Reuses the interpolated render pose, but never retains another body mode or a missing actor. */
export const createCommanderRenderPose = () => {
  let current: CommanderRenderSubject | undefined;
  return {
    clear: () => { current = undefined; },
    current: (): Readonly<CommanderRenderSubject> | undefined => current,
    sample: (subject: CommanderRenderSubject, rendered?: CommanderRenderedBodies): CommanderRenderSubject => {
      if (current?.actor !== subject.actor || current.generation !== subject.generation ||
        current.mounted !== subject.mounted) current = undefined;
      if (rendered) {
        const rows = subject.mounted ? rendered.cavalryMounts : rendered.workers;
        const body = rows?.find(row => row.actorId === subject.actor);
        if (!body) { current = undefined; return subject; }
        current = { actor: subject.actor, generation: subject.generation, mounted: subject.mounted,
          x: body.x, y: body.y, z: body.z, yaw: body.heading };
      }
      return current ?? subject;
    }
  };
};
