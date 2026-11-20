# Home-island FPS weather (EXPLORE-01F)

This directory is renderer presentation only. It adds no simulation timer, actor, damage, fire,
weather-schedule change, saved preference or gameplay RNG. The ordinary cloud/rain/lightning scheduling stays on its existing path. Camera-air extinction
is shared with ordinary perspective/strategic rendering through `render-common/atmosphere/`.

## Integration points for 01G

1. Create `createExplorationWeatherAdapter({ quality, parent, render: { background, uniforms }, ... })`
   for the current renderer. `environment` should return `frame.environment`;
   `now` should be the exploration presentation clock; `cameraView` should return the exploration
   camera's forward vector and yaw; `shelterAt` may return a coarse 0..1 canopy/roof coverage from a
   read-only lookup; `groundHeight` should sample the existing world height read-only.
   The home renderer may prepare its one sky shader and 256 KiB cloud texture behind startup
   loading. That does not activate or draw the sky, and does not fetch the moon. Entry borrows
   that preparation; cancelling or leaving releases the sky. No extra per-frame pass is added.
2. Pass the exploration-only audio owner from
   `island-of-settlers-client/src/app/audio/exploration-weather.ts` as `audio`. It borrows the existing AudioContext and
   environment bus, so no second context is created and master/environment levels stay authoritative.
   Construct it with `maxVoices: explorationWeatherBudget(quality).audioVoices`, the existing
   sound-enabled getter and the master/environment level getters. The adapter disposes it with the
   rest of the FPS resources (`disposeAudio: false` only if the same owner is deliberately shared
   with another feature).
3. While `explorationWeatherBranch(true)` is selected, skip the ordinary
   `clouds.render(...)` and `rain.render(...)` calls (and the ordinary storm trigger they own), then:
   - call `adapter.renderSky(renderer, camera)` after the clear and before the main scene;
   - call `adapter.renderEffects(renderer, camera)` after the main scene and its transparent layers;
   - call `adapter.update(frame.weather)` once per rendered frame.
4. On exit call `adapter.setActive(false)` immediately (hidden, no allocations), then
   `adapter.dispose()` once the exit effects are done. The adapter releases every exploration-only
   geometry, material, light, buffer and audio owner. It never removes or changes ordinary renderer
   resources.
5. If 01G prefers custom rendering, pass `createRenderObjects: false` and use the exported object
   factories directly. The adapter remains the frozen `ExplorationWeatherAdapter`.

## Budgets

`explorationWeatherBudget(quality)` maps the existing preset to a tier. The Minimal preset keeps
`weatherParticles: false`: no rain volume, splashes, lightning, thunder or world light is enabled;
the sky profile uses one cloud sample, compared with six on Medium and twelve on High. Per-session
`maxDrops`, `maxSplashes` and
`maxAudioVoices` can only lower a tier. Hard caps are exported as
`EXPLORATION_WEATHER_HARD_CAPS` (2,400 drops, 40 splash slots, 16 shelter probes/frame, 3 thunder
voices, 96 bolt vertices).

- Rain is one reused `LineSegments` buffer in a camera-local cylinder. Motion is a single wind and
  gravity calculation; depth is rejected by the near/far dot product and the scene depth buffer.
- Shelter is sampled on a rotating, profile-capped probe budget, not per drop per frame. Splashes
  reuse fixed rings and only sample the surface at the spawn cap.
- Lightning uses one reused bolt buffer, an optional non-shadow point light and at most one
  presentation strike per update. There is no per-strike shadow-map pass and no simulation event.
- Thunder reuses one noise buffer and caps active voices. Distance delay and stereo pan are derived
  from the strike position; reduced flash lowers brightness, cloud/world pulses and audio intensity
  without removing the paired strike.
- Wet appearance stays the existing shared `uRain` value; the adapter reports it as `wetness` only
  for diagnostics. It adds no puddle pass, reflection target or gameplay water accumulation.

## Possessed sky revision (2026-10-24)

