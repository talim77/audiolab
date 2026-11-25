import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Scissors
} from 'lucide-react';
import { getAudioContext } from '../services/mediaExtractor';

interface WaveformStudioProps {
  audioBuffer: AudioBuffer;
  selectionStart: number;
  selectionEnd: number;
  onSelectionChange: (start: number, end: number) => void;
  fileName: string;
}

export const WaveformStudio: React.FC<WaveformStudioProps> = ({
  audioBuffer,
  selectionStart,
  selectionEnd,
  onSelectionChange,
  fileName
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Web Audio playback nodes
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startOffsetRef = useRef(0);
  const startTimeRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);

  // Dragging state for region handles
  const isDraggingStart = useRef(false);
  const isDraggingEnd = useRef(false);
  const isDraggingRegion = useRef(false);
  const dragOriginX = useRef(0);
  const dragInitialStart = useRef(0);
  const dragInitialEnd = useRef(0);

  const duration = audioBuffer.duration;

  // Format time MM:SS.ms
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Stop playback
  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Play audio from a given offset
  const playAudio = useCallback((offset: number, playUntil?: number) => {
    stopAudio();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = isMuted ? 0 : volume;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    sourceNodeRef.current = source;
    gainNodeRef.current = gainNode;
    startOffsetRef.current = offset;
    startTimeRef.current = ctx.currentTime;

    if (playUntil && playUntil > offset) {
      source.start(0, offset, playUntil - offset);
    } else {
      source.start(0, offset);
    }

    setIsPlaying(true);

    const updateLoop = () => {
      const elapsed = ctx.currentTime - startTimeRef.current;
      const current = startOffsetRef.current + elapsed;

      if (playUntil && current >= playUntil) {
        stopAudio();
        setCurrentTime(playUntil);
        return;
      }

      if (current >= duration) {
        stopAudio();
        setCurrentTime(0);
        return;
      }

      setCurrentTime(current);
      animFrameRef.current = requestAnimationFrame(updateLoop);
    };

    animFrameRef.current = requestAnimationFrame(updateLoop);
  }, [audioBuffer, duration, isMuted, volume, stopAudio]);

  const togglePlay = () => {
    if (isPlaying) {
      stopAudio();
    } else {
      // If at end, loop to start
      const startAt = currentTime >= duration - 0.05 ? 0 : currentTime;
      playAudio(startAt);
    }
  };

  const playSelection = () => {
    playAudio(selectionStart, selectionEnd);
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(false);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVol;
    }
  };

  const toggleMute = () => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? volume : 0;
    }
    setIsMuted(!isMuted);
  };

  // Convert canvas X coordinate to time in seconds
  const xToTime = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  // Convert time to canvas X coordinate
  const timeToX = useCallback((time: number, width: number) => {
    if (duration === 0) return 0;
    return (time / duration) * width;
  }, [duration]);

  // Render Waveform Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    // Grid / timeline background lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const numLines = 10;
    for (let i = 0; i <= numLines; i++) {
      const x = (i / numLines) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw audio peaks
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;
    const step = Math.ceil(totalSamples / width);
    const amp = height / 2;

    const selStartX = timeToX(selectionStart, width);
    const selEndX = timeToX(selectionEnd, width);
    const currentX = timeToX(currentTime, width);

    // 1. Draw Waveform Peaks
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      const startIdx = i * step;
      const endIdx = Math.min(startIdx + step, totalSamples);

      for (let j = startIdx; j < endIdx; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      if (max < min) {
        min = -0.01;
        max = 0.01;
      }

      const yTop = (1 - max) * amp;
      const yBottom = (1 - min) * amp;

      // Color scheme: unplayed vs played, or inside selection
      const isInsideSelection = i >= selStartX && i <= selEndX;
      const isPlayed = i <= currentX;

      if (isInsideSelection) {
        ctx.fillStyle = isPlayed ? '#a855f7' : '#c084fc';
      } else {
        ctx.fillStyle = isPlayed ? '#6366f1' : '#334155';
      }

      ctx.fillRect(i, yTop, 1, Math.max(1, yBottom - yTop));
    }

    // 2. Draw Selection Overlay & Handles
    ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
    ctx.fillRect(selStartX, 0, selEndX - selStartX, height);

    // Selection boundary lines
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    // Left boundary
    ctx.beginPath();
    ctx.moveTo(selStartX, 0);
    ctx.lineTo(selStartX, height);
    ctx.stroke();

    // Right boundary
    ctx.beginPath();
    ctx.moveTo(selEndX, 0);
    ctx.lineTo(selEndX, height);
    ctx.stroke();

    // Left Handle Pill
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.roundRect(selStartX - 6, 8, 12, 28, 4);
    ctx.fill();

    // Right Handle Pill
    ctx.beginPath();
    ctx.roundRect(selEndX - 6, 8, 12, 28, 4);
    ctx.fill();

    // 3. Draw Playhead line
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, height);
    ctx.stroke();

    // Playhead arrow/cap
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(currentX - 5, 0);
    ctx.lineTo(currentX + 5, 0);
    ctx.lineTo(currentX, 8);
    ctx.closePath();
    ctx.fill();
  }, [audioBuffer, currentTime, selectionStart, selectionEnd, timeToX]);

  // Pointer interaction for selection handles and scrubbing
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const selStartX = timeToX(selectionStart, rect.width);
    const selEndX = timeToX(selectionEnd, rect.width);

    dragOriginX.current = e.clientX;
    dragInitialStart.current = selectionStart;
    dragInitialEnd.current = selectionEnd;

    // Detect if clicking near left handle (+- 10px)
    if (Math.abs(x - selStartX) < 14) {
      isDraggingStart.current = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Detect if clicking near right handle (+- 10px)
    if (Math.abs(x - selEndX) < 14) {
      isDraggingEnd.current = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // If clicking inside region, prepare to drag whole region
    if (x > selStartX + 14 && x < selEndX - 14) {
      isDraggingRegion.current = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Otherwise, click to scrub playhead
    const clickTime = xToTime(e.clientX);
    setCurrentTime(clickTime);
    if (isPlaying) {
      playAudio(clickTime);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingStart.current && !isDraggingEnd.current && !isDraggingRegion.current) return;

    if (isDraggingStart.current) {
      const newStart = Math.max(0, Math.min(xToTime(e.clientX), selectionEnd - 0.1));
      onSelectionChange(newStart, selectionEnd);
    } else if (isDraggingEnd.current) {
      const newEnd = Math.min(duration, Math.max(xToTime(e.clientX), selectionStart + 0.1));
      onSelectionChange(selectionStart, newEnd);
    } else if (isDraggingRegion.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const deltaX = e.clientX - dragOriginX.current;
      const deltaTime = (deltaX / rect.width) * duration;
      const regionLen = dragInitialEnd.current - dragInitialStart.current;

      let newStart = dragInitialStart.current + deltaTime;
      let newEnd = dragInitialEnd.current + deltaTime;

      if (newStart < 0) {
        newStart = 0;
        newEnd = regionLen;
      }
      if (newEnd > duration) {
        newEnd = duration;
        newStart = duration - regionLen;
      }
      onSelectionChange(newStart, newEnd);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingStart.current = false;
    isDraggingEnd.current = false;
    isDraggingRegion.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  // Keyboard shortcut: Space to play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  // Clean up playback on unmount
  useEffect(() => {
    return () => stopAudio();
  }, [stopAudio]);

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-md">
      {/* Top Header: File info and Time readout */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-white font-semibold text-lg truncate max-w-md">{fileName}</h2>
          <div className="flex items-center space-x-3 text-xs text-slate-400 mt-0.5">
            <span>Duration: {formatTime(duration)}</span>
            <span>•</span>
            <span>{audioBuffer.numberOfChannels === 2 ? 'Stereo' : 'Mono'}</span>
            <span>•</span>
            <span>{audioBuffer.sampleRate} Hz</span>
          </div>
        </div>

        {/* Live Time Readout */}
        <div className="flex items-center space-x-2 bg-slate-950/80 px-4 py-2 rounded-xl border border-slate-800 font-mono text-sm">
          <span className="text-purple-400 font-bold">{formatTime(currentTime)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Waveform Canvas Container */}
      <div
        ref={containerRef}
        className="relative w-full h-44 sm:h-52 bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 cursor-crosshair select-none"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="w-full h-full block"
        />

        {/* Ruler Overlay / Markers */}
        <div className="absolute top-1 left-2 text-[10px] text-slate-500 font-mono select-none pointer-events-none">
          00:00
        </div>
        <div className="absolute top-1 right-2 text-[10px] text-slate-500 font-mono select-none pointer-events-none">
          {formatTime(duration)}
        </div>
      </div>

      {/* Region Selection Details & Inputs */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80">
        <div className="flex items-center space-x-2 text-xs text-slate-300">
          <Scissors className="w-4 h-4 text-purple-400" />
          <span className="font-medium">Selected Region:</span>
          <span className="font-mono text-purple-300 font-bold">
            {(selectionEnd - selectionStart).toFixed(2)}s
          </span>
        </div>

        <div className="flex items-center space-x-4 text-xs">
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">Start:</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max={selectionEnd - 0.1}
              value={Number(selectionStart.toFixed(2))}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0 && val < selectionEnd) {
                  onSelectionChange(val, selectionEnd);
                }
              }}
              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono text-center focus:outline-none focus:border-purple-500"
            />
            <span className="text-slate-500">s</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">End:</span>
            <input
              type="number"
              step="0.1"
              min={selectionStart + 0.1}
              max={duration}
              value={Number(selectionEnd.toFixed(2))}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > selectionStart && val <= duration) {
                  onSelectionChange(selectionStart, val);
                }
              }}
              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono text-center focus:outline-none focus:border-purple-500"
            />
            <span className="text-slate-500">s</span>
          </div>

          <button
            onClick={() => onSelectionChange(0, duration)}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            Select All
          </button>
        </div>
      </div>

      {/* Playback & Controls Bar */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        {/* Playback Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              stopAudio();
              setCurrentTime(0);
            }}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition shadow-sm"
            title="Rewind to start"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold transition shadow-lg shadow-purple-600/30 active:scale-95"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-white" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Play</span>
              </>
            )}
          </button>

          <button
            onClick={playSelection}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-purple-950/40 hover:bg-purple-900/50 border border-purple-800/60 text-purple-300 text-xs font-semibold transition"
            title="Play only the selected section"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Play Selection</span>
          </button>
        </div>

        {/* Volume & Zoom Controls */}
        <div className="flex items-center space-x-5">
          {/* Volume */}
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleMute}
              className="text-slate-400 hover:text-white transition"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-20 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
