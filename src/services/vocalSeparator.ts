/**
 * Vocal & Background Music Separator Service
 * Supports:
 * 1. Cloud AI Separation via Gradio 4/5/6 Hugging Face Spaces (with auto-fallback & optional HF Token)
 *    or Custom FastAPI / Google Colab backend - 0 phone RAM!
 * 2. Instant DSP Center-Channel Inversion (0.1s zero-download karaoke split) - 100% offline & safe
 * 3. Local Neural Separation via Demucs HTDemucs ONNX (WebGPU/WASM) for high-RAM PCs
 */

import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';
import { Client } from '@gradio/client';
import { createAudioBufferFromChannels, cloneAudioBuffer } from './audioEditor';
import { audioBufferToMp3, audioBufferToWav } from './audioExporter';
import { getAudioContext } from './mediaExtractor';

export interface SeparationResult {
  vocalsBuffer: AudioBuffer;
  instrumentalBuffer: AudioBuffer;
  drumsBuffer?: AudioBuffer;
  bassBuffer?: AudioBuffer;
  mode: 'ai' | 'dsp' | 'cloud';
  providerLabel?: string;
}

export interface SeparationProgress {
  phase: 'init' | 'downloading' | 'loading' | 'uploading' | 'separating' | 'done' | 'error';
  progress: number; // 0 to 100
  message: string;
}

export const DEFAULT_CLOUD_SPACES = [
  'csukuangfj/music-source-separation',
  'teamup-tech/Demucs'
] as const;

const LEGACY_BROKEN_DEFAULTS = [
  'nakas/demucs_playground',
  'https://audiolab-demucs.hf.space'
];

export function normalizeCloudTarget(rawValue: string | null | undefined): string {
  const trimmed = (rawValue || '').trim();
  if (!trimmed || LEGACY_BROKEN_DEFAULTS.includes(trimmed)) {
    return 'auto';
  }
  return trimmed;
}

const DB_NAME = 'vocalcut_ai_cache';
const STORE_NAME = 'models';
const MODEL_KEY = 'htdemucs_embedded';

/**
 * Check if a Hugging Face Space is running and compatible with Gradio 4+
 */