The FPS sky combines atmosphere, a lower cloud layer and an independently drifting high cirrus
layer. It has no angular cloud seam or pole, including when looking straight up. Medium/High use
Cartesian 3D cloud noise; High adds finer erosion and bounded light probes. Minimal borrows the
renderer's existing 2D noise atlas for a cheap curved layer and omits high cirrus. All layers remain
one fullscreen draw with no render targets. The Medium/High 64³ R8 cloud-noise texture is 256 KiB.
Terrain, props, standard materials, custom effects and sky share the analytical 3D height-fog
core under `render-common/atmosphere/`. The existing temporary display-fog texture supplies a
separate six-sample 3D concealment veil with a soft height falloff. Weather density is independent
of that mask. Nearby ground stays clear. A separate geometry veil closes the last 40% of the
perspective render range before the far clip; spyglass changes this render boundary, not weather.
Strategic haze is restrained and disabled on Minimal. Refraction excludes camera air and water
composes it once; no new fog texture, target or draw is allocated. The previous XZ-only mist and
its dedicated fixture were replaced. See `docs/archive/dated/atmospheric-fog-multi-agent-plan-2026-10-24.md` and
`island-of-settlers-client/tools/bench/atmosphere-review.ts` for design and native verification.
Dry presentation moves smoothly between clear, sparse and cloudier skies; actual rain drives
overcast coverage and darker clouds. This never writes the environment or its saved weather policy.
Cloud displacement integrates wind on the presentation clock, so rain ending changes velocity
without moving the entire field backwards. Lower banks and high cirrus have different drift rates (multipliers in
`render-common/atmosphere/cloud-drift.ts`, measured against real-time cloud footage with the TOOL-8
reference tuner, 2026-11-17: about 0.34° per second in clear weather);
background gaps are capped, independent of game-hour changes. Cirrus uses broken, fine wisps rather
than broad opaque strips. See `docs/archive/dated/cloud-motion-review-2026-10-24.md` for the cause and native
pixel reproduction; `npx tsx tools/bench/exploration-cloud-motion-review.ts` checks motion directly.
The volumetric pass's temporal resolve (2026-11-16, `exploration-cloud-resolve-glsl.ts`) reprojects
last frame's clouds by the camera rotation and the lower-layer wind drift at a 1.5 km deck, reads
them with a 5-tap Catmull-Rom filter and fades the history by time (0.95 at 60 fps, 0.88 at 15 fps:
a 0.5 s time constant; less again under screen motion), so wind and turns never smear wisps into
streaks; a resize keeps it.
Rotated volume-noise octaves and broad weather modulation vary lower banks; distant unresolved
detail merges into haze. High cirrus reuses the existing 3D texture to avoid aligned atlas strips,
with no added lookup, texture or draw. See `docs/archive/dated/cloud-and-browser-performance-audit-2026-10-24.md`
for the fixed-budget appearance review and the separate unresolved live Firefox slowdown.
The 2048 × 1024 NASA lunar map is requested only
when daylight first drops below the moon's visibility threshold during an active visit; daytime
visits do not load it. The lunar map needs at most about 10.7 MiB of RGBA texture storage with
mipmaps. Both textures, geometry and material are disposed on `setActive(false)`, including on
return to isometric. Small existing rain/splash pools retain their previous reuse policy.

Sun and moon use owner-requested enlarged angular discs (the moon is three times its former disc,
the sun twice its former disc), with cloud occlusion and antialiased edges. The moon and its halo
are composited before the high and low cloud layers, so opaque cloud actually covers them.

The sun (2026-11-07, `exploration-sun-glsl.ts`) is HDR linear light from the camera-air blend,
added over the tonemapped sky with a per-channel highlight shoulder (`explorationSunOutput`, like a
photograph of a light source): noon clips to a blinding white disc while a red setting sun keeps
its red instead of turning cream through the scene's tonemapper (AgX at dusk); the rest of the
scene's tone mapping is unchanged. `render-common/atmosphere/sun-radiance.ts` derives its colour
and intensity on the CPU once per frame from the Kasten-Young air mass of a hazy maritime
atmosphere. The light vector never goes below 0.12 rad (the sun fades out there), so that point
is treated as the sunset: an apparent elevation of about 1.7 degrees (air mass about 21). White
overhead, golden-yellow at 17:36, orange to red at 18:00; an eye-adaptation term keeps the
setting sun about 2.6x display white rather than a dark brown circle. Water glints take the disc's
hue (`uSunGlint`). Achromatic linear limb darkening (rim 40 % of the centre) and a feathered outer
8 % of the radius let the disc blend into the glare without an outline. A Henyey-Greenstein
aerosol aureole (single scattering; its red follows the disc, its green and blue half the path,
so the glow is warmer than a high sun's and less red than the setting disc) and a two-term
analytic glare (Gaussian core plus Lorentzian veil) stand in for a bloom pass; no lens flare
(not a naked-eye effect). The direct beam uses the fourth power of the clouds' display
transmittance, so a bank that reads opaque hides the disc, while cloud in front glows where the
sun lights it from behind; that glow has its own shoulder capped at 0.86 display
(`SUN_CLOUD_GLOW_DISPLAY_PEAK`, 2026-11-16), so dusk rims keep a soft silver lining instead of a
clipped, blooming white halo. The fullscreen triangle's three vertices evaluate the cloud layers
toward the sun (centre and three rim points), so glare and aureole fade when the disc itself is
covered. A CPU march of the read-only height query along the sun's azimuth (24 samples,
`exploration-sun-occlusion.ts`) gates the glare when a hill hides the sun; the depth-tested scene
already hides the disc. Rain and snow dim it through the shared overcast. The concealment veil is
marched for sky rays only up to 0.08 above the horizon (its blocky visibility cells drew vertical
light bands into the dawn/dusk sky). Every preset runs the same code: no extra pass, target or
texture. Review: `OUTPUT=<dir> npx tsx tools/bench/sun-capture.ts` (possessed eye aimed at the
light; `VIEWS=moon` for the lunar phases).

