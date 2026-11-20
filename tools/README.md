# island-of-settlers-client/tools

Run everything from `game/client` (`npx tsx tools/<path>`). Most tools are documented where they
are used (npm scripts in `package.json`, `docs/code-map.md`, feature docs). This page lists the
manual tools that nothing else links, so they stay discoverable (TEST-01 review, 2026-10-19;
the test layers and what replaced the deleted review drivers: `docs/reference/test-strategy-2026-10-19.md`).

| Folder | What |
| --- | --- |
| `bench/` | Browser drivers (`browser.ts`, `chrome.ts`), asset exporters, native reviews, benchmarks |
| `analysis/` | Node audits, balance sweeps, project checks |
| `ai/` | TOOL-7 AI build program upkeep: `npm run ai:check` (validator report), `npm run ai:suggest` (draft goals) |
| `assets/` | Asset generators and catalogues (npm `editor-icons`, `credits`, …) |
| `e2e/full/` | Opt-in full journey runner (`npm run test:e2e:full`) |
| `dev/` | Small developer previews |
| `review/` | TOOL-3 review sheets: spec-driven real-game captures plus labelled contact sheets |
| `server/` | Server-side builds of shared game code (`npm run verifier-bundle`: the api's command log verifier) |

## Entry points and Knip roots

`island-of-settlers-client/knip.ts` treats every `tools/**/*.{ts,mts}` file as an entry, plus `tests/**/*.test.ts`,
`tests-ui/**/*.spec.ts`, the dev-server showcase pages, modules loaded by URL from tool/test code
and workers started through `new Worker(new URL(...))`. This prevents the unused-code scan from
mistaking deliberate manual entry points for dead files. It is **not** a register of current
usefulness: a historical tool can be rooted and still be obsolete, and a production-only scan does
not certify the build graph.

Entry-point inventory (paths below are relative to `island-of-settlers-client/`; this inventory deletes nothing):

| Entry point | Examples / discovery |
| --- | --- |
| Manual Node tools | `tools/**/*.{ts,mts}`, the table below and `package.json` scripts |
| Browser drivers and previews | `tools/bench/browser.ts`, `tools/bench/chrome.ts`, review drivers, `tools/dev/lab-shot.mts` |
| Dev-server pages | `src/animal-showcase/main.ts`, `src/building-showcase/main.ts`, `src/editor-icons/main.ts` |
| Browser-loaded modules | `"/src/…"` URL imports in `tools/` and `tests-ui/` (155 unique modules on 2026-10-23) |
| Workers | `src/app/workers/{game-session,scenario-inspection,sound,world}-worker.ts` and `src/app/workers/editor-seed-worker.ts`, as started by `new Worker(new URL(...))` |
| Test runners | Vitest `tests/**/*.test.ts`; Playwright `tests-ui/**/*.spec.ts`; opt-in `tools/e2e/full/run.ts` |
| Server tooling | `tools/server/build-verifier.ts` (`npm run verifier-bundle`) and its `src/app/settlement/server-bundle.ts` entry |
| Owner balance index | `src/shared/balance/index.ts` |
| Asset generators | `tools/assets/` and exporters in `tools/bench/` (they write committed assets; never delete) |

Counts are an orientation snapshot, not acceptance criteria. Re-run `npx knip` after changing a
tool; review reachability and current purpose before deleting a manual entry.

## project:audit scope and receipts

`npm run project:audit` (or `npx tsx tools/analysis/project-audit.ts`) writes
`resources/project-reviews/<date>/structure-audit.json` by default. Use `--output <directory>` for
an explicit workspace or scratch location and `--dry-run` to inspect without writing. Receipts are
created exclusively, so a second run on the same date writes `structure-audit-2.json` rather than
replacing the first. Each receipt records:

- `checkedDocs`/`brokenLinks`: local file destinations in `README.md`, `CLAUDE.md`,
  `island-of-settlers-client/CREDITS.md` and `docs/**/*.md` (case-insensitive). Remote URLs, same-page anchors and
  prose/path claims are not checked.
- `reviewAssets`: files under `island-of-settlers-client/assets/**` with a path segment containing `review`; nothing is
  moved or deleted.
- `longestModules`: top 15 by newline count across `.ts` and `.tsx` under `island-of-settlers-client/src`. Line count
  alone is not a defect or a deletion criterion; generated/data-heavy modules are retained.
  Tools, tests, test UI and other repositories are outside this size scan.
- `provenance`: UTC audit date, full invocation, cwd/npm script/Node, git revision/branch/dirty
  files, a SHA-256 source digest with `.ts`/`.tsx` file counts, and docs/review-asset digests
  (review assets include per-file hashes).
- `scope`: the included/excluded paths and limitations above in machine-readable form.

Symlinked files and folders are not traversed by any scan. This is a structure/link receipt, not
dead-code proof. Knip remains the separate unused-code scan; its all-tools roots preserve manual
entry points but do not establish that every historical tool is still needed.

## TOOL-4 A/B perf runner (`bench/ab-runner.ts`)

**Why it exists.** Every perf lane used to hand-run the base and the lane bench alternately, copy medians out of the
logs, guess the noise of a shared machine and type the receipt table (`docs/plans/a14-0-2026-11-13.md`,
`retreat-spike-2026-11-13.md`, `a14-1-2026-11-13.md`). That cost 20–40 minutes per comparison, mixed up runs and
produced "faster" claims that were inside the noise.

**What it solves.** One command checks out the base, runs any existing bench alternately on base and lane (ABBA by
default, so slow drift and a burst of load from another lane hit both sides), extracts the metrics, and writes:

- per metric: median, min–max, MAD/IQR, delta and delta %, a **noise band** (2 × 1.4826 × pooled MAD, about 95 %)
  with a `within noise` / `lower` / `higher` verdict, and the paired per-round delta ± its own band;
- determinism columns: any text the bench prints that must stay identical (state hashes, battle end, survivors),
  reported `equal`, `differs` or `unstable` (one side disagrees with itself);
- `ab-result.json` (all runs and values), `ab-result.md` (the table, ready to paste) and every run's log.

**Base checkout.** `--base` is a git ref or an existing worktree folder. A ref becomes a temporary detached sparse
worktree on the large drive (`…/worktree/ab-base-<commit>-<pid>`, sparse `'/*' '!/resources/'`) with the lane's
`node_modules` (root, client, shared) and `island-of-settlers-worker-generation` links copied as symlinks. At the end
it deletes only the symlinks it created (each lstat-checked, never followed, only inside that worktree) and runs
`git worktree remove` without `--force`; if the bench left untracked files it keeps the folder and says so.
`--keep-worktree` keeps it for reuse (`--base <that folder>` next time).

**Usage** (from `island-of-settlers-client/`; `--help` lists every flag):

```sh
# Commander phase of the battle bench, base commit vs this lane, 5 rounds + 1 warm-up per side, nice 15
npx tsx tools/bench/ab-runner.ts --base 42b673761 --config tools/bench/ab-presets/battle-commander.json \
  --out ../../captures/<lane>/ab-commander
# A/A control (method noise floor): same commit on both sides, all "within noise" and "equal"
npx tsx tools/bench/ab-runner.ts --base HEAD --config tools/bench/ab-presets/battle-commander-json.json
# Ad hoc: one A14 fixture, tick p95 by regex, 3 rounds
npx tsx tools/bench/ab-runner.ts --base master --rounds 3 --env ONLY=field64 \
  --metric 'tickP95=/tick [\d.]+\/(?<value>[\d.]+)/' -- tools/bench/military-a14-baseline.ts
# Browser bench: every run holds a browser slot (captures/browser-slot.sh)
npx tsx tools/bench/ab-runner.ts --base master --browser-slot --metric 'fps=json:fps' -- tools/bench/<bench>.ts
```

- Extractors: `name=/regex/flags` takes the named group `value`, else group 1, else the match; `name=json:a.b.0.c`
  reads the bench's `BENCH_JSON` lines. `--metric` values must be numbers; `--hash` values are compared as text.
- Presets (`--config`, folder `bench/ab-presets/`) hold `command`, `env`, `metrics`, `hashes`, `rounds`, `warmup`,
  `nice`, `order`; flags override them and add to their lists. `wallSeconds` per run is always reported.
- Keep runs short on the shared machine: shrink the bench (`SECONDS`, `SIZE`, `ONLY`) before raising `--rounds`.
  Five rounds is the minimum for a usable MAD. Under heavy foreign load the band widens instead of lying: re-run.
- A base older than a bench's JSON output still works with regex extractors (`battle-commander.json`).

**Making a bench JSON-friendly.** Call `emitBenchJson({ ... })` from `bench/bench-json.ts` once per result block
(see `bench/military-battle-tick.ts`). It prints one `BENCH_JSON {...}` line only when `BENCH_JSON=1`, which the
runner sets, so the human-readable output is unchanged. Several lines are merged (later keys win); use one top-level
key per scenario (`flat`, `coastal`), raw numbers (ms, not formatted strings), and include the state hash.

## Manual tools linked nowhere else

| Tool | Purpose |
| --- | --- |
| **Asset exporters** (write committed assets; never delete) | |
| `bench/main-building-icon-render.ts` | Build launcher icon `assets/ui-icons/roman-buildings.png` (Roman HQ) |
| `bench/player-portrait-backdrops.ts` | HUD portrait backdrops `assets/ui-icons/portraits/<nation>-backdrop.webp` |
| `bench/stone-source-review.ts` | Map editor stone deposit icons `assets/editor-icons/<stone>-deposit.png` + review shots |
| `assets/hardwood-game-meshes.mjs` | Offline hardwood mesh/texture derivation (pass a toolkit folder with meshoptimizer and sharp) |
| `assets/medieval-music.py` | Synthesised CC0 music track (needs ffmpeg) |
| `assets/advanced-material-budget.py` | Triangle/provenance accounting of the advanced material wares |
| `assets/catalog-loose-models.ts` | Status catalogue of the loose models in `resources/models` |
| **Benchmarks and budgets** (node) | |
| `bench/navigation-scale-review.ts` | Route planning cost at 100/300/1000 actors |
| `bench/expedition-island-generation.ts` | Colony/adventure island generation time and layout (`[seeds]`) |
| `bench/home-map-island-fixtures.ts` | Generate/validate/inspect the frozen 2/5/9-landmass home-map saves |
| `bench/home-island-fleet-scenarios.ts` | Same-map 2/5/9 finite fleet/scout/visitor/supply scenarios and per-tick metrics (`--count`, `--load`, `--ships`, `--horizon`, `--founder`) |
| `bench/colony-terrain-budget.ts`, `bench/mountain-template-budget.ts`, `bench/generated-mountain-budget.ts` | Terrain generation/edit cost budgets |
| `analysis/authored-editor-performance.ts` | Authored river edit cost on a 512² island |
| `analysis/replay-recording-overhead.ts` | Reproduction recording overhead (`<reproduction report.json>`) |
| **Generation sweeps** (more seeds than the vitest cases) | |
| `bench/adventure-theme-generation-audit.ts`, `bench/colony-theme-generation-audit.ts` | Every theme charts hard islands on `SEEDS` seeds |
| **Determinism** (node + browsers) | |
| `analysis/math-engine-compare.ts` | Math functions in Node vs Chrome / Firefox / WebKit, native and `DMath` (D4.6) |
| `analysis/replay-hash-compare.ts --engine firefox\|webkit` | A recording's state hashes in Node vs a browser engine (Playwright's Firefox/WebKit: `npx playwright install firefox webkit`) |
| **Balance sweeps** (node) | |
| `analysis/military-range-sweep.ts`, `analysis/military-archer-sweep.ts` | Troop range/archer balance sweeps |
| `analysis/military-economy-formation-balance.ts` | Formation cost per equal production labour |
| `bench/military-field-playtest.ts` | Field battles over `SEEDS`/`TERRAINS`/`FORCES` |
| `bench/nation-drink-throughput.ts` | Drink chain throughput per nation |
| **Saves and replays** | |
| `analysis/supplied-save-audit.ts` | Audits every save in a folder (`[folder] [output] [--simulate]`), read-only copies |
| `bench/adventure-landing-replay.ts` | Replays an adventure save's landing (`<save.json>`) |
| **Reviews and previews** | |
| `review/review-sheet.ts` | TOOL-3: one spec → High/Minimal × iso/possessed/spyglass contact sheet (see below) |
| `review/reference-tuner.ts` | TOOL-8: reference clips vs game views, side-by-side sheet + motion/shape metrics (see below) |
| `bench/residence-review.ts` | In-game High/Minimal shots of the three residences (`resources/settlement-previews/residences/`) |
| `bench/model-fixes-review.ts` | Building showcase shots from four sides, close-ups (`BUILDINGS`, `NATIONS`, `CLOSE`, …) |
| `analysis/rigged-audit-gallery.ts` | HTML gallery for the `bench/rigged-animation-audit.ts` output |
| `dev/lab-shot.mts` | Screenshot of any game URL query (`<out-prefix> "<query>" [c]`) |
| `dev/tree-atlas-preview.ts` | Writes the tree foliage atlas for inspection |
| `webgpu/tsl-scope-check.ts` | TSL pitfall P33: dumps the live Ultra shaders of named node materials (`MATERIALS`, `VIEWS=iso,possessed`, through `__webgpuSpike.shaderOf`) or checks saved dumps (`<file...>`); lists variables read outside the block that assigns them, exits 1 on findings |

