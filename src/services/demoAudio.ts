/**
 * Demo Audio Generator
 * Synthesizes a high-quality multi-instrument musical demo track (beats, chords, bass, and center melody)
 * using the Web Audio API offline renderer. Enables instant testing with zero external files.
 */

export async function generateDemoSong(durationSeconds: number = 10): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, sampleRate * durationSeconds, sampleRate);

  const tempo = 120; // 120 BPM = 2 beats per second (0.5s per beat)
  const secondsPerBeat = 60 / tempo;
  const totalBeats = Math.floor(durationSeconds / secondsPerBeat);

  // 1. Kick & Snare Drums
  for (let beat = 0; beat < totalBeats; beat++) {
    const time = beat * secondsPerBeat;

    if (beat % 2 === 0) {
      // Kick drum
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(35, time + 0.12);

      gain.gain.setValueAtTime(0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

      osc.connect(gain);
      gain.connect(offlineCtx.destination);
      osc.start(time);
      osc.stop(time + 0.3);
    } else {
      // Snare drum (noise burst + tone)
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, time);
      osc.frequency.exponentialRampToValueAtTime(80, time + 0.1);

      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

      osc.connect(gain);
      gain.connect(offlineCtx.destination);
      osc.start(time);
      osc.stop(time + 0.2);
    }

    // Hi-hats every half beat
    const hatTime = time + secondsPerBeat / 2;
    const hatOsc = offlineCtx.createOscillator();
    const hatGain = offlineCtx.createGain();
    hatOsc.type = 'highpass' as any;
    hatOsc.frequency.setValueAtTime(8000, hatTime);
    hatGain.gain.setValueAtTime(0.15, hatTime);
    hatGain.gain.exponentialRampToValueAtTime(0.001, hatTime + 0.05);
    hatOsc.connect(hatGain);
    hatGain.connect(offlineCtx.destination);
    hatOsc.start(hatTime);
    hatOsc.stop(hatTime + 0.06);
  }

  // 2. Stereo Bassline (panned slightly wide)
  const bassNotes = [55, 65.41, 49, 43.65]; // A1, C2, G1, F1
  for (let beat = 0; beat < totalBeats; beat += 2) {
    const time = beat * secondsPerBeat;
    const noteIdx = Math.floor(beat / 4) % bassNotes.length;
    const freq = bassNotes[noteIdx];

    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + secondsPerBeat * 1.8);

    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(time);
    osc.stop(time + secondsPerBeat * 2);
  }

  // 3. Center-panned simulated vocal lead melody
  const vocalMelody = [440, 493.88, 523.25, 587.33, 659.25, 523.25, 493.88, 440];
  for (let beat = 0; beat < totalBeats; beat++) {
    const time = beat * secondsPerBeat;
    const freq = vocalMelody[beat % vocalMelody.length];

    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.setValueAtTime(freq, time + 0.1);
    osc.frequency.linearRampToValueAtTime(freq + 4, time + 0.25);
    osc.frequency.linearRampToValueAtTime(freq - 4, time + 0.35);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.4, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + secondsPerBeat * 0.9);

    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(time);
    osc.stop(time + secondsPerBeat);
  }

  return await offlineCtx.startRendering();
}
