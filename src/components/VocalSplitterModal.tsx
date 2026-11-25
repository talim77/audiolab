import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Sparkles,
  Zap,
  Cloud,
  Mic,
  Music,
  Play,
  Pause,
  Download,
  CheckCircle2,
  ArrowRight,
  Server,
  HelpCircle,
  KeyRound,
  Eye,
  EyeOff
} from 'lucide-react';
import type {
  SeparationProgress,
  SeparationResult
} from '../services/vocalSeparator';
import {
  separateWithDemucsAI,
  separateWithDSP,
  separateWithCloudAI,
  checkCloudHealth,
  normalizeCloudTarget
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
  const isMobile =
    typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  const [mode, setMode] = useState<'cloud' | 'dsp' | 'ai'>('cloud');
  const [isRunning, setIsRunning] = useState(false);
  const [progressInfo, setProgressInfo] = useState<SeparationProgress | null>(null);
  const [result, setResult] = useState<SeparationResult | null>(null);

  // Cloud server URL state (auto-migrates legacy Gradio 3.x defaults in localStorage)
  const [cloudUrl, setCloudUrl] = useState<string>(() => {
    const normalized = normalizeCloudTarget(localStorage.getItem('vocalcut_cloud_url'));
    localStorage.setItem('vocalcut_cloud_url', normalized);
    return normalized;
  });

  // Optional Hugging Face token (saved strictly in user's browser localStorage, never in git)
  const [hfToken, setHfToken] = useState<string>(() => {
    return localStorage.getItem('vocalcut_hf_token') || '';
  });
  const [showToken, setShowToken] = useState(false);

  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverHealthStatus, setServerHealthStatus] = useState<
    'idle' | 'checking' | 'online' | 'offline'
  >('idle');

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

  const startMixerPlayback = useCallback(
    (offset: number = 0) => {
      if (!result) return;
      stopMixerPlayback();

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();

      const vSource = ctx.createBufferSource();
      vSource.buffer = result.vocalsBuffer;
      const vGain = ctx.createGain();
      vGain.gain.value = vocalsMuted ? 0 : vocalsVolume;
      vSource.connect(vGain);
      vGain.connect(ctx.destination);
      vocalSourceRef.current = vSource;
      vocalGainRef.current = vGain;

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
    },
    [result, vocalsMuted, instMuted, vocalsVolume, instVolume, stopMixerPlayback]
  );

  const togglePlayStems = () => {
    if (isPlaying) {
      stopMixerPlayback();
    } else {
      const startAt =
        currentTime >= (result?.vocalsBuffer.duration || 0) - 0.1 ? 0 : currentTime;
      startMixerPlayback(startAt);
    }
  };

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

  const handleTestServer = async () => {
    setServerHealthStatus('checking');
    const clean = normalizeCloudTarget(cloudUrl);
    const isOk = await checkCloudHealth(clean);
    setServerHealthStatus(isOk ? 'online' : 'offline');
    if (isOk) {
      localStorage.setItem('vocalcut_cloud_url', clean);
    }
  };

  const handleStartSeparation = async () => {
    setIsRunning(true);
    setResult(null);
    stopMixerPlayback();

    try {
      if (mode === 'cloud') {
        const target = normalizeCloudTarget(cloudUrl);
        setCloudUrl(target);
        localStorage.setItem('vocalcut_cloud_url', target);
        if (hfToken.trim()) {
          localStorage.setItem('vocalcut_hf_token', hfToken.trim());
        } else {
          localStorage.removeItem('vocalcut_hf_token');
        }

        const res = await separateWithCloudAI(
          audioBuffer,
          target,
          (p) => setProgressInfo(p),
          hfToken.trim() || undefined
        );
        setResult(res);
      } else if (mode === 'dsp') {
        setProgressInfo({
          phase: 'separating',
          progress: 50,
          message: 'Applying center phase cancellation...'
        });
        await new Promise((r) => setTimeout(r, 100));
        const res = separateWithDSP(audioBuffer);
        setResult(res);
        setProgressInfo({
          phase: 'done',
          progress: 100,
          message: 'Instant Karaoke split complete!'
        });
      } else {
        if (isMobile) {
          const proceed = window.confirm(
            'Notice: Running local neural network inside a mobile browser uses 1.5GB RAM and may crash the tab. Cloud AI or Instant Karaoke is recommended on Android. Do you still want to proceed?'
          );
          if (!proceed) {
            setIsRunning(false);
            return;
          }
        }
        const res = await separateWithDemucsAI(audioBuffer, (p) => {
          setProgressInfo(p);
        });
        setResult(res);
      }
    } catch (err) {
      alert(`Separation error: ${err instanceof Error ? err.message : String(err)}`);
      setProgressInfo({
        phase: 'error',
        progress: 0,
        message: 'Failed to complete separation.'
      });
    } finally {
      setIsRunning(false);
    }
  };

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
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <div
            onClick={() => !isRunning && setMode('cloud')}
            className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
              mode === 'cloud'
                ? 'bg-purple-950/30 border-purple-500/60 shadow-lg shadow-purple-500/10'
                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center space-x-2 text-sm font-semibold text-white">
                  <Cloud className="w-4 h-4 text-purple-400" />
                  <span>Free Cloud AI (Demucs)</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium">
                  {isMobile ? '⭐ Best for Mobile' : 'Recommended'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Runs Demucs AI on verified cloud servers with auto-fallback. Uses 0 MB phone RAM, crash-free on Android.
              </p>
            </div>
          </div>

          <div
            onClick={() => !isRunning && setMode('dsp')}
            className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
              mode === 'dsp'
                ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center space-x-2 text-sm font-semibold text-white">
                  <Zap className="w-4 h-4 text-indigo-400" />
                  <span>Instant Karaoke (DSP)</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-medium">
                  0.1s Zero-Wait
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Instant center-channel phase inversion. Zero network download, 0 MB memory spike. 100% offline.
              </p>
            </div>
          </div>

          <div
            onClick={() => !isRunning && setMode('ai')}
            className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
              mode === 'ai'
                ? 'bg-pink-950/30 border-pink-500/60 shadow-lg shadow-pink-500/10'
                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center space-x-2 text-sm font-semibold text-white">
                  <Server className="w-4 h-4 text-pink-400" />
                  <span>Local WebGPU AI</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                  PC / High RAM
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Runs Demucs ONNX inside browser memory. Requires 2GB+ free RAM (best for laptops & desktop GPUs).
              </p>
            </div>
          </div>
        </div>

        {/* Cloud Server Configuration Panel */}
        {mode === 'cloud' && (
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 mb-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
                <Server className="w-3.5 h-3.5 text-purple-400" />
                <span>Cloud AI Engine:</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'auto', label: 'Auto (Smart Fallback)' },
                  { id: 'csukuangfj/music-source-separation', label: 'Fast 2-Stem' },
                  { id: 'teamup-tech/Demucs', label: 'HTDemucs 4-Stem' }
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => {
                      setCloudUrl(preset.id);
                      localStorage.setItem('vocalcut_cloud_url', preset.id);
                      setServerHealthStatus('idle');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                      cloudUrl === preset.id
                        ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                value={cloudUrl}
                onChange={(e) => {
                  setCloudUrl(e.target.value);
                  setServerHealthStatus('idle');
                }}
                placeholder="auto or Space ID (e.g. csukuangfj/music-source-separation) or Colab URL"
                className="flex-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
              />

              <button
                type="button"
                onClick={handleTestServer}
                disabled={serverHealthStatus === 'checking'}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition whitespace-nowrap"
              >
                {serverHealthStatus === 'checking'
                  ? 'Testing...'
                  : serverHealthStatus === 'online'
                  ? '🟢 Online'
                  : serverHealthStatus === 'offline'
                  ? '🔴 Offline'
                  : 'Test Server'}
              </button>
            </div>

            {/* Optional Personal Hugging Face Token (stored locally in device browser only) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1">
              <div className="flex items-center space-x-2 text-xs text-slate-400 w-full sm:w-auto flex-1">
                <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <div className="relative flex-1">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={hfToken}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHfToken(val);
                      if (val.trim()) {
                        localStorage.setItem('vocalcut_hf_token', val.trim());
                      } else {
                        localStorage.removeItem('vocalcut_hf_token');
                      }
                    }}
                    placeholder="Optional Hugging Face Token (hf_... saved locally on your device)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3 pr-9 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    title={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowServerConfig(!showServerConfig)}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center space-x-1 shrink-0"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Personal Colab GPU Setup</span>
              </button>
            </div>

            {showServerConfig && (
              <div className="mt-2 pt-3 border-t border-slate-800 text-xs text-slate-300 space-y-2">
                <p className="font-semibold text-purple-300">
                  Private GPU Server Setup (Free Google Colab):
                </p>
                <p className="text-slate-400">
                  Hugging Face requires a PRO plan to host new Docker/Gradio Spaces, so we built{' '}
                  <strong className="text-white">Auto Cloud AI</strong> using active Gradio 4/6 servers. For your own private dedicated NVIDIA T4 GPU (8s separation), open{' '}
                  <code className="text-purple-300 font-mono">backend/Demucs_Free_Colab_Server.ipynb</code> in Google Colab, click "Run All", and paste its HTTPS URL above.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action Button & Progress */}
        {!result && (
          <div className="flex flex-col items-center justify-center p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl text-center space-y-4">
            {isRunning ? (
              <div className="w-full max-w-md space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>{progressInfo?.message || 'Processing...'}</span>
                  <span className="font-mono text-purple-400 font-bold">
                    {progressInfo?.progress || 0}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${progressInfo?.progress || 0}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {mode === 'cloud'
                    ? 'Processing on remote server (0 MB phone RAM used). Please wait...'
                    : mode === 'dsp'
                    ? 'Computing phase cancellation in 0.1s...'
                    : 'Running neural inference. Keep tab active.'}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-300">
                  Ready to split <span className="text-purple-300 font-semibold">{fileName}</span> (
                  {audioBuffer.duration.toFixed(1)}s)
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
                <span>
                  Stems separated successfully! (
                  {result.mode === 'cloud'
                    ? `Cloud AI${result.providerLabel ? `: ${result.providerLabel}` : ''}`
                    : result.mode === 'ai'
                    ? 'Local Demucs'
                    : 'Instant DSP'}
                  )
                </span>
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
