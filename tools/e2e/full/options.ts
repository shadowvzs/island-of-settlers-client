import { parseArgs } from "node:util";

export const LANES = ["generator", "natural", "prelude", "catalog", "production", "progression", "traffic", "military", "quests", "ships", "colony", "adventure", "continuous", "persistence", "performance", "controls"] as const;
export type Lane = typeof LANES[number];
/** Native detail modes; complete acceptance requires every one of them. */
export const QUALITIES = ["high", "minimal"] as const;
export const readOptions = () => {
  const { values } = parseArgs({ options: {
    help: { type: "boolean", default: false },
    headless: { type: "boolean", default: false },
    lane: { type: "string", default: "all" },
    quality: { type: "string", default: "high,minimal" },
    width: { type: "string", default: "512" },
    height: { type: "string", default: "512" },
    seed: { type: "string", default: "123" },
    resume: { type: "string" },
    output: { type: "string" },
    reconcile: { type: "string" },
    "observe-seconds": { type: "string", default: "60" },
    "soak-seconds": { type: "string", default: "600" },
    "no-video": { type: "boolean", default: false }
  } });
  const integer = (value: string, name: string, low: number, high: number) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < low || number > high)
      throw new Error(`${name} must be an integer between ${low} and ${high}`);
    return number;
  };
  const lanes = values.lane === "all" ? [...LANES] : values.lane.split(",") as Lane[];
  if (lanes.some(lane => !LANES.includes(lane))) throw new Error(`Unknown lane: ${values.lane}`);
  const qualities = values.quality.split(",");
  if (qualities.some(quality => !(QUALITIES as readonly string[]).includes(quality)))
    throw new Error("Quality must be high, minimal or high,minimal");
  return {
    help: values.help, headless: values.headless, lanes: [...new Set(lanes)], qualities: [...new Set(qualities)],
    width: integer(values.width, "width", 64, 512), height: integer(values.height, "height", 64, 512),
    seed: integer(values.seed, "seed", 0, 2 ** 32 - 1), resume: values.resume, output: values.output,
    reconcile: values.reconcile,
    observeSeconds: integer(values["observe-seconds"], "observe-seconds", 10, 3600),
    soakSeconds: integer(values["soak-seconds"], "soak-seconds", 60, 43200), video: !values["no-video"]
  };
};
export type FullOptions = ReturnType<typeof readOptions>;
export const HELP = `Manual gameplay acceptance (never part of npm test)

npm run test:e2e:full -- [options]
  --lane all|generator,natural,prelude,catalog,production,progression,traffic,military,quests,ships,colony,adventure,continuous,persistence,performance,controls
  --quality high,minimal     Both native detail modes, separate contexts
  --width 512 --height 512 --seed 123
  --resume /path/to/checkpoint/manifest.json
  --observe-seconds 60 --soak-seconds 600
  --output /path/to/new/run  Existing run directories are never overwritten
  --reconcile /path/to/run   Re-derive obligations with its reviewed-evidence.json; no browser
  --headless                Headed Chrome is the default
  --no-video                Explicitly opt out of bounded contextual clips
  --help                    Print this text without launching Chrome

Independent lanes import matching map/game checkpoints; run GPU/performance lanes serially.
Performance disables tracing, contextual video and reproduction capture.
Controls reuses a natural checkpoint's real workers when available; standalone runs place one well foundation to obtain a builder.
Supply sufficient finite checkpoints with --resume for production, military and voyage prerequisites.
Prelude builds the minimum finite F0 economy and first infantry; it does not grant expedition readiness.
Continuous runs that prelude on a fresh HQ, or accepts an expedition-ready checkpoint without claiming its F0 history.
Real harbour/ships and a sufficient finite force remain required for the colony/adventure legs.
The report lists unfinished journey obligations as not-run, never as passes.
Fresh evidence is unreviewed: exit 0 is only possible from --reconcile with a reviewer ledger.
`;
