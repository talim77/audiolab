import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { FileUploader } from './components/FileUploader';
import { WaveformStudio } from './components/WaveformStudio';
import { EditingToolbar } from './components/EditingToolbar';
import { VocalSplitterModal } from './components/VocalSplitterModal';
import { ExportModal } from './components/ExportModal';
import { extractAudioFromMedia, type ExtractedMedia } from './services/mediaExtractor';
import { cloneAudioBuffer } from './services/audioEditor';
import {
  Sparkles,
  Download,
  FolderOpen,
  CheckCircle2,
  Video,
  Music,
  Shield
} from 'lucide-react';

export function App() {
  const [media, setMedia] = useState<ExtractedMedia | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [undoStack, setUndoStack] = useState<AudioBuffer[]>([]);

  // Selection boundaries (in seconds)
  const [selectionStart, setSelectionStart] = useState<number>(0);
  const [selectionEnd, setSelectionEnd] = useState<number>(0);

  // Modals
  const [isSplitterOpen, setIsSplitterOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Status notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // When a new file is loaded
  const handleMediaLoaded = (newMedia: ExtractedMedia) => {
    setMedia(newMedia);
    setOriginalBuffer(newMedia.audioBuffer);
    setUndoStack([]);
    setSelectionStart(0);
    setSelectionEnd(newMedia.audioBuffer.duration);

    if (newMedia.isVideo) {
      showToast(`🎬 Video detected! Audio track extracted automatically from "${newMedia.name}"`);
    } else {
      showToast(`🎵 Audio loaded: "${newMedia.name}" (${newMedia.duration.toFixed(1)}s)`);
    }
  };

  // When buffer is updated by editing operations
  const handleBufferUpdated = (newBuffer: AudioBuffer, actionName: string) => {
    if (!media) return;
    setUndoStack((prev) => [...prev, media.audioBuffer]);
    setMedia({
      ...media,
      audioBuffer: newBuffer,
      duration: newBuffer.duration
    });

    // Reset selection if out of bounds
    if (selectionEnd > newBuffer.duration || selectionStart >= newBuffer.duration) {
      setSelectionStart(0);
      setSelectionEnd(newBuffer.duration);
    }

    showToast(`✓ ${actionName}`);
  };

  // Undo action
  const handleUndo = () => {
    if (undoStack.length === 0 || !media) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setMedia({
      ...media,
      audioBuffer: previous,
      duration: previous.duration
    });
    setSelectionStart(0);
    setSelectionEnd(previous.duration);
    showToast('Reverted last edit');
  };

  // Reset to original
  const handleReset = () => {
    if (!originalBuffer || !media) return;
    if (window.confirm('Reset all changes back to original file?')) {
      setUndoStack((prev) => [...prev, media.audioBuffer]);
      setMedia({
        ...media,
        audioBuffer: cloneAudioBuffer(originalBuffer),
        duration: originalBuffer.duration
      });
      setSelectionStart(0);
      setSelectionEnd(originalBuffer.duration);
      showToast('Reset to original audio');
    }
  };

  // Handle loading isolated stem into main editor
  const handleSendStemToStudio = (stemBuffer: AudioBuffer, stemName: string) => {
    if (!media) return;
    setUndoStack((prev) => [...prev, media.audioBuffer]);
    setMedia({
      ...media,
      audioBuffer: stemBuffer,
      name: stemName,
      duration: stemBuffer.duration
    });
    setSelectionStart(0);
    setSelectionEnd(stemBuffer.duration);
    showToast(`Loaded ${stemName} into studio workspace`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-purple-600 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 flex items-center space-x-2 bg-purple-950/90 border border-purple-500/50 text-purple-200 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md animate-fade-in text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navbar */}
      <Navbar
        hasAudio={!!media}
        onOpenSplitter={() => setIsSplitterOpen(true)}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col justify-start">
        {!media ? (
          /* Empty State: Hero & File Uploader */
          <div className="flex flex-col items-center justify-center my-auto py-12">
            <div className="text-center max-w-3xl mb-8">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-semibold mb-4">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Next-Gen Audio Studio & AI Vocal Separator</span>
              </div>
              <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight mb-4">
                Edit MP3s & Separate Vocals{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400">
                  Directly In Your Browser
                </span>
              </h1>
              <p className="text-slate-400 text-base sm:text-lg max-w-2xl mx-auto">
                Extract vocals & background music using neural AI, trim, cut, merge clips, and convert
                videos to audio with zero server uploads. Fast, private, and works offline.
              </p>
            </div>

            {/* File Ingestion Zone */}
            <FileUploader onMediaLoaded={handleMediaLoaded} />

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl w-full mt-12">
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 text-center sm:text-left">
                <div className="w-10 h-10 rounded-xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center mb-3 text-purple-400 mx-auto sm:mx-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-white font-semibold text-sm mb-1">AI Vocal Separation</h3>
                <p className="text-slate-400 text-xs">
                  Isolate vocals (Acapella) and background instruments (Karaoke) via Meta's HTDemucs AI.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 text-center sm:text-left">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-3 text-indigo-400 mx-auto sm:mx-0">
                  <Video className="w-5 h-5" />
                </div>
                <h3 className="text-white font-semibold text-sm mb-1">Zero-Click Video Ingestion</h3>
                <p className="text-slate-400 text-xs">
                  Drop MP4, WebM, or MKV video files; audio is extracted automatically in-memory.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 text-center sm:text-left">
                <div className="w-10 h-10 rounded-xl bg-pink-600/10 border border-pink-500/20 flex items-center justify-center mb-3 text-pink-400 mx-auto sm:mx-0">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="text-white font-semibold text-sm mb-1">100% Privacy & PWA</h3>
                <p className="text-slate-400 text-xs">
                  Nothing ever leaves your computer or phone. Install as an app and work completely offline.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Active Studio Workstation */
          <div className="space-y-6">
            {/* Action Bar Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-3xl border border-slate-800 backdrop-blur-md">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  {media.isVideo ? <Video className="w-5 h-5" /> : <Music className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white text-base truncate max-w-xs sm:max-w-md">
                      {media.name}
                    </span>
                    {media.isVideo && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                        Extracted from Video
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">
                    Workspace Audio: {(media.audioBuffer.duration).toFixed(2)}s
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-3">
                {/* Change File */}
                <label className="cursor-pointer flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition">
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open New File</span>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        extractAudioFromMedia(e.target.files[0]).then(handleMediaLoaded);
                      }
                    }}
                    className="hidden"
                  />
                </label>

                {/* AI Vocal Splitter Button */}
                <button
                  onClick={() => setIsSplitterOpen(true)}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold shadow-lg shadow-purple-600/30 transition active:scale-95 animate-pulse"
                >
                  <Sparkles className="w-4 h-4 fill-white" />
                  <span>AI Vocal Separator</span>
                </button>

                {/* Export Button */}
                <button
                  onClick={() => setIsExportOpen(true)}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Audio</span>
                </button>
              </div>
            </div>

            {/* Waveform Visualizer & Player */}
            <WaveformStudio
              audioBuffer={media.audioBuffer}
              selectionStart={selectionStart}
              selectionEnd={selectionEnd}
              onSelectionChange={(s, e) => {
                setSelectionStart(s);
                setSelectionEnd(e);
              }}
              fileName={media.name}
            />

            {/* Editing Toolkit */}
            <EditingToolbar
              currentBuffer={media.audioBuffer}
              selectionStart={selectionStart}
              selectionEnd={selectionEnd}
              onBufferUpdated={handleBufferUpdated}
              canUndo={undoStack.length > 0}
              onUndo={handleUndo}
              onReset={handleReset}
            />
          </div>
        )}
      </main>

      {/* Vocal Separator Modal */}
      {media && (
        <VocalSplitterModal
          isOpen={isSplitterOpen}
          onClose={() => setIsSplitterOpen(false)}
          audioBuffer={media.audioBuffer}
          fileName={media.name}
          onSendToStudio={handleSendStemToStudio}
        />
      )}

      {/* Export Modal */}
      {media && (
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          audioBuffer={media.audioBuffer}
          defaultName={media.name}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <div className="flex items-center space-x-2">
            <span>VocalCut Audio Studio</span>
            <span>•</span>
            <span className="text-emerald-400 font-medium">Privacy Protected</span>
            <span>•</span>
            <span>Web Audio & Demucs AI</span>
          </div>
          <div>
            Built with React, WebGPU & Web Audio API • Installable PWA
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
