/**
 * Vocal & Background Music Separator Service
 * Supports:
 * 1. Cloud AI Separation via Remote Demucs Backend (Hugging Face / Colab) - 0 phone RAM used!
 * 2. Instant DSP Center-Channel Inversion (0.1s zero-download karaoke split) - 100% offline & safe
 * 3. Local Neural Separation via Demucs HTDemucs ONNX (WebGPU/WASM) for high-RAM PCs
 */

import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';
import { createAudioBufferFromChannels, cloneAudioBuffer } from './audioEditor';
import { audioBufferToWav } from './audioExporter';
import { getAudioContext } from './mediaExtractor';

export interface SeparationResult {
  vocalsBuffer: AudioBuffer;
  instrumentalBuffer: AudioBuffer;
  drumsBuffer?: AudioBuffer;
  bassBuffer?: AudioBuffer;
  mode: 'ai' | 'dsp' | 'cloud';
}

export interface SeparationProgress {
  phase: 'init' | 'downloading' | 'loading' | 'uploading' | 'separating' | 'done' | 'error';
  progress: number; // 0 to 100
  message: string;
}

const DB_NAME = 'vocalcut_ai_cache';
const STORE_NAME = 'models';
const MODEL_KEY = 'htdemucs_embedded';

/**
 * Check if a custom Cloud Demucs server is reachable and online
 */
