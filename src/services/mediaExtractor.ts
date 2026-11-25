/**
 * Media Extractor Service
 * Seamlessly handles both Audio files (MP3, WAV, AAC, OGG, FLAC) 
 * and Video files (MP4, WebM, MKV, MOV) by extracting audio in-memory.
 */

export interface ExtractedMedia {
  audioBuffer: AudioBuffer;
  name: string;
  originalSize: number;
  isVideo: boolean;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
}

let sharedAudioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioContextClass();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.wmv', '.flv'];

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const lowerName = file.name.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

/**
 * Extracts raw AudioBuffer from any audio or video file.
 * Modern browsers decode audio tracks from MP4/WebM directly via decodeAudioData.
 */
export async function extractAudioFromMedia(
  file: File,
  onProgress?: (message: string) => void
): Promise<ExtractedMedia> {
  const isVideo = isVideoFile(file);
  onProgress?.(isVideo ? 'Extracting audio track from video...' : 'Decoding audio file...');

  const ctx = getAudioContext();
  const arrayBuffer = await file.arrayBuffer();

  try {
    // Browsers natively decode audio from MP4, WebM, AAC, MP3, WAV, etc.
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    
    return {
      audioBuffer,
      name: file.name.replace(/\.[^/.]+$/, ''),
      originalSize: file.size,
      isVideo,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels
    };
  } catch (err) {
    throw new Error(
      `Could not decode audio from ${file.name}. ${
        isVideo
          ? 'Please ensure the video has an audio stream (AAC/MP3/Opus/PCM).'
          : 'Please check if the file is a valid audio format.'
      }`
    );
  }
}
