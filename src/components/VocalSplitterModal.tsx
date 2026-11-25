import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Sparkles,
  Zap,
  Mic,
  Music,
  Play,
  Pause,
  Download,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import type {
  SeparationProgress,
  SeparationResult
} from '../services/vocalSeparator';
import {
  separateWithDemucsAI,
  separateWithDSP
} from '../services/vocalSeparator';
import { audioBufferToMp3, downloadBlob } from '../services/audioExporter';
import { getAudioContext } from '../services/mediaExtractor';

interface VocalSplitterModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer;
  fileName: string;
  onSendToStudio: (stemBuffer: AudioBuffer, stemName: string) => void;
}

export const VocalSplitterModal: React.FC<VocalSplitterModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  fileName,
  onSendToStudio
}) => {
  const [mode, setMode] = useState<'ai' | 'dsp'>('ai');
  const [isRunning, setIsRunning] = useState(false);
  const [progressInfo, setProgressInfo] = useState<SeparationProgress | null>(null);
  const [result, setResult] = useState<SeparationResult | null>(null);

  // Playback state for stems mixer
  const [isPlaying, setIsPlaying] = useState(false);
  const [vocalsVolume, setVocalsVolume] = useState(1);
  const [instVolume, setInstVolume] = useState(1);
  const [vocalsMuted, setVocalsMuted] = useState(false);
  const [instMuted, setInstMuted] = useState(false);

  const vocalSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const instSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const vocalGainRef = useRef<GainNode | null>(null);
  const instGainRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef(0);
  const startOffsetRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const animFrameRef = useRef<number | null>(null);

  const stopMixerPlayback = useCallback(() => {
    if (vocalSourceRef.current) {
      try {
        vocalSourceRef.current.stop();
        vocalSourceRef.current.disconnect();
      } catch {}
      vocalSourceRef.current = null;
    }
    if (instSourceRef.current) {
      try {
        instSourceRef.current.stop();
        instSourceRef.current.disconnect();
      } catch {}
      instSourceRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startMixerPlayback = useCallback((offset: number = 0) => {
    if (!result) return;
    stopMixerPlayback();

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    // Vocals track
    const vSource = ctx.createBufferSource();
    vSource.buffer = result.vocalsBuffer;
    const vGain = ctx.createGain();
    vGain.gain.value = vocalsMuted ? 0 : vocalsVolume;
    vSource.connect(vGain);
    vGain.connect(ctx.destination);
    vocalSourceRef.current = vSource;
    vocalGainRef.current = vGain;

    // Instrumental track
    const iSource = ctx.createBufferSource();
    iSource.buffer = result.instrumentalBuffer;
    const iGain = ctx.createGain();
    iGain.gain.value = instMuted ? 0 : instVolume;
    iSource.connect(iGain);
    iGain.connect(ctx.destination);
    instSourceRef.current = iSource;
    instGainRef.current = iGain;

    vSource.start(0, offset);
    iSource.start(0, offset);

    startOffsetRef.current = offset;
    startTimeRef.current = ctx.currentTime;
    setIsPlaying(true);

    const updateLoop = () => {
      const elapsed = ctx.currentTime - startTimeRef.current;
      const cur = startOffsetRef.current + elapsed;
      if (cur >= result.vocalsBuffer.duration) {
        stopMixerPlayback();
        setCurrentTime(0);
        return;
      }
      setCurrentTime(cur);
      animFrameRef.current = requestAnimationFrame(updateLoop);
    };

    animFrameRef.current = requestAnimationFrame(updateLoop);
  }, [result, vocalsMuted, instMuted, vocalsVolume, instVolume, stopMixerPlayback]);

  const togglePlayStems = () => {
    if (isPlaying) {
      stopMixerPlayback();
    } else {
      const startAt = currentTime >= (result?.vocalsBuffer.duration || 0) - 0.1 ? 0 : currentTime;
      startMixerPlayback(startAt);
    }
  };

  // Update gains in real time
  useEffect(() => {
    if (vocalGainRef.current) {
      vocalGainRef.current.gain.value = vocalsMuted ? 0 : vocalsVolume;
    }
  }, [vocalsMuted, vocalsVolume]);

  useEffect(() => {
    if (instGainRef.current) {
      instGainRef.current.gain.value = instMuted ? 0 : instVolume;
    }
  }, [instMuted, instVolume]);

  useEffect(() => {
    return () => stopMixerPlayback();
  }, [stopMixerPlayback]);

  // Execute Separation
  const handleStartSeparation = async () => {
    setIsRunning(true);
    setResult(null);
    stopMixerPlayback();

    try {
      if (mode === 'dsp') {
        setProgressInfo({ phase: 'separating', progress: 50, message: 'Applying center phase cancellation...' });
        // Tiny timeout to let UI render
        await new Promise((r) => setTimeout(r, 100));
        const res = separateWithDSP(audioBuffer);
        setResult(res);
        setProgressInfo({ phase: 'done', progress: 100, message: 'Instant Karaoke split complete!' });
      } else {
        const res = await separateWithDemucsAI(audioBuffer, (p) => {
          setProgressInfo(p);
        });
        setResult(res);
      }
    } catch (err) {
      alert(`Separation error: ${err instanceof Error ? err.message : String(err)}`);
      setProgressInfo({ phase: 'error', progress: 0, message: 'Failed to complete separation.' });
    } finally {
      setIsRunning(false);
    }
  };

  // Download Stems
  const handleDownloadStem = async (stemBuffer: AudioBuffer, suffix: string) => {
    try {
      const blob = await audioBufferToMp3(stemBuffer, 320);
      downloadBlob(blob, `${fileName}_${suffix}.mp3`);
    } catch (err) {
      alert(`Export error: ${err}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden my-8">
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={() => {
            stopMixerPlayback();
            onClose();
          }}
          className="absolute top-6 right-6 p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              AI Vocal & Background Music Separator
            </h2>
            <p className="text-sm text-slate-400">
              Isolate vocals (Acapella) and background instruments (Karaoke) in high fidelity
            </p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div
            onClick={() => !isRunning && setMode('ai')}
            className={`p-4 rounded-2xl border cursor-pointer transition ${
              mode === 'ai'
                ? 'bg-purple-950/30 border-purple-500/60 shadow-lg shadow-purple-500/10'
                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center space-x-2 text-sm font-semibold text-white">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>AI Neural Separation (Demucs)</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium">
                Studio Quality
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Meta HTDemucs model running locally via WebGPU/WASM. Separates complex vocals & music with neural precision. Cached permanently in your browser.
            </p>
          </div>

          <div
            onClick={() => !isRunning && setMode('dsp')}
            className={`p-4 rounded-2xl border cursor-pointer transition ${
              mode === 'dsp'
                ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center space-x-2 text-sm font-semibold text-white">
                <Zap className="w-4 h-4 text-indigo-400" />
                <span>Instant Karaoke Filter (DSP)</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-medium">
                0.1s Zero-Wait
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Instant out-of-phase center cancellation. Removes center lead vocals immediately without downloading AI models. Works on any low-end device.
            </p>
          </div>
        </div>

        {/* Action Button & Progress */}
        {!result && (
          <div className="flex flex-col items-center justify-center p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl text-center space-y-4">
            {isRunning ? (
              <div className="w-full max-w-md space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>{progressInfo?.message || 'Processing...'}</span>
                  <span className="font-mono text-purple-400 font-bold">{progressInfo?.progress || 0}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${progressInfo?.progress || 0}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {mode === 'ai'
                    ? 'Processing client-side in browser. Keep this tab active.'
                    : 'Computing phase inversion matrix...'}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-300">
                  Ready to split <span className="text-purple-300 font-semibold">{fileName}</span> ({audioBuffer.duration.toFixed(1)}s)
                </p>
                <button
                  onClick={handleStartSeparation}
                  className="flex items-center space-x-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold shadow-lg shadow-purple-600/30 transition active:scale-95"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>Start Separation Now</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Result Stems Mixer Console */}
        {result && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-emerald-950/30 border border-emerald-800/40 p-3 rounded-2xl text-xs text-emerald-300">
              <span className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Stems separated successfully! ({result.mode === 'ai' ? 'Demucs AI' : 'Instant DSP'})</span>
              </span>
              <button
                onClick={handleStartSeparation}
                disabled={isRunning}
                className="text-slate-400 hover:text-white underline text-xs"
              >
                Re-run
              </button>
            </div>

            {/* Synchronized Master Playback */}
            <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
              <div className="flex items-center space-x-3">
                <button
                  onClick={togglePlayStems}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition shadow-md shadow-purple-600/20"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pause Stems</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>Play Stems Together</span>
                    </>
                  )}
                </button>
                <span className="text-xs text-slate-400 font-mono">
                  {currentTime.toFixed(1)}s / {result.vocalsBuffer.duration.toFixed(1)}s
                </span>
              </div>
              <span className="text-xs text-slate-400 hidden sm:block">
                Adjust faders below to hear vocals vs music balance in real-time!
              </span>
            </div>

            {/* Stems Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Stem 1: Vocals */}
              <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-pink-500/20 text-pink-400 border border-pink-500/30">
                      <Mic className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-sm">Isolated Vocals</h4>
                      <p className="text-[11px] text-slate-400">Acapella / Voice Track</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setVocalsMuted(!vocalsMuted)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                      vocalsMuted
                        ? 'bg-rose-950/40 text-rose-300 border-rose-800/60'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {vocalsMuted ? 'Muted' : 'Mute'}
                  </button>
                </div>

                {/* Volume slider */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Volume</span>
                    <span>{(vocalsVolume * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={vocalsVolume}
                    onChange={(e) => setVocalsVolume(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-pink-500"
                  />
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => handleDownloadStem(result.vocalsBuffer, 'vocals')}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP3</span>
                  </button>

                  <button
                    onClick={() => {
                      stopMixerPlayback();
                      onSendToStudio(result.vocalsBuffer, `${fileName}_Vocals`);
                      onClose();
                    }}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-pink-600/30 hover:bg-pink-600/40 border border-pink-500/50 text-pink-200 text-xs font-semibold transition"
                  >
                    <span>Edit in Studio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Stem 2: Instrumental */}
              <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                      <Music className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-sm">Background Music</h4>
                      <p className="text-[11px] text-slate-400">Karaoke / Instrumental Track</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setInstMuted(!instMuted)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                      instMuted
                        ? 'bg-rose-950/40 text-rose-300 border-rose-800/60'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {instMuted ? 'Muted' : 'Mute'}
                  </button>
                </div>

                {/* Volume slider */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Volume</span>
                    <span>{(instVolume * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={instVolume}
                    onChange={(e) => setInstVolume(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => handleDownloadStem(result.instrumentalBuffer, 'instrumental')}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP3</span>
                  </button>

                  <button
                    onClick={() => {
                      stopMixerPlayback();
                      onSendToStudio(result.instrumentalBuffer, `${fileName}_Instrumental`);
                      onClose();
                    }}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-500/50 text-indigo-200 text-xs font-semibold transition"
                  >
                    <span>Edit in Studio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
