const THUNDER_SECONDS = 2.2;
const RUMBLE_SECONDS = 1.6;

/**
 * A short filtered noise rumble plus a low sine body from `start` (context time), scaled by `volume` 0..1.
 * Original synthesis; shared by the island soundscape and the script / preview sound cue.
 */
export const scheduleThunder = (context: BaseAudioContext, start: number, volume: number) => {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * THUNDER_SECONDS), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) {
    const t = index / context.sampleRate;
    samples[index] = (Math.random() * 2 - 1) * Math.exp(-t * 1.7) * (0.7 + Math.sin(t * 19) * 0.3);
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass"; filter.frequency.value = 230; filter.Q.value = .7;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(.55 * volume, start + .06);
  gain.gain.exponentialRampToValueAtTime(.0001, start + THUNDER_SECONDS);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start); source.stop(start + THUNDER_SECONDS);
  const rumble = context.createOscillator(), body = context.createGain();
  rumble.type = "sine"; rumble.frequency.setValueAtTime(58, start);
  body.gain.setValueAtTime(0, start);
  body.gain.linearRampToValueAtTime(.18 * volume, start + .08);
  body.gain.exponentialRampToValueAtTime(.0001, start + RUMBLE_SECONDS);
  rumble.connect(body).connect(context.destination);
  rumble.start(start); rumble.stop(start + RUMBLE_SECONDS);
};
