# First garrison occupation cue

`garrison-first-occupation.ogg` is an original soft G4-C5-E5 trumpet phrase (CC0 composition), rendered offline with the existing FluidR3 General MIDI trumpet samples. Instrument licensing is in [FLUIDR3-LICENSE.txt](../midi/FLUIDR3-LICENSE.txt).

Reproduce with `python3 tools/audio/render-occupation-trumpet.py`. The game applies the existing environment/SFX level and master level, with a further0.35 gain. The persisted `territoryClaimed` receipt prevents repeat cues after staffing changes or save/reload; loading an occupied building starts silently.