The moon uses a spherical projection of the actual lunar color map and a synodic phase based on
the in-game day (29.530588 days, starting full). The sphere is lit from the phase angle towards
its sun (`environment.ts moonSunDirection`: below the sunset horizon while waxing, below the
sunrise horizon while waning), so the terminator is the true ellipse of every phase and the bright
limb faces the sun; Lommel-Seeliger reflectance keeps the full moon flat, earthshine faintly lights
the night side of a crescent, and the colour (`writeMoonTint`) is grey-white high and warmer near
the horizon. The light vector carries one body, so the moon fades in only as the sun disc fades
out (no daytime moon). Night stars (`exploration-stars-glsl.ts`, `exploration-stars.ts`) are procedural in
the same draw: a cube-face cell hash places one star per occupied cell (power-law brightness,
warm/white/blue-white tint, Gaussian of at least 0.75 px so turning never shimmers), on a sphere
that turns about a fixed celestial pole once per sidereal day (`environment.ts starRotation`).
They come out through astronomical twilight (`starlightForHour`), a bright sky or full moon hides
the faint ones, clouds cover them (added before both layers), overcast removes them, the camera air
dims them at the horizon, where they alone twinkle. Minimal draws the bright layer only; the other
presets add a dense faint layer and a faint Milky Way band. The spyglass brightens them with its
magnification. Asset provenance is in
`docs/reference/asset-credits.md` and the player-visible Credits.

Native visual/GPU review: `npx tsx tools/bench/exploration-sky-review.ts` from `island-of-settlers-client/`.
`LIVE=0` limits it to the isolated production shader; `GPU=igpu` uses the existing integrated GPU
profile. The default also checks actual High/Minimal home-island entry, upward look and return.
`LIVE_ONLY=1 LIVE_QUALITIES=minimal` runs just that real-game visit; use `high` for its counterpart.
`ENGINE=firefox LIVE=0` checks Firefox's actual shader output without claiming Chrome GPU timings.
`LIVE_ONLY=1 LIVE_SIZE=128 LIVE_OPPOSITE=1` also captures the opposite walking direction on a
larger review map; defaults remain the small 64² fixture without a camera override.

## Rainbow after rain (2026-11-11)

`render-common/atmosphere/rainbow.ts` and `rainbow-glsl.ts`: the environment controller keeps a
post-rain moisture (`EnvironmentState.afterRain`, presentation only, not saved) that follows the
rain up and drains over 240 s. The bow fades in over about 15 s while the rain eases from 0.4 to
0.05, holds about a minute and fades out over about 100 s. `atmosphere-state.ts` writes the scalar
`uAtmosphereRainbow` only in the possessed view with `QualityPreset.rainbow` (Medium/High) and a
daylight sun. The bow sits on the true antisolar cone: primary 40.6°–42.4° (red outside), seven
overlapping spectral lobes, a subtly brighter sky inside. Owner default (2026-11-11): a single,
slightly more vivid bow; the secondary (53.6°–50.4°, reversed, 40 %) with Alexander's dark band
stays behind `RAINBOW_SECONDARY_BOW` (off) in `rainbow-glsl.ts`. The sky adds it in front of its clouds, gated by the vertex-evaluated
cloud cover over the sun; the shared airlight adds it by the camera air's opacity, so far hills and
sea carry it faintly and near surfaces (tau < 0.06) skip it. No pass, target or texture; Low,
Minimal and iso stay at strength 0. Review: `tools/bench/rainbow-review.ts` (DEV hook
`window.__rainbow.force`).

## Checks

Focused tests: `island-of-settlers-client/tests/exploration-weather-*.test.ts`. Typecheck: `npx tsc --noEmit`.