## TOOL-3 review sheets (`review/review-sheet.ts`)

**Why.** The visual rules in `CLAUDE.md` require every changed model, decoration or terrain feature to
be inspected on High and Minimal, close and at normal gameplay distance, in the iso view and the
possessed (eye/spyglass) view. Until 2026-11-13 every visual lane wrote its own capture script for
that (`decor-game-review`, `drink-maker-stance-review`, `building-level-review`, `bridge-captures`, …)
and then a separate contact-sheet step (the visual-acceptance lane used a throw-away Python/PIL
`sheet.py`). That cost a lane 30–60 minutes and gave inconsistent framing, so before/after shots of
two lanes could not be compared.

**What it solves.** One command with a small JSON spec captures every subject × preset × view on the
**real island renderer** (dev server, actual lights, shadows, LOD selection) and writes:

- `shots/<subject>-<preset>-<view>[-y<quarter>].png`: the raw 1280×800 frames;
- `sheet.png`: one row per subject and preset, one labelled column per view;
- `manifest.json`: the normalised spec, git revision, each shot (file, label, preset, view, quarter,
  `remaining` = cells left to the planned possessed stand, so a blocked walk is visible) and page errors;
- `compare.png` with `--before <older output folder>`: each "before" row directly above its "after" row.

Usage (from `island-of-settlers-client`; captures belong under the lane's capture folder, never in the repo):

```sh
<captures>/browser-slot.sh npx tsx tools/review/review-sheet.ts tools/review/examples/forester-levels.json \
  --out <captures>/<lane>/forester-after [--before <captures>/<lane>/forester-before]
npx tsx tools/review/review-sheet.ts <spec.json> --out <dir> --before <dir> --sheet-only  # re-assemble only
```

Spec (`ReviewSpec` in `review/review-spec.ts`; only `name` and `subjects` are required):

| Field | Default | Meaning |
| --- | --- | --- |
| `name`, `title` | — / name | Output folder default (`$TMPDIR/review-sheet-<name>`) and sheet title |
| `subjects` | — | `{ kind: "building", typeId, nation, level?, rotation? }`, `{ kind: "decoration", item }` (road decoration kind, e.g. `climbing-rose-red`) or `{ kind: "position", x, z, label?, query?, stand? }` (`stand`: close stand cells, default 4) |
| `views` | iso-close, iso-normal, possessed-close, possessed-normal, spyglass | Also `iso-far`; motion views from the close stand: `possessed-up` (looking up at the subject against the sky) and six-frame strips `possessed-walk` (steps forward/back), `possessed-turn` (camera turn), `possessed-wind` (0.2 s apart) |
| `presets` | `["high", "minimal"]` | Any of high, medium, low, minimal (`?quality=`) |
| `yaws` | `[]` | Iso camera quarters 0–3; empty = quarter 0 for buildings, else the side with the HQ behind the subject |
| `time`, `weather` | `day`, `clear` | `?time=` preset or hour; `rain` / `snow` add `?rain=1` / `?snow=1` |
| `zoom` | close 2.6, normal 1.2, far .7 | Iso camera zooms (1.2 ≈ normal gameplay distance) |
| `lift` | buildings 1.5, others 0 | Height (world units) the views aim at above the ground |
| `query` | `size=128&seed=123&cache=0&skipLogin=1&reveal=1` | Island query of decoration/position scenes |
| `out` | temp folder | Relative to the spec file; `--out` overrides |

Staging: buildings of one nation share a flat, all-grass fixture island
(`bench/flat-island-fixture.ts`, also used by `drink-maker-stance-review`), are finished, road-connected
and raised to `level` with the development level tool, up to 8 per nation. Decorations are bought and
placed beside the HQ roads of the guest island (`stageRoadDecorations`). Positions are taken as given.
Possessed views possess the nearest settler, walk to a stand on the door side (buildings) or away from
the HQ (others), shoot normal (10 cells) and close, then the spyglass from a far stand (22 cells for
buildings, 10 otherwise; it magnifies at least 3×).

Examples: `review/examples/forester-levels.json` (Roman forester L1 and L5) and
`review/examples/climbing-rose.json` (road decoration).

Limits: animals, props and ships have no subject kind yet (use `position` on a seed where they stand);
the possessed stand can be blocked by terrain (check `remaining` in the manifest); the HUD stays in the
frames (it is the real game view); one browser and one dev server per run (sequential scenes, about
2–3 minutes per scene and preset).

### TOOL-3 renderer axis (WG-1b)

`review/renderer-parity.ts` is the renderer axis beside the subject/preset sheets. It freezes the
same S1 (owner town) and S2 (seed-123 possessed forest) frame, captures it under `webgl`, `webgpu`
and `webgpu-gl`, and writes:

- `<scene>-<renderer>.png`: the real composited viewport;
- `diff-<scene>-<renderer>.png`: the RGB difference amplified ×16;
- `parity.json` / `parity.md`: per-pixel changed %, mean channel, max channel and the share of
  pixels over 4 levels;
- `webgl-repeat`: a second capture after a fresh page load and a fresh frozen frame. Its difference
  from the first WebGL shot is the capture noise band (not required to be exactly 0).

The run fails when `?renderer=webgpu` or `?renderer=webgpu-gl` silently fell back to WebGL2 (it
asserts `__webgpuSpike.stats().mode` after load) and when a page reports an error.

Run it through the browser slot. Native WebGPU screenshots need headed Chrome on this Linux host;
`WEBGPU_ANGLE=gl` keeps WebGL2 available while exposing the native adapter:

```sh
HEADED=1 WEBGPU=1 WEBGPU_ANGLE=gl OUTPUT_DIR=<captures>/wg-1b \
  <captures>/browser-slot.sh npx tsx tools/review/renderer-parity.ts
```

The unported baseline is expected to differ from WebGL: the WebGPU path uses WG-0's stand-in node
materials. The useful baseline checks are the reloaded WebGL repeat (the noise band) and the
near-0 `webgpu` vs `webgpu-gl` comparison; the WebGL-vs-WebGPU diff becomes the parity budget once
materials are ported.

## TOOL-8 reference tuner (`review/reference-tuner.ts`)

**Why.** Swash and cloud parameters were tuned by eye. The tuner measures the owner's reference footage and the
same kind of game view with one code path, so a parameter change is a measured step towards the reference
(overview and rules: `docs/reference/dev-tools.md` TOOL-8).

```sh
# References + game captures (dev server, one browser): High/Minimal × day/dusk per the spec
<captures>/browser-slot.sh npx tsx tools/review/reference-tuner.ts tools/review/examples/reference-swash.json \
  --out <captures>/<lane>/swash-after --videos "<main checkout>/resources/references/owner-videos" [--before <captures>/<lane>/swash-before]
# Measure again without capturing (threshold or ROI changes): saved strips + references
npx tsx tools/review/reference-tuner.ts <spec.json> --out <same dir> --videos <dir> --reanalyse
```

Flags: `--videos` (default `resources/references/owner-videos`, else `resources-readonly/…` in a lane; owner clips, never committed), `--stills`
(default `../resources/references/ground-photos`), `--save` (default `captures/perf/owner-laggy-2026-11-07.json`,
read only), `--reference-only` / `--reanalyse` (no capture, re-measure saved strips), `--game-only` (keep the
previous reference metrics), `--before <dir>`.

Spec (`TunerSpec` in `review/reference-tuner-spec.ts`; examples `review/examples/reference-{swash,clouds}.json`):

| Field | Meaning |
| --- | --- |
| `kind` | `swash` or `clouds` |
| `references[]` | `clip` (relative to `--videos`), `label`, `camera` (`static`/`slow`/`moving` from SOURCES.md), `start`, `duration`, `fps`, `roi` (shares), `landward` (swash: screen side of the land), `hfov` (clouds, default 60) |
| `stills[]` | `image` (relative to `--stills`), `label`, `roi`, `landward`: dry → wet band → foam line bands |
| `game[]` | `view` (`possessed-beach`, `iso-beach`, `sky-up`), `presets`, `times` (day, dusk, hour), `seconds`, `fps`, optional `roi` (swash default: projected box around the beach) |
| `analysisWidth`, `cover` | analysed frame width (320); pinned possessed cloud cover for `sky-up` (0.55) |

Game captures may set `name` (key suffix, e.g. `flicker`) and `draws` (draws per frame before the read: default
10 converges the temporal passes; 2 approximates live frames). The clouds example adds 2 s, 30 fps `flicker`
strips and 30 fps reference clips for the edge-stability metric (`edgeFlickerMean`/`P99`: |Δ luma| between
consecutive frames in the cloud edge band; the edge-crop cell shows A | B | |B−A|×8, zoomed ×4). Further metrics:
`skyStreakCoherence` (parallel strokes in the clear sky), `blobDiameterDegrees`, `swashPeakDwellShare` (time the
foam front stays near its highest run-up).

Output (`--out`, never the repo): `sheet.png`, `metrics.md`, `metrics.json`, `reference/<label>/` (still, overlays),
`game/<preset>-<time>-<view>/` (frames, `strip.json`, `analysis/`). Overlays: foam cyan, detected front red, lowest
and highest run-up green/magenta, dry edge yellow, moving sheet edge orange. Check them before trusting a number: a
wrong ROI or a beach with grass in the dry rows shows there at once.

Limits: the beach is the save's nearest sandy shore (diagonal shores smear the per-column front, so prefer the
possessed view for swash shape); reference field of view is a guess, so cloud angles compare in trend, not exactly;
the swash front is the landward-most foam, which in top-down clips includes the bore crossing the inner surf zone;
about 4 minutes per 96-frame game strip.
