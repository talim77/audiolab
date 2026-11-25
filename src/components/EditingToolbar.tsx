import React, { useState, useRef } from 'react';
import {
  Scissors,
  Trash2,
  PlusCircle,
  Gauge,
  Sliders,
  Undo2,
  RefreshCw,
  Loader2
} from 'lucide-react';
import {
  trimAudioBuffer,
  cutAudioBuffer,
  mergeAudioBuffers,
  applyFade,
  adjustVolume,
  normalizeAudio,
  changeSpeed
} from '../services/audioEditor';
import { extractAudioFromMedia } from '../services/mediaExtractor';

interface EditingToolbarProps {
  currentBuffer: AudioBuffer;
  selectionStart: number;
  selectionEnd: number;
  onBufferUpdated: (newBuffer: AudioBuffer, actionName: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
}

export const EditingToolbar: React.FC<EditingToolbarProps> = ({
  currentBuffer,
  selectionStart,
  selectionEnd,
  onBufferUpdated,
  canUndo,
  onUndo,
  onReset
}) => {
  const [fadeInDuration, setFadeInDuration] = useState(1.5);
  const [fadeOutDuration, setFadeOutDuration] = useState(1.5);
  const [volumeGain, setVolumeGain] = useState(1.2);
  const [selectedSpeed, setSelectedSpeed] = useState(1.0);
  const [isProcessing, setIsProcessing] = useState(false);

  const appendFileInputRef = useRef<HTMLInputElement>(null);

  // 1. Trim to Selection
  const handleTrim = () => {
    if (selectionEnd <= selectionStart) return;
    try {
      const trimmed = trimAudioBuffer(currentBuffer, selectionStart, selectionEnd);
      onBufferUpdated(trimmed, 'Trimmed to selection');
    } catch (err) {
      alert(`Error trimming: ${err}`);
    }
  };

  // 2. Cut / Delete Selection
  const handleCut = () => {
    if (selectionEnd <= selectionStart) return;
    try {
      const cut = cutAudioBuffer(currentBuffer, selectionStart, selectionEnd);
      onBufferUpdated(cut, 'Cut selection');
    } catch (err) {
      alert(`Error cutting: ${err}`);
    }
  };

  // 3. Append / Merge another file
  const handleAppendFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        setIsProcessing(true);
        const secondMedia = await extractAudioFromMedia(file);
        const merged = mergeAudioBuffers([currentBuffer, secondMedia.audioBuffer]);
        onBufferUpdated(merged, `Appended ${file.name}`);
      } catch (err) {
        alert(`Error appending file: ${err}`);
      } finally {
        setIsProcessing(false);
        if (appendFileInputRef.current) {
          appendFileInputRef.current.value = '';
        }
      }
    }
  };

  // 4. Apply Fade
  const handleApplyFade = () => {
    try {
      const faded = applyFade(currentBuffer, fadeInDuration, fadeOutDuration);
      onBufferUpdated(faded, `Applied Fade (${fadeInDuration}s In, ${fadeOutDuration}s Out)`);
    } catch (err) {
      alert(`Error applying fade: ${err}`);
    }
  };

  // 5. Apply Volume Gain
  const handleApplyGain = () => {
    try {
      const adjusted = adjustVolume(currentBuffer, volumeGain);
      onBufferUpdated(adjusted, `Adjusted Volume to ${(volumeGain * 100).toFixed(0)}%`);
    } catch (err) {
      alert(`Error adjusting volume: ${err}`);
    }
  };

  // 6. Normalize Loudness
  const handleNormalize = () => {
    try {
      const normalized = normalizeAudio(currentBuffer);
      onBufferUpdated(normalized, 'Normalized Loudness (Peak 98%)');
    } catch (err) {
      alert(`Error normalizing: ${err}`);
    }
  };

  // 7. Apply Speed change
  const handleApplySpeed = async (speed: number) => {
    setSelectedSpeed(speed);
    try {
      setIsProcessing(true);
      const stretched = await changeSpeed(currentBuffer, speed);
      onBufferUpdated(stretched, `Changed Speed to ${speed}x`);
    } catch (err) {
      alert(`Error changing speed: ${err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full bg-slate-900/60 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl backdrop-blur-md">
      {/* Header and Undo/Reset */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
        <div className="flex items-center space-x-2">
          <Sliders className="w-5 h-5 text-purple-400" />
          <h3 className="font-semibold text-white text-base">Editing Toolkit</h3>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onUndo}
            disabled={!canUndo || isProcessing}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              canUndo
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
            title="Undo last action"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>

          <button
            onClick={onReset}
            disabled={isProcessing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 border border-rose-800/50 transition"
            title="Reset to original uploaded audio"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Original</span>
          </button>
        </div>
      </div>

      {isProcessing && (
        <div className="flex items-center justify-center space-x-3 p-4 mb-4 rounded-2xl bg-purple-950/40 border border-purple-800/40 text-purple-200 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
          <span>Processing audio buffer offline...</span>
        </div>
      )}

      {/* Grid of Tool Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Cut & Trim */}
        <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between space-y-3">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Selection Edit
            </span>
            <p className="text-xs text-slate-500">Trim to selection or cut it out.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleTrim}
              disabled={isProcessing}
              className="flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition active:scale-95"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Trim</span>
            </button>

            <button
              onClick={handleCut}
              disabled={isProcessing}
              className="flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 hover:text-rose-200 text-slate-300 text-xs font-semibold border border-slate-700 transition active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Cut</span>
            </button>
          </div>
        </div>

        {/* Card 2: Merge / Append */}
        <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between space-y-3">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Merge / Append
            </span>
            <p className="text-xs text-slate-500">Concatenate another audio/video file at the end.</p>
          </div>

          <div>
            <input
              ref={appendFileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={handleAppendFile}
              className="hidden"
            />
            <button
              onClick={() => appendFileInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-500/50 text-indigo-200 text-xs font-semibold transition active:scale-95"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Append Next Track</span>
            </button>
          </div>
        </div>

        {/* Card 3: Fade In / Out */}
        <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between space-y-3">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Smooth Fades
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
              <span>In: {fadeInDuration}s</span>
              <span>Out: {fadeOutDuration}s</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              value={fadeInDuration}
              onChange={(e) => setFadeInDuration(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-purple-500"
              title="Fade In Duration"
            />
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              value={fadeOutDuration}
              onChange={(e) => setFadeOutDuration(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-purple-500"
              title="Fade Out Duration"
            />
          </div>

          <button
            onClick={handleApplyFade}
            disabled={isProcessing}
            className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-medium border border-slate-700 transition"
          >
            Apply Fade
          </button>
        </div>

        {/* Card 4: Volume & Normalize */}
        <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between space-y-3">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Volume & Boost
            </span>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
              <span>Gain: {(volumeGain * 100).toFixed(0)}%</span>
            </div>
          </div>

          <input
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value={volumeGain}
            onChange={(e) => setVolumeGain(parseFloat(e.target.value))}
            className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-purple-500"
          />

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleApplyGain}
              disabled={isProcessing}
              className="py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
            >
              Apply Boost
            </button>
            <button
              onClick={handleNormalize}
              disabled={isProcessing}
              className="py-1.5 rounded-xl bg-purple-950/40 hover:bg-purple-900/50 text-purple-300 text-xs font-medium border border-purple-800/60 transition"
            >
              Normalize
            </button>
          </div>
        </div>
      </div>

      {/* Speed / Tempo Row */}
      <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <Gauge className="w-4 h-4 text-purple-400" />
          <span className="font-medium text-slate-300">Tempo / Speed:</span>
        </div>

        <div className="flex items-center space-x-1.5">
          {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((speed) => (
            <button
              key={speed}
              onClick={() => handleApplySpeed(speed)}
              disabled={isProcessing}
              className={`px-3 py-1 rounded-xl text-xs font-mono transition ${
                selectedSpeed === speed
                  ? 'bg-purple-600 text-white font-bold'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
