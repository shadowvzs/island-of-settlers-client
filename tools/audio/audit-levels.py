"""Measure shipped tracks and canonical browser-rendered mixes with installed FFmpeg only."""
import concurrent.futures
import json
import pathlib
import re
import subprocess
import sys

CLIENT = pathlib.Path(__file__).resolve().parents[2]
OUTPUT = CLIENT.parent / "resources/project-reviews/acceptance-2026-10-28/audio-mix"
OUTPUT.mkdir(parents=True, exist_ok=True)


def measure(path):
    process = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostdin", "-threads", "1", "-i", str(path),
        "-af", "ebur128=peak=true,astats=metadata=0:reset=0", "-f", "null", "-"
    ], capture_output=True, text=True, check=True)
    log = process.stderr
    summary = log.rsplit("Summary:", 1)[-1]
    overall = log.rsplit("Overall", 1)[-1]

    def value(pattern, source):
        found = re.search(pattern, source)
        return float(found.group(1)) if found else None

    return {
        "file": str(path.relative_to(CLIENT.parent)),
        "integratedLufs": value(r"I:\s+([\-\d.]+) LUFS", summary),
        "loudnessRangeLu": value(r"LRA:\s+([\d.]+) LU", summary),
        "truePeakDbfs": value(r"Peak:\s+([\-\d.]+) dBFS", summary),
        "rmsDbfs": value(r"RMS level dB:\s+([\-\d.]+)", overall),
        "dcOffset": value(r"DC offset:\s+([\-\d.]+)", overall),
        "nanSamples": value(r"Number of NaNs:\s+([\d.]+)", overall),
        "infiniteSamples": value(r"Number of Infs:\s+([\d.]+)", overall),
        "zeroCrossingRate": value(r"Zero crossings rate:\s+([\d.]+)", log),
    }


if __name__ == "__main__":
    files = sorted(OUTPUT.glob("*.wav")) + sorted(OUTPUT.glob("*.webm"))
    prior = []
    if "--mixes-only" in sys.argv:
        prior = [row for row in json.loads((OUTPUT / "levels.json").read_text())["files"]
                 if row["file"].endswith(".ogg")]
    else:
        files = sorted((CLIENT / "assets/audio").rglob("*.ogg")) + files
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = prior + list(pool.map(measure, files))
    report = {"tool": "Installed FFmpeg ebur128 true-peak + astats; full tracks, no normalization",
              "files": rows}
    (OUTPUT / "levels.json").write_text(json.dumps(report, indent=2) + "\n")
    bands = []
    for path in sorted(OUTPUT.glob("*.wav")):
        row = {"file": path.name}
        for name, filters in {"below250Hz": "lowpass=f=250", "250to4000Hz":
                              "highpass=f=250,lowpass=f=4000", "above4000Hz": "highpass=f=4000"}.items():
            result = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-threads", "1",
                                     "-i", str(path), "-af", filters + ",astats=metadata=0:reset=0",
                                     "-f", "null", "-"], capture_output=True, text=True, check=True)
            overall = result.stderr.rsplit("Overall", 1)[-1]
            row[name + "RmsDbfs"] = float(re.search(r"RMS level dB:\s+([\-\d.]+)", overall).group(1))
        bands.append(row)
    (OUTPUT / "spectrum.json").write_text(json.dumps({
        "method": "FFmpeg low/high-pass RMS band energy; descriptive, not perceptual quality rating",
        "rows": bands}, indent=2) + "\n")
    print(json.dumps({"files": len(rows), "maxTruePeakDbfs": max(
        row["truePeakDbfs"] for row in rows if row["truePeakDbfs"] is not None)}))