async function isSpaceRunning(spaceId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://huggingface.co/api/spaces/${spaceId}`);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.runtime?.stage !== 'RUNNING') return false;
    const sdkVer = String(data.cardData?.sdk_version || '');
    if (sdkVer.startsWith('3.')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a custom Cloud Demucs server or Space is reachable
 */
export async function checkCloudHealth(serverUrlOrSpace: string): Promise<boolean> {
  try {
    const target = normalizeCloudTarget(serverUrlOrSpace);
    if (target === 'auto') {
      const checks = await Promise.all(DEFAULT_CLOUD_SPACES.map(isSpaceRunning));
      return checks.some(Boolean);
    }

    if (target.includes('/') && !target.startsWith('http')) {
      return await isSpaceRunning(target);
    }

    const cleanUrl = target.replace(/\/+$/, '');
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
 * Executes high-quality Demucs separation on a FREE Cloud Server
 * Supports 'auto' multi-space fallback, specific Gradio 4/5/6 Spaces,
 * and custom FastAPI/Colab servers. Uses MP3 upload for 8x faster mobile uploads!
 */
export async function separateWithCloudAI(
  audioBuffer: AudioBuffer,
  serverUrlOrSpace: string,
  onProgress?: (info: SeparationProgress) => void,
  hfToken?: string
): Promise<SeparationResult> {
  const target = normalizeCloudTarget(serverUrlOrSpace);
  const cleanToken = (hfToken || '').trim() || undefined;

  onProgress?.({
    phase: 'init',
    progress: 10,
    message: 'Compressing audio to MP3 for fast cloud upload...'
  });

  // Encode to 192kbps MP3 (~8x smaller than WAV, critical for mobile data/speed)
  const mp3Blob = await audioBufferToMp3(audioBuffer, 192, (pct) => {
    onProgress?.({
      phase: 'init',
      progress: 10 + Math.round(pct * 0.1),
      message: `Preparing upload audio (${pct}%)...`
    });
  });
  const uploadFile = new File([mp3Blob], 'track.mp3', { type: 'audio/mp3' });

  // Auto mode: try verified Gradio 4/6 Spaces with automatic fallback
  if (target === 'auto') {
    const errors: string[] = [];
    for (let i = 0; i < DEFAULT_CLOUD_SPACES.length; i++) {
      const space = DEFAULT_CLOUD_SPACES[i];
      try {
        return await separateWithGradioClient(uploadFile, space, cleanToken, onProgress);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${space}: ${msg}`);
        if (i < DEFAULT_CLOUD_SPACES.length - 1) {
          onProgress?.({
            phase: 'init',
            progress: 22,
            message: `Switching to backup Cloud AI server (${DEFAULT_CLOUD_SPACES[i + 1]})...`
          });
        }
      }
    }
    throw new Error(`All free Cloud AI servers are currently busy. (${errors.join(' | ')})`);
  }

  const isGradioSpace =
    (target.includes('/') && !target.startsWith('http')) || target.includes('hf.space');

  if (isGradioSpace) {
    return await separateWithGradioClient(uploadFile, target, cleanToken, onProgress);
  } else {
    return await separateWithRestApi(audioBuffer, target, onProgress);
  }
}

/**
 * Mix multiple AudioBuffers in parallel (summing channels into one instrumental track)
 */
function mixBuffersParallel(buffers: AudioBuffer[]): AudioBuffer {
  const ctx = getAudioContext();
  const length = Math.max(...buffers.map((b) => b.length));
  const sampleRate = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const mixed = ctx.createBuffer(channels, length, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const dst = mixed.getChannelData(ch);
    for (const buf of buffers) {
      const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      for (let i = 0; i < src.length; i++) {
        dst[i] = Math.max(-1, Math.min(1, dst[i] + src[i]));
      }
    }
  }
  return mixed;
}

/**
 * Connects to a Gradio 4/5/6 Hugging Face Space running Demucs via @gradio/client
 */
async function separateWithGradioClient(
  audioFile: File,
  spaceNameOrUrl: string,
  hfToken: string | undefined,
  onProgress?: (info: SeparationProgress) => void
): Promise<SeparationResult> {
  onProgress?.({
    phase: 'init',
    progress: 25,
    message: `Connecting to Cloud AI (${spaceNameOrUrl})...`
  });

  const connectOpts = hfToken ? { token: hfToken as `hf_${string}` } : undefined;
  const client = await Client.connect(spaceNameOrUrl, connectOpts);

  onProgress?.({
    phase: 'uploading',
    progress: 40,
    message: `Uploading track (${(audioFile.size / 1024 / 1024).toFixed(2)} MB) to Cloud AI...`
  });

  // Inspect endpoints so we call the right endpoint and map output stems accurately
  const apiInfo: any = await client.view_api();
  const endpoints = apiInfo?.named_endpoints || {};

  let endpointName = '/predict';
  let payload: unknown[] = [audioFile];

  if (endpoints['/process_uploaded_file']) {
    endpointName = '/process_uploaded_file';
    payload = [audioFile];
  } else if (endpoints['/process']) {
    endpointName = '/process';
    const params = endpoints['/process'].parameters || [];
    payload = params.length > 1 ? [audioFile, 'htdemucs'] : [audioFile];
  } else if (!endpoints['/predict']) {
    const firstAudioEndpoint = Object.keys(endpoints).find((key) =>
      endpoints[key]?.parameters?.some((p: any) =>
        ['Audio', 'File'].includes(p.component)
      )
    );
    if (firstAudioEndpoint) {
      endpointName = firstAudioEndpoint;
    }
  }

  onProgress?.({
    phase: 'separating',
    progress: 60,
    message: `Cloud Demucs AI (${spaceNameOrUrl}) is separating vocals & music...`
  });

  const result: any = await client.predict(endpointName, payload);

  onProgress?.({
    phase: 'loading',
    progress: 85,
    message: 'Downloading and decoding separated stems...'
  });

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

  const stemsData = result?.data;
  if (!stemsData || !Array.isArray(stemsData) || stemsData.length === 0) {
    throw new Error('No audio returned from cloud model');
  }

  // Filter only actual audio/file stem objects (ignore trailing HTML/text status items)
  const audioStemItems = stemsData
    .map((item: any, idx: number) => ({
      item,
      label: String(endpoints[endpointName]?.returns?.[idx]?.label || '').toLowerCase(),
      name: String(item?.orig_name || item?.path || '').toLowerCase()
    }))
    .filter((entry) => {
      if (!entry.item) return false;
      if (typeof entry.item === 'string') return entry.item.startsWith('http');
      return Boolean(entry.item.url || entry.item.data || entry.item.path);
    });

  if (audioStemItems.length === 0) {
    throw new Error('Cloud server did not return playable audio URLs');
  }

  const decodeStem = async (stem: any): Promise<AudioBuffer> => {
    const url = typeof stem === 'string' ? stem : stem.url || stem.data;
    let res = await fetch(url);
    if ((res.status === 401 || res.status === 403) && hfToken) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${hfToken}` } });
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch separated audio stem (HTTP ${res.status})`);
    }
    const buf = await res.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  };

  // Identify vocals stem vs accompaniment/instrumental/4-stem components
  const vocalEntry = audioStemItems.find(
    (e) => e.label.includes('vocal') || e.name.includes('vocal')
  );

  let vocalsBuffer: AudioBuffer;
  let instrumentalBuffer: AudioBuffer;
  let drumsBuffer: AudioBuffer | undefined;
  let bassBuffer: AudioBuffer | undefined;

  if (audioStemItems.length === 2 && !vocalEntry) {
    // Standard 2-stem default [vocals, instrumental]
    [vocalsBuffer, instrumentalBuffer] = await Promise.all([
      decodeStem(audioStemItems[0].item),
      decodeStem(audioStemItems[1].item)
    ]);
  } else if (audioStemItems.length === 2) {
    const otherEntry = audioStemItems.find((e) => e !== vocalEntry)!;
    [vocalsBuffer, instrumentalBuffer] = await Promise.all([
      decodeStem(vocalEntry!.item),
      decodeStem(otherEntry.item)
    ]);
  } else if (audioStemItems.length >= 4) {
    // 4-stem layout (e.g. teamup-tech/Demucs: [Drums, Bass, Vocals, Other])
    const decoded = await Promise.all(audioStemItems.map((e) => decodeStem(e.item)));
    const vocalIdx = audioStemItems.findIndex(
      (e) => e.label.includes('vocal') || e.name.includes('vocal')
    );
    const vIdx = vocalIdx >= 0 ? vocalIdx : 2;
    vocalsBuffer = decoded[vIdx];

    const drumsIdx = audioStemItems.findIndex(
      (e) => e.label.includes('drum') || e.name.includes('drum')
    );
    const bassIdx = audioStemItems.findIndex(
      (e) => e.label.includes('bass') || e.name.includes('bass')
    );
    if (drumsIdx >= 0) drumsBuffer = decoded[drumsIdx];
    if (bassIdx >= 0) bassBuffer = decoded[bassIdx];

    const instTracks = decoded.filter((_, idx) => idx !== vIdx);
    instrumentalBuffer = mixBuffersParallel(instTracks);
  } else {
    vocalsBuffer = await decodeStem(audioStemItems[0].item);
    instrumentalBuffer = cloneAudioBuffer(vocalsBuffer);
  }

  onProgress?.({
    phase: 'done',
    progress: 100,
    message: 'Cloud AI separation complete!'
  });

  return {
    vocalsBuffer,
    instrumentalBuffer,
    drumsBuffer,
    bassBuffer,
    mode: 'cloud',
    providerLabel: spaceNameOrUrl
  };
}

/**
 * Connects to custom FastAPI / Colab server via REST
 */
async function separateWithRestApi(
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
          resolve(JSON.parse(xhr.responseText));
        } catch {
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
    mode: 'cloud',
    providerLabel: cleanUrl
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

  let leftChannel: Float32Array;
  let rightChannel: Float32Array;

  if (processBuffer.numberOfChannels === 1) {
    leftChannel = processBuffer.getChannelData(0);
    rightChannel = new Float32Array(leftChannel);
  } else {
    leftChannel = processBuffer.getChannelData(0);
    rightChannel = processBuffer.getChannelData(1);
  }

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

    const diff = (l - r) * 0.707;
    const sum = (l + r) * 0.5;

    instLeft[i] = diff;
    instRight[i] = -diff;

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
