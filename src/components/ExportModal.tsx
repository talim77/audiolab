import React, { useState } from 'react';
import { X, Download, Check, Loader2 } from 'lucide-react';
import { audioBufferToMp3, audioBufferToWav, downloadBlob } from '../services/audioExporter';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer;
  defaultName: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  defaultName
}) => {
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3');
  const [bitrate, setBitrate] = useState<number>(320);
  const [fileName, setFileName] = useState<string>(defaultName || 'edited_track');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);

  if (!isOpen) return null;

  const durationSec = audioBuffer.duration;
  const estSizeMB =
    format === 'mp3'
      ? ((durationSec * (bitrate * 1000)) / 8 / 1024 / 1024).toFixed(2)
      : ((durationSec * audioBuffer.sampleRate * audioBuffer.numberOfChannels * 2) / 1024 / 1024).toFixed(2);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setProgress(5);

      let blob: Blob;
      let finalName = fileName.trim() || 'audio_track';

      if (format === 'mp3') {
        blob = await audioBufferToMp3(audioBuffer, bitrate, (pct) => setProgress(pct));
        if (!finalName.toLowerCase().endsWith('.mp3')) finalName += '.mp3';
      } else {
        setProgress(50);
        blob = audioBufferToWav(audioBuffer);
        setProgress(100);
        if (!finalName.toLowerCase().endsWith('.wav')) finalName += '.wav';
      }

      downloadBlob(blob, finalName);
      onClose();
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-2xl pointer-events-none" />

        <button
          onClick={onClose}
          disabled={isExporting}
          className="absolute top-6 right-6 p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Download className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">Export Audio</h3>
            <p className="text-xs text-slate-400">Save your edited track to your device</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* File Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              File Name
            </label>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 focus-within:border-purple-500 transition">
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                disabled={isExporting}
                className="w-full bg-transparent text-white text-sm focus:outline-none"
                placeholder="audio_track"
              />
              <span className="text-xs font-mono text-purple-400 font-semibold uppercase">
                .{format}
              </span>
            </div>
          </div>

          {/* Format Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Export Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormat('mp3')}
                disabled={isExporting}
                className={`p-3.5 rounded-2xl border text-left transition ${
                  format === 'mp3'
                    ? 'bg-purple-950/30 border-purple-500/60 shadow-lg shadow-purple-500/10'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-white">MP3</span>
                  {format === 'mp3' && <Check className="w-4 h-4 text-purple-400" />}
                </div>
                <p className="text-[11px] text-slate-400">Compressed, universal playback</p>
              </button>

              <button
                type="button"
                onClick={() => setFormat('wav')}
                disabled={isExporting}
                className={`p-3.5 rounded-2xl border text-left transition ${
                  format === 'wav'
                    ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-white">WAV</span>
                  {format === 'wav' && <Check className="w-4 h-4 text-indigo-400" />}
                </div>
                <p className="text-[11px] text-slate-400">Lossless 16-bit uncompressed</p>
              </button>
            </div>
          </div>

          {/* MP3 Bitrate Options */}
          {format === 'mp3' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Bitrate Quality
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { rate: 128, label: '128 kbps', desc: 'Compact' },
                  { rate: 192, label: '192 kbps', desc: 'High' },
                  { rate: 320, label: '320 kbps', desc: 'Studio' }
                ].map((item) => (
                  <button
                    key={item.rate}
                    type="button"
                    onClick={() => setBitrate(item.rate)}
                    disabled={isExporting}
                    className={`py-2 px-3 rounded-xl border text-center transition ${
                      bitrate === item.rate
                        ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold font-mono">{item.label}</div>
                    <div className="text-[10px] text-slate-500">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* File summary */}
          <div className="flex items-center justify-between text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 text-slate-400">
            <span>Duration: {durationSec.toFixed(1)}s</span>
            <span>Estimated Size: ~{estSizeMB} MB</span>
          </div>

          {/* Progress / Download Button */}
          {isExporting ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  <span>Encoding {format.toUpperCase()} in browser...</span>
                </span>
                <span className="font-mono text-purple-400 font-bold">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleExport}
              className="w-full flex items-center justify-center space-x-2 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold shadow-lg shadow-purple-600/30 transition active:scale-95"
            >
              <Download className="w-5 h-5" />
              <span>Download {format.toUpperCase()}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
