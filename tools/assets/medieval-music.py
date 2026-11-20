"""Original synthesized score, CC0-1.0. No recordings, samples or third-party music.
Run: python3 tools/assets/medieval-music.py (requires ffmpeg for the final Opus file).
"""
import math, wave, array, subprocess
from pathlib import Path
RATE = 24000
BEAT = 60 / 88
DURATION = 48 * BEAT
score = [0.0] * int((DURATION + 2) * RATE)

def note(midi, start, beats, level, voice):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    duration = beats * BEAT
    offset = int(start * BEAT * RATE)
    for i in range(min(int(duration * RATE), len(score) - offset)):
        t = i / RATE
        phase = 2 * math.pi * frequency * t
        if voice == 'lute':
            envelope = min(1, t / .006) * math.exp(-t * 5.2)
            value = (math.sin(phase) + .35 * math.sin(2 * phase) + .16 * math.sin(3 * phase) + .07 * math.sin(5 * phase))
        else:
            envelope = min(1, t / .09) * min(1, (duration - t) / .16)
            vibrato = .012 * math.sin(2 * math.pi * 4.3 * t) * min(1, t * 3)
            value = math.sin(phase + vibrato) + .09 * math.sin(2 * phase) + .025 * math.sin(3 * phase)
        score[offset + i] += value * envelope * level

# Sixteen original three-beat measures, D Dorian, restrained broken-chord accompaniment.
chords = [(50,57,62),(50,57,65),(48,55,64),(43,55,62),
          (50,57,65),(53,60,65),(48,55,64),(45,57,64)] * 2
melody = [(74,1),(77,.5),(76,.5),(74,1), (72,1),(69,1),(74,1),
          (76,1.5),(79,.5),(76,1), (74,2),(72,1),
          (69,1),(72,.5),(74,.5),(77,1), (76,1),(74,1),(72,1),
          (71,1),(69,1),(67,1), (69,2),(None,1),
          (74,1.5),(76,.5),(77,1), (81,1),(79,1),(77,1),
          (76,1),(72,1),(74,1), (79,1.5),(76,.5),(74,1),
          (77,1),(76,.5),(74,.5),(72,1), (69,1),(72,1),(76,1),
          (74,1),(71,1),(69,1), (74,2.5),(None,.5)]
for bar, chord in enumerate(chords):
    for step, pitch in enumerate((chord[0], chord[1], chord[2], chord[1], chord[2], chord[1])):
        note(pitch, bar * 3 + step * .5, 1.2, .095 if step == 0 else .065, 'lute')
time = 0
for pitch, beats in melody:
    if pitch is not None: note(pitch, time, beats * .92, .12, 'flute')
    time += beats
# A quiet room reflection; no convolution recording or sample is used.
for delay, gain in ((.075,.12),(.137,.07)):
    shift=int(delay*RATE)
    for i in range(len(score)-1,shift-1,-1): score[i]+=score[i-shift]*gain
samples=score[:int(DURATION*RATE)]
peak=max(abs(x) for x in samples)
for i in range(len(samples)):
    fade=min(1,i/(RATE*.3),(len(samples)-i)/(RATE*.65))
    samples[i]=int(samples[i]/max(peak,1)*.74*32767*fade)
path=Path('/tmp/harbour-lanterns.wav')
with wave.open(str(path),'wb') as output:
    output.setnchannels(1);output.setsampwidth(2);output.setframerate(RATE)
    output.writeframes(array.array('h',samples).tobytes())
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(path),'-c:a','libopus','-b:a','24k',
 '-metadata','title=Harbour Lanterns','-metadata','artist=Island of Settlers',
 '-metadata','copyright=CC0-1.0; original synthesized composition; no third-party samples',
 'assets/audio/harbour-lanterns.ogg'],check=True)
print('assets/audio/harbour-lanterns.ogg',Path('assets/audio/harbour-lanterns.ogg').stat().st_size,'bytes')
