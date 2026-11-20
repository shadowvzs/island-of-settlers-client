"""Render an original quiet three-note occupation cue with the existing licensed FluidR3 pipeline."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FONT = Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")
OUTPUT = ROOT / "assets/audio/sfx/garrison-first-occupation.ogg"
PREVIEW = ROOT.parent / "resources/project-reviews/garrison-trumpet-2026-11-03"


def variable(value):
    result = [value & 127]
    while value >> 7:
        value >>= 7
        result.insert(0, (value & 127) | 128)
    return bytes(result)


def main():
    spec = importlib.util.spec_from_file_location("midi_renderer", Path(__file__).with_name("render-midi.py"))
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    # Original G4-C5-E5 phrase; soft GM trumpet, no borrowed musical composition.
    track = bytearray(b"\x00\xff\x51\x03\x07\xa1\x20\x00\xc0\x38\x00\xb0\x07\x40\x00\xb0\x5b\x1c")
    for index, (note, length) in enumerate([(67, 170), (72, 210), (76, 330)]):
        track.extend(variable(0 if index == 0 else 32) + bytes([0x90, note, 45]))
        track.extend(variable(length) + bytes([0x80, note, 0]))
    track.extend(b"\x00\xff\x2f\x00")
    midi = b"MThd" + struct.pack(">IHHH", 6, 0, 1, 480) + b"MTrk" + struct.pack(">I", len(track)) + track
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        source, wave = Path(temporary) / "original.mid", Path(temporary) / "source.wav"
        source.write_bytes(midi)
        renderer.render_wave(renderer.configure_library(), FONT, source, wave)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wave), "-af",
                        "atrim=end=1.8,afade=t=out:st=1.35:d=0.4,loudnorm=I=-26:TP=-9:LRA=6",
                        "-ar", "44100", "-c:a", "libvorbis", "-q:a", "5", str(OUTPUT)], check=True)
    (PREVIEW / OUTPUT.name).write_bytes(OUTPUT.read_bytes())
    (PREVIEW / "source.json").write_text(json.dumps({"composition": "Original G4-C5-E5 quiet occupation fanfare",
        "soundfont": FONT.name, "soundfontSha256": hashlib.sha256(FONT.read_bytes()).hexdigest(),
        "midiSha256": hashlib.sha256(midi).hexdigest(), "gain": "Existing environment SFX gain × master × 0.35",
        "license": "Instrument samples: existing FluidR3 license bundled with music. Original cue: CC0."}, indent=2))


if __name__ == "__main__":
    main()
