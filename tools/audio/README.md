# Music collection rendering

The game's player streams Ogg files on demand. MIDI synthesis and the General MIDI
soundfont are used only by this offline asset pipeline.

```sh
python3 tools/audio/render-midi.py --jobs 2
```

Dependencies: Python 3, system `libfluidsynth`, `ffmpeg` with Vorbis, and a licensed GM
soundfont (defaults to `/usr/share/sounds/sf2/FluidR3_GM.sf2`). No installation or download
happens automatically. Use `--source` and `--soundfont` to select other local inputs.
`--jobs` accepts 1–4. `--limit` is a development option and produces a partial catalog.

Inputs default to the sibling `resources/midi/` collection directories: `roman`, `viking`,
`japanese`, `nubian`, `neutral`. Original MIDI files are never changed or copied into the
checkout. All tracks preserve their MIDI tempo, instrument programs and dynamics; rendering
adds a release tail and normalizes to a -20 LUFS target / -2 dB true peak before Vorbis q4
encoding. The catalog records the source MIDI and soundfont hashes for reproducibility.

Processed tracks are written under `assets/audio/midi/`; the generated `catalog.json` records
the render (hashes, seconds). The game reads the shared content catalog (`music:*` entries in
`island-of-settlers-shared/src/catalog/data/music.json`): after a render, add or update the
entries there (a guard test fails on an unlisted audio file and on a mismatch with `catalog.json`).
`music-catalog.ts` resolves Vite asset URLs, and the player loads
only the selected track after a user playback gesture. Nation collections include the neutral
tracks and the existing *Harbour Lanterns*; all bundled tracks and local files remain separately
selectable. Local uploads keep their blob URLs in the browser only.

If changing the soundfont, replace its associated licence/attribution too. The bundled music
credits and FluidR3 licence are linked directly from the player and included in production
builds through those asset URLs. Composition attribution remains separate from instrument
sample licensing and from the CC0 dedication of *Harbour Lanterns*.
