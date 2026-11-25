import React, { useState, useRef } from 'react';
import { Upload, Music, Video, Sparkles, Loader2 } from 'lucide-react';
import type { ExtractedMedia } from '../services/mediaExtractor';
import { extractAudioFromMedia } from '../services/mediaExtractor';
import { generateDemoSong } from '../services/demoAudio';

interface FileUploaderProps {
  onMediaLoaded: (media: ExtractedMedia) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onMediaLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFile = async (file: File) => {
    try {
      setLoadingStatus('Processing media...');
      const media = await extractAudioFromMedia(file, (msg) => setLoadingStatus(msg));
      onMediaLoaded(media);
    } catch (err) {
      alert(`Error loading file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingStatus(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const handleLoadDemo = async () => {
    try {
      setLoadingStatus('Generating synth musical demo...');
      const demoBuffer = await generateDemoSong(12);
      onMediaLoaded({
        audioBuffer: demoBuffer,
        name: 'Demo_Track_Chords_Beat',
        originalSize: 1024 * 512,
        isVideo: false,
        duration: demoBuffer.duration,
        sampleRate: demoBuffer.sampleRate,
        numberOfChannels: demoBuffer.numberOfChannels
      });
    } catch (err) {
      alert(`Error generating demo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingStatus(null);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* Upload Box */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-3xl p-10 sm:p-14 text-center cursor-pointer transition-all duration-200 group ${
          isDragging
            ? 'border-purple-500 bg-purple-950/20 shadow-2xl shadow-purple-500/20 scale-[1.01]'
            : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.aac,.m4a,.ogg,.flac,.mp4,.webm,.mkv,.mov,.avi"
          onChange={handleFileSelect}
          className="hidden"
        />

        {loadingStatus ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <Loader2 className="w-12 h-12 text-purple-400 animate-spin" />
            <p className="text-slate-200 font-medium text-lg">{loadingStatus}</p>
            <p className="text-slate-400 text-sm">Decoding and extracting in-memory...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 border border-purple-500/20 flex items-center justify-center group-hover:scale-110 transition duration-300">
              <Upload className="w-9 h-9 text-purple-400 group-hover:text-purple-300" />
            </div>

            <div>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">
                Drop your Audio or Video here
              </h3>
              <p className="text-slate-400 text-sm max-w-lg mx-auto">
                Select an <span className="text-purple-300 font-medium">MP3, WAV, AAC</span> or any{' '}
                <span className="text-indigo-300 font-medium">MP4, WebM, MKV video</span>.
                Videos are automatically converted to audio track instantly with zero effort!
              </p>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
                <Music className="w-3.5 h-3.5 text-purple-400" />
                <span>Audio (MP3, WAV, AAC, M4A, FLAC)</span>
              </span>
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
                <Video className="w-3.5 h-3.5 text-indigo-400" />
                <span>Video (MP4, MKV, WebM, MOV)</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Demo sample trigger */}
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
        <span className="text-slate-400 text-sm">Don't have a file ready?</span>
        <button
          onClick={handleLoadDemo}
          disabled={!!loadingStatus}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-purple-300 hover:text-purple-200 text-sm font-medium transition shadow-sm"
        >
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span>Load Demo Synth Song (12s)</span>
        </button>
      </div>
    </div>
  );
};
