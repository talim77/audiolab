/**
 * Audio Editor Service
 * High-performance non-destructive and offline PCM operations on AudioBuffers.
 */

import { getAudioContext } from './mediaExtractor';

/**
 * Clones an existing AudioBuffer completely.
 */
export function cloneAudioBuffer(source: AudioBuffer): AudioBuffer {
  const ctx = getAudioContext();
  const clone = ctx.createBuffer(
    source.numberOfChannels,
    source.length,
    source.sampleRate
  );

  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    clone.getChannelData(ch).set(source.getChannelData(ch));
  }
  return clone;
}

/**
 * Creates an AudioBuffer from an array of Float32Array channel data.
 */
export function createAudioBufferFromChannels(
  channels: Float32Array[],
  sampleRate: number = 44100
): AudioBuffer {
  const ctx = getAudioContext();
  const numChannels = channels.length;
  const length = channels[0].length;
  const buffer = ctx.createBuffer(numChannels, length, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    buffer.getChannelData(ch).set(channels[ch]);
  }
  return buffer;
}

/**
 * Trims an AudioBuffer to keep only [startTime, endTime].
 */
export function trimAudioBuffer(
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const ctx = getAudioContext();
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const endSample = Math.min(buffer.length, Math.floor(endTime * sampleRate));
  const newLength = Math.max(1, endSample - startSample);

  const trimmed = ctx.createBuffer(buffer.numberOfChannels, newLength, sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const srcData = buffer.getChannelData(ch);
    const dstData = trimmed.getChannelData(ch);
    dstData.set(srcData.subarray(startSample, endSample));
  }

  return trimmed;
}

/**
 * Cuts out [startTime, endTime] and glues the remaining parts together.
 */
export function cutAudioBuffer(
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const ctx = getAudioContext();
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const endSample = Math.min(buffer.length, Math.floor(endTime * sampleRate));

  const part1Length = startSample;
  const part2Length = Math.max(0, buffer.length - endSample);
  const newLength = Math.max(1, part1Length + part2Length);

  const result = ctx.createBuffer(buffer.numberOfChannels, newLength, sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const srcData = buffer.getChannelData(ch);
    const dstData = result.getChannelData(ch);

    if (part1Length > 0) {
      dstData.set(srcData.subarray(0, startSample), 0);
    }
    if (part2Length > 0) {
      dstData.set(srcData.subarray(endSample, buffer.length), part1Length);
    }
  }

  return result;
}

/**
 * Merges multiple AudioBuffers sequentially into one single AudioBuffer.
 */
export function mergeAudioBuffers(buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 0) {
    throw new Error('No buffers provided to merge');
  }
  if (buffers.length === 1) {
    return cloneAudioBuffer(buffers[0]);
  }

  const ctx = getAudioContext();
  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map(b => b.numberOfChannels));
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);

  const merged = ctx.createBuffer(numChannels, totalLength, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const dstData = merged.getChannelData(ch);
    let offset = 0;

    for (const buf of buffers) {
      const srcChannelIndex = Math.min(ch, buf.numberOfChannels - 1);
      const srcData = buf.getChannelData(srcChannelIndex);
      dstData.set(srcData, offset);
      offset += buf.length;
    }
  }

  return merged;
}

/**
 * Applies smooth Fade-in and Fade-out ramps to the audio.
 */
export function applyFade(
  buffer: AudioBuffer,
  fadeInDuration: number,
  fadeOutDuration: number
): AudioBuffer {
  const cloned = cloneAudioBuffer(buffer);
  const sampleRate = cloned.sampleRate;
  const totalSamples = cloned.length;

  const fadeInSamples = Math.min(totalSamples, Math.floor(fadeInDuration * sampleRate));
  const fadeOutSamples = Math.min(totalSamples, Math.floor(fadeOutDuration * sampleRate));
  const fadeOutStart = totalSamples - fadeOutSamples;

  for (let ch = 0; ch < cloned.numberOfChannels; ch++) {
    const data = cloned.getChannelData(ch);

    // Fade in
    for (let i = 0; i < fadeInSamples; i++) {
      const factor = 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
      data[i] *= factor;
    }

    // Fade out
    for (let i = 0; i < fadeOutSamples; i++) {
      const factor = 0.5 * (1 + Math.cos((Math.PI * i) / fadeOutSamples));
      data[fadeOutStart + i] *= factor;
    }
  }

  return cloned;
}

/**
 * Adjusts volume gain by a numeric factor (e.g. 1.0 = 100%, 1.5 = 150%, 0.5 = 50%).
 */
export function adjustVolume(buffer: AudioBuffer, gainFactor: number): AudioBuffer {
  const cloned = cloneAudioBuffer(buffer);

  for (let ch = 0; ch < cloned.numberOfChannels; ch++) {
    const data = cloned.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(-1, Math.min(1, data[i] * gainFactor));
    }
  }

  return cloned;
}

/**
 * Normalizes audio so maximum peak hits ~0.98 amplitude without clipping.
 */
export function normalizeAudio(buffer: AudioBuffer): AudioBuffer {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }

  if (peak === 0 || peak >= 0.98) {
    return cloneAudioBuffer(buffer);
  }

  const gainFactor = 0.98 / peak;
  return adjustVolume(buffer, gainFactor);
}

/**
 * Changes playback tempo / speed using OfflineAudioContext.
 */
export async function changeSpeed(buffer: AudioBuffer, speedRatio: number): Promise<AudioBuffer> {
  if (Math.abs(speedRatio - 1.0) < 0.01) {
    return cloneAudioBuffer(buffer);
  }

  const targetDuration = buffer.duration / speedRatio;
  const targetLength = Math.ceil(targetDuration * buffer.sampleRate);

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    targetLength,
    buffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = speedRatio;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}