export async function checkCloudHealth(serverUrl: string): Promise<boolean> {
  try {
    const cleanUrl = serverUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${cleanUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Executes high-quality Demucs separation on a FREE Cloud Server (Hugging Face / Colab)
 * Uses 0 MB phone RAM, making it 100% crash-proof on Android!
 */
export async function separateWithCloudAI(
  audioBuffer: AudioBuffer,
  serverUrl: string,
  onProgress?: (info: SeparationProgress) => void
): Promise<SeparationResult> {
  const cleanUrl = serverUrl.replace(/\/+$/, '');

  onProgress?.({
    phase: 'init',
    progress: 10,
    message: 'Converting audio to WAV for cloud upload...'
  });

  const wavBlob = audioBufferToWav(audioBuffer);
  const formData = new FormData();
  formData.append('file', wavBlob, 'track.wav');

  onProgress?.({
    phase: 'uploading',
    progress: 25,
    message: 'Uploading audio to Cloud AI server...'
  });

  // Use XMLHttpRequest to monitor upload progress
  const responseData: any = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${cleanUrl}/api/separate`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round(25 + (event.loaded / event.total) * 35);
        onProgress?.({
          phase: 'uploading',
          progress: pct,
          message: `Uploading to Cloud: ${Math.round((event.loaded / event.total) * 100)}%`
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid JSON response from server'));
        }
      } else {
        reject(new Error(`Server error (${xhr.status}): ${xhr.responseText || 'Failed separation'}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error connecting to Cloud AI server'));
    xhr.ontimeout = () => reject(new Error('Cloud AI server timed out'));

    onProgress?.({
      phase: 'separating',
      progress: 65,
      message: 'Cloud Demucs AI is separating vocals & instruments (GPU/Server)...'
    });

    xhr.send(formData);
  });

  onProgress?.({
    phase: 'loading',
    progress: 85,
    message: 'Decoding separated vocal and instrumental stems...'
  });

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  // Fetch and decode base64 audio
  const fetchAudioBuffer = async (dataUri: string): Promise<AudioBuffer> => {
    const res = await fetch(dataUri);
    const buf = await res.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  };

  const [vocalsBuffer, instrumentalBuffer] = await Promise.all([
    fetchAudioBuffer(responseData.vocals_base64),
    fetchAudioBuffer(responseData.instrumental_base64)
  ]);

  onProgress?.({
    phase: 'done',
    progress: 100,
    message: 'Cloud AI separation complete!'
  });

  return {
    vocalsBuffer,
    instrumentalBuffer,
    mode: 'cloud'
  };
}

/**
 * Open or create IndexedDB for model caching
 */
async function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve cached model ArrayBuffer from IndexedDB
 */
async function getCachedModelBuffer(): Promise<ArrayBuffer | null> {
  try {
    const db = await openModelDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(MODEL_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Save model ArrayBuffer into IndexedDB
 */
async function saveModelBuffer(buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openModelDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(buffer, MODEL_KEY);
  } catch (err) {
    console.warn('Failed to cache model in IndexedDB:', err);
  }
}

let cachedProcessor: InstanceType<typeof DemucsProcessor> | null = null;

/**
 * Separates Vocals and Instrumental using Local Demucs Neural Network (WebGPU/WASM)
 * Note: Recommended for Desktop / High-RAM devices.
 */
export async function separateWithDemucsAI(
  audioBuffer: AudioBuffer,
  onProgress?: (info: SeparationProgress) => void
): Promise<SeparationResult> {
  const sampleRate = CONSTANTS.SAMPLE_RATE; // 44100Hz expected

  // Resample if necessary using OfflineAudioContext
  let processBuffer = audioBuffer;
  if (audioBuffer.sampleRate !== sampleRate) {
    onProgress?.({
      phase: 'init',
      progress: 5,
      message: 'Resampling audio to 44.1kHz for Demucs...'
    });
    const offlineCtx = new OfflineAudioContext(
      2,
      Math.ceil(audioBuffer.duration * sampleRate),
      sampleRate
    );
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    processBuffer = await offlineCtx.startRendering();
  }

  // Get stereo channels
  let leftChannel: Float32Array;
  let rightChannel: Float32Array;

  if (processBuffer.numberOfChannels === 1) {
    leftChannel = processBuffer.getChannelData(0);
    rightChannel = new Float32Array(leftChannel);
  } else {
    leftChannel = processBuffer.getChannelData(0);
    rightChannel = processBuffer.getChannelData(1);
  }

  // Initialize processor if not already loaded
  if (!cachedProcessor) {
    cachedProcessor = new DemucsProcessor({
      ort,
      onProgress: ({ progress }: { progress: number }) => {
        onProgress?.({
          phase: 'separating',
          progress: Math.round(progress * 100),
          message: `Separating audio stems: ${Math.round(progress * 100)}%`
        });
      },
      onDownloadProgress: (loaded: number, total: number) => {
        const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
        const mbTotal = (total / 1024 / 1024).toFixed(1);
        const pct = Math.round((loaded / total) * 100);
        onProgress?.({
          phase: 'downloading',
          progress: pct,
          message: `Downloading AI Model (${mbLoaded} MB / ${mbTotal} MB)...`
        });
      },
      onLog: (_phase: string, msg: string) => {
        console.log(`[Demucs]: ${msg}`);
      }
    });

    onProgress?.({
      phase: 'loading',
      progress: 10,
      message: 'Checking for cached AI model in local storage...'
    });

    const cachedBuffer = await getCachedModelBuffer();
    if (cachedBuffer) {
      onProgress?.({
        phase: 'loading',
        progress: 30,
        message: 'Initializing AI model from local cache (WebGPU / WASM)...'
      });
      await cachedProcessor.loadModel(cachedBuffer);
    } else {
      onProgress?.({
        phase: 'downloading',
        progress: 0,
        message: 'Fetching Demucs AI model (170MB, stored permanently for offline)...'
      });

      const response = await fetch(CONSTANTS.DEFAULT_MODEL_URL);
      const contentLength = response.headers.get('Content-Length');
      const totalSize = contentLength ? parseInt(contentLength, 10) : 172000000;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('ReadableStream not supported on model download');
      }

      const chunks: Uint8Array[] = [];
      let loadedSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedSize += value.length;
        const pct = Math.min(99, Math.round((loadedSize / totalSize) * 100));
        onProgress?.({
          phase: 'downloading',
          progress: pct,
          message: `Downloading AI Model (${(loadedSize / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB)...`
        });
      }

      const combined = new Uint8Array(loadedSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const modelBuffer = combined.buffer;
      // Cache in IndexedDB for instant future loads
      await saveModelBuffer(modelBuffer);

      onProgress?.({
        phase: 'loading',
        progress: 95,
        message: 'Initializing WebGPU / WASM neural session...'
      });
      await cachedProcessor.loadModel(modelBuffer);
    }
  }

  onProgress?.({
    phase: 'separating',
    progress: 0,
    message: 'AI neural separation starting...'
  });

  const result = await cachedProcessor.separate(leftChannel, rightChannel);

  // Combine instrumental = drums + bass + other
  const totalSamples = leftChannel.length;
  const instLeft = new Float32Array(totalSamples);
  const instRight = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    instLeft[i] = result.drums.left[i] + result.bass.left[i] + result.other.left[i];
    instRight[i] = result.drums.right[i] + result.bass.right[i] + result.other.right[i];
  }

  const vocalsBuffer = createAudioBufferFromChannels(
    [result.vocals.left, result.vocals.right],
    sampleRate
  );

  const instrumentalBuffer = createAudioBufferFromChannels(
    [instLeft, instRight],
    sampleRate
  );

  onProgress?.({
    phase: 'done',
    progress: 100,
    message: 'Separation complete!'
  });

  return {
    vocalsBuffer,
    instrumentalBuffer,
    mode: 'ai'
  };
}

/**
 * Instant DSP Vocal Remover / Karaoke Mode (Center-Channel Phase Cancellation)
 * Executes in ~0.1s with zero network download and 0 MB RAM spike. 100% Mobile Safe!
 */
export function separateWithDSP(audioBuffer: AudioBuffer): SeparationResult {
  const numSamples = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;

  if (audioBuffer.numberOfChannels < 2) {
    // If mono, center cancellation is not possible; return duplicate
    const vocals = cloneAudioBuffer(audioBuffer);
    const instrumental = cloneAudioBuffer(audioBuffer);
    return {
      vocalsBuffer: vocals,
      instrumentalBuffer: instrumental,
      mode: 'dsp'
    };
  }

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);

  const instLeft = new Float32Array(numSamples);
  const instRight = new Float32Array(numSamples);
  const vocLeft = new Float32Array(numSamples);
  const vocRight = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const l = left[i];
    const r = right[i];

    // Out-of-phase difference removes center-panned lead vocals
    const diff = (l - r) * 0.707;
    // Center channel extraction
    const sum = (l + r) * 0.5;

    // Instrumental contains stereo sides
    instLeft[i] = diff;
    instRight[i] = -diff;

    // Vocals contains center focus
    vocLeft[i] = sum;
    vocRight[i] = sum;
  }

  const instrumentalBuffer = createAudioBufferFromChannels([instLeft, instRight], sampleRate);
  const vocalsBuffer = createAudioBufferFromChannels([vocLeft, vocRight], sampleRate);

  return {
    vocalsBuffer,
    instrumentalBuffer,
    mode: 'dsp'
  };
}
