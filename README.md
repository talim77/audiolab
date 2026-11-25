# AudioLab — VocalCut Studio (AI Vocal Separator & MP3 Editor)

**Live Web App / PWA:** [https://talim77.github.io/audiolab/](https://talim77.github.io/audiolab/)  
**Portfolio Hub:** [https://talim77.github.io/portfolio/](https://talim77.github.io/portfolio/)

An installable Progressive Web App (PWA) and Web Audio Studio built with React 19, TypeScript, Vite, and Tailwind CSS. Extract vocals and background music using AI (local WebGPU/WASM or free Hugging Face / Colab Cloud Demucs backend), ingest audio directly from videos, trim/cut/merge clips on an interactive waveform, and export MP3 or lossless WAV tracks.

---

## Key Features

- **3-Mode Vocal & Instrumental Separation:**
  - **Cloud AI Demucs (`@gradio/client`):** Offloads Meta HTDemucs inference to a free Hugging Face Space or Google Colab T4 GPU (`backend/`) for zero-RAM mobile processing.
  - **Local Neural AI (`demucs-web` + `onnxruntime-web`):** Runs Meta HTDemucs locally via WebGPU/WASM with IndexedDB model caching.
  - **Instant DSP Karaoke Mode:** 0.1-second center-channel vocal cancellation with zero model downloads.
- **Zero-Step Video-to-Audio Extraction:** Drop `.mp4`, `.webm`, `.mkv`, `.mov`, `.mp3`, `.wav`, `.aac`, `.m4a`, or `.flac` files directly in the browser.
- **Interactive Waveform Studio (`wavesurfer.js`):** Trim, cut, merge/append clips, configure 0s–5s fade-in/out, boost volume up to 250% or normalize peaks to 98%, and adjust playback tempo (`0.5x`–`2x`).
- **Client-Side Encoding:** Export 128/192/320 kbps MP3 (`@breezystack/lamejs`) or uncompressed 16-bit WAV.
- **Installable Offline PWA:** Configured via `vite-plugin-pwa` and deployed to GitHub Pages via GitHub Actions.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, `wavesurfer.js`
- **Audio & AI:** Web Audio API, `demucs-web`, `onnxruntime-web`, `@gradio/client`, `@breezystack/lamejs`
- **Optional Cloud Backend (`backend/`):** Python, Gradio, Demucs (Docker for Hugging Face Spaces & Google Colab notebook)

---

## Local Development

```bash
npm install
npm run dev
npm run build
npm run preview
```

See [WALKTHROUGH.md](WALKTHROUGH.md) for architecture details and component walkthrough.
