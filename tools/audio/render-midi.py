"""Render owner-supplied MIDI files offline; browsers receive compressed audio, not a synthesizer.

Requires the host's libfluidsynth, FluidR3_GM.sf2 and ffmpeg. No packages are downloaded.
Usage: python3 tools/audio/render-midi.py [--source PATH] [--soundfont PATH] [--limit N]
"""
import argparse
import csv
from concurrent.futures import ThreadPoolExecutor
import ctypes
import ctypes.util
import hashlib
import json
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COLLECTIONS = ("roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous", "neutral")
COLLECTION_ALIASES = {"indigenous-fictional": "indigenous"}
RATE = 44100


def configure_library():
    library = ctypes.CDLL(ctypes.util.find_library("fluidsynth") or "libfluidsynth.so.3")
    pointer = ctypes.c_void_p
    signatures = {
        "new_fluid_settings": (pointer, []),
        "fluid_settings_setnum": (ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.c_double]),
        "fluid_settings_setint": (ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.c_int]),
        "fluid_settings_setstr": (ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.c_char_p]),
        "new_fluid_synth": (pointer, [pointer]),
        "fluid_synth_sfload": (ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.c_int]),
        "new_fluid_player": (pointer, [pointer]),
        "fluid_player_add": (ctypes.c_int, [pointer, ctypes.c_char_p]),
        "fluid_player_play": (ctypes.c_int, [pointer]),
        "fluid_player_get_status": (ctypes.c_int, [pointer]),
        "new_fluid_file_renderer": (pointer, [pointer]),
        "fluid_file_renderer_process_block": (ctypes.c_int, [pointer]),
        "delete_fluid_file_renderer": (None, [pointer]),
        "delete_fluid_player": (None, [pointer]),
        "delete_fluid_synth": (None, [pointer]),
        "delete_fluid_settings": (None, [pointer]),
    }
    for name, (returns, arguments) in signatures.items():
        function = getattr(library, name)
        function.restype, function.argtypes = returns, arguments
    return library


def render_wave(library, soundfont, midi, output):
    settings = library.new_fluid_settings()
    synth = player = renderer = None
    try:
        library.fluid_settings_setnum(settings, b"synth.sample-rate", RATE)
        library.fluid_settings_setnum(settings, b"synth.gain", .55)
        library.fluid_settings_setint(settings, b"synth.cpu-cores", 1)
        library.fluid_settings_setstr(settings, b"player.timing-source", b"sample")
        library.fluid_settings_setstr(settings, b"audio.file.name", str(output).encode())
        library.fluid_settings_setstr(settings, b"audio.file.type", b"wav")
        library.fluid_settings_setstr(settings, b"audio.file.format", b"s16")
        synth = library.new_fluid_synth(settings)
        if not synth or library.fluid_synth_sfload(synth, str(soundfont).encode(), 1) < 0:
            raise RuntimeError("Cannot load the selected soundfont")
        player = library.new_fluid_player(synth)
        if not player or library.fluid_player_add(player, str(midi).encode()) != 0:
            raise RuntimeError(f"Cannot read MIDI: {midi}")
        renderer = library.new_fluid_file_renderer(synth)
        if not renderer or library.fluid_player_play(player) != 0:
            raise RuntimeError(f"Cannot start offline MIDI rendering: {midi}")
        # FluidSynth's PLAYING status is 1. Limit malformed inputs to 20 minutes.
        maximum_blocks = RATE * 60 * 20 // 64
        blocks = 0
        while library.fluid_player_get_status(player) == 1:
            if library.fluid_file_renderer_process_block(renderer) != 0:
                raise RuntimeError(f"Failed rendering: {midi}")
            blocks += 1
            if blocks > maximum_blocks:
                raise RuntimeError(f"MIDI exceeds the 20-minute render limit: {midi}")
        for _ in range(RATE * 2 // 64):
            library.fluid_file_renderer_process_block(renderer)
    finally:
        for value, cleanup in [(renderer, "delete_fluid_file_renderer"), (player, "delete_fluid_player"),
                               (synth, "delete_fluid_synth"), (settings, "delete_fluid_settings")]:
            if value:
                getattr(library, cleanup)(value)


def track_title(path, collection):
    words = path.stem.removeprefix(collection + "-").rsplit("-", 1)[0].split("-")
    small = {"a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with"}
    title = " ".join(word if index and word in small else word.capitalize() for index, word in enumerate(words))
    for before, after in [("Emperors", "Emperor’s"), ("Senators", "Senator’s"), ("Millwheels", "Millwheel’s"),
                          ("Minstrels", "Minstrel’s"), ("Potters", "Potter’s"), ("Weavers", "Weaver’s"),
                          ("Date Sellers Dancing", "Date Seller’s Dancing"), ("Sandal Makers Holiday", "Sandal Maker’s Holiday")]:
        title = title.replace(before, after)
    return title


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT.parent.parent / "resources/midi")
    parser.add_argument("--soundfont", type=Path, default=Path("/usr/share/sounds/sf2/FluidR3_GM.sf2"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    if not args.soundfont.is_file():
        parser.error("Soundfont file is missing; provide --soundfont")
    files = sorted(args.source.rglob("*.mid"))
    if not files:
        parser.error("No MIDI files found")
    if args.limit:
        files = files[:args.limit]
    output = ROOT / "assets/audio/midi"
    titles = {}
    metadata = args.source.parent / "CATALOG.csv"
    if metadata.is_file():
        with metadata.open(encoding="utf-8-sig", newline="") as source:
            titles = {Path(row["file"]).name: row["title"] for row in csv.DictReader(source)}
    library = configure_library()
    if not 1 <= args.jobs <= 4:
        parser.error("--jobs must be between 1 and 4")
    def render_track(item):
        number, midi = item
        collection = COLLECTION_ALIASES.get(midi.parent.name, midi.parent.name)
        if collection not in COLLECTIONS:
            raise ValueError(f"Unknown music collection: {collection}")
        target = output / collection / (midi.stem + ".ogg")
        target.parent.mkdir(parents=True, exist_ok=True)
        title = titles.get(midi.name, track_title(midi, midi.parent.name))
        with tempfile.TemporaryDirectory(prefix="settlers-midi-") as temporary:
            wav = Path(temporary) / "track.wav"
            render_wave(library, args.soundfont, midi, wav)
            with wave.open(str(wav)) as audio:
                duration = audio.getnframes() / audio.getframerate()
            if duration < 1:
                raise ValueError(f"Empty MIDI rendering: {midi}")
            encoded = Path(temporary) / "track.ogg"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                            "-af", "loudnorm=I=-20:TP=-2:LRA=11", "-ar", "48000", "-c:a", "libvorbis",
                            "-q:a", "4", "-metadata", "title=" + title, str(encoded)], check=True)
            # Write only complete encodings; source MIDIs always remain outside the game checkout.
            target.write_bytes(encoded.read_bytes())
        print(f"{number}/{len(files)} {midi.stem}: {duration:.1f}s", flush=True)
        return {"id": midi.stem, "collection": collection, "title": title,
                "file": target.relative_to(output).as_posix(), "seconds": round(duration, 3),
                "sourceSha256": hashlib.sha256(midi.read_bytes()).hexdigest()}
    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        tracks = list(executor.map(render_track, enumerate(files, 1)))
    catalog = {"format": "island-settlers-music", "version": 1,
               "renderer": "FluidSynth with FluidR3 GM; Ogg Vorbis q4, -20 LUFS target",
               "soundfontSha256": hashlib.sha256(args.soundfont.read_bytes()).hexdigest(), "tracks": tracks}
    (output / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")


if __name__ == "__main__":
    main()
