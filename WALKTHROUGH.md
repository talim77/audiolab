# AudioLab (VocalCut Studio) — Architecture & Walkthrough

This walkthrough explains the source structure, audio processing pipeline, and deployment flow for **`talim77/audiolab`**.

---

## Repository Structure

```text
audiolab/
├── src/
│   ├── App.tsx                       # Main studio state, file ingestion, undo/export orchestration
│   ├── main.tsx                      # React entrypoint
│   ├── components/
│   │   ├── Navbar.tsx                # Top bar, demo loader & PWA install prompt
│   │   ├── FileUploader.tsx          # Drag-and-drop audio/video uploader + 12s demo synth loader
│   │   ├── WaveformStudio.tsx        # Interactive wavesurfer.js waveform & region selection
│   │   ├── EditingToolbar.tsx        # Trim, cut, merge, fades, gain, normalize & speed controls
│   │   ├── VocalSplitterModal.tsx    # Cloud Demucs / Local WebGPU / DSP Karaoke separator modal
│   │   └── ExportModal.tsx           # MP3 (128/192/320 kbps) & WAV export modal
│   ├── services/
│   │   ├── mediaExtractor.ts         # Browser audio decoding & video-to-AudioBuffer extraction
│   │   ├── audioEditor.ts            # Pure Web Audio buffer trim, cut, merge, fade & gain ops
│   │   ├── audioExporter.ts          # @breezystack/lamejs MP3 encoder & 16-bit WAV serializer
│   │   ├── vocalSeparator.ts         # Gradio Cloud, Local ONNX/WebGPU Demucs & DSP Karaoke engines
│   │   └── demoAudio.ts              # Built-in synthesized 12s demo track generator
│   └── types/
│       └── demucs-web.d.ts           # Type declarations for local neural separation
├── backend/
│   ├── app.py                        # Gradio + Demucs server for Hugging Face Spaces
│   ├── Dockerfile & requirements.txt # Zero-cost 16GB CPU Docker image for HF Spaces
│   └── Demucs_Free_Colab_Server.ipynb# Optional Google Colab T4 GPU notebook
└── .github/workflows/deploy.yml      # Automatic Vite build & GitHub Pages deployment
```

---

## End-to-End Processing Flow

1. **Ingestion (`FileUploader.tsx` -> `mediaExtractor.ts`):**
   - Audio or video files are decoded in-memory into a Web Audio `AudioBuffer` without uploading to any external server unless Cloud AI separation is selected.
2. **Non-Destructive Editing (`WaveformStudio.tsx` + `audioEditor.ts`):**
   - Users drag region handles on the waveform and run trim, cut, append/merge, fade-in/out, volume boost, normalization, or playback rate adjustments on `AudioBuffer` slices.
3. **AI Stem Separation (`VocalSplitterModal.tsx` + `vocalSeparator.ts`):**
   - Supports Cloud AI via `@gradio/client` (connecting to a user-provided HF Space or Colab URL), local WebGPU/WASM `demucs-web`, or instant DSP center-channel karaoke cancellation.
4. **Export (`ExportModal.tsx` + `audioExporter.ts`):**
   - Encodes edited stems directly in the browser to MP3 (`128`, `192`, `320` kbps) or lossless WAV and triggers file download.
