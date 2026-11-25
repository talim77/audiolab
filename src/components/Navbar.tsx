import React, { useEffect, useState } from 'react';
import { Music2, Sparkles, ShieldCheck, Smartphone } from 'lucide-react';

interface NavbarProps {
  onOpenSplitter?: () => void;
  hasAudio: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenSplitter, hasAudio }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      alert('To install on mobile or desktop, tap "Add to Home Screen" or the Install icon in your browser address bar.');
    }
  };

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
            <Music2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg text-white tracking-tight">VocalCut</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
                AI Studio
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">MP3 Editor & Vocal Separator</p>
          </div>
        </div>

        {/* Center / Action Badges */}
        <div className="hidden md:flex items-center space-x-4 text-xs">
          <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>100% Client-Side Privacy</span>
          </span>
          {hasAudio && (
            <button
              onClick={onOpenSplitter}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/40 text-purple-200 hover:border-purple-400 transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span>AI Vocal Separator</span>
            </button>
          )}
        </div>

        {/* Right buttons */}
        <div className="flex items-center space-x-3">
          {!isInstalled && (
            <button
              onClick={handleInstallClick}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium transition"
              title="Install as Android App / PWA"
            >
              <Smartphone className="w-4 h-4 text-indigo-400" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
