"""
AudioLab / VocalCut Studio - Free Cloud AI Backend (Demucs HTDemucs)
Can be hosted for FREE on:
- Hugging Face Spaces (CPU Basic: 16GB RAM)
- Google Colab (Free T4 GPU: 16GB VRAM)
- Local Python Server
"""

import os
import shutil
import uuid
import base64
import subprocess
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import torch

app = FastAPI(title="Demucs Vocal Separation Cloud API", version="1.0.0")

# Enable CORS for web apps (including GitHub Pages)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = Path("./temp_audio")
TEMP_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/")
@app.get("/api/health")
def health_check():
    has_gpu = torch.cuda.is_available()
    device_name = torch.cuda.get_device_name(0) if has_gpu else "CPU (16GB RAM)"
    return {
        "status": "online",
        "service": "VocalCut Demucs AI Server",
        "gpu_available": has_gpu,
        "device": device_name,
        "model": "htdemucs"
    }


@app.post("/api/separate")
async def separate_audio(file: UploadFile = File(...)):
    """
    Separates vocals and background music from an uploaded audio file using Meta HTDemucs.
    Returns base64 encoded audio strings for direct in-browser decoding.
    """
    job_id = str(uuid.uuid4())
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file
    file_ext = Path(file.filename or "audio.mp3").suffix or ".mp3"
    input_file_path = job_dir / f"input{file_ext}"

    try:
        with open(input_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        out_dir = job_dir / "out"
        out_dir.mkdir(parents=True, exist_ok=True)

        # Run Meta Demucs CLI
        # --two-stems=vocals separates into 'vocals' and 'no_vocals' (instrumental)
        device_arg = "cuda" if torch.cuda.is_available() else "cpu"
        cmd = [
            "python", "-m", "demucs.separate",
            "-n", "htdemucs",
            "--two-stems=vocals",
            "-d", device_arg,
            "-o", str(out_dir),
            str(input_file_path)
        ]

        print(f"[{job_id}] Running Demucs separation on {device_arg}...")
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Demucs error: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"Separation failed: {result.stderr[-300:]}")

        # Demucs output path structure: out/htdemucs/{input_basename}/
        input_basename = input_file_path.stem
        model_out_dir = out_dir / "htdemucs" / input_basename

        vocals_file = model_out_dir / "vocals.wav"
        instrumental_file = model_out_dir / "no_vocals.wav"

        if not vocals_file.exists() or not instrumental_file.exists():
            raise HTTPException(status_code=500, detail="Separated audio stems not found.")

        # Read output audio files and encode as base64
        with open(vocals_file, "rb") as f:
            vocals_b64 = base64.b64encode(f.read()).decode("utf-8")

        with open(instrumental_file, "rb") as f:
            inst_b64 = base64.b64encode(f.read()).decode("utf-8")

        return JSONResponse({
            "status": "success",
            "job_id": job_id,
            "format": "wav",
            "vocals_base64": f"data:audio/wav;base64,{vocals_b64}",
            "instrumental_base64": f"data:audio/wav;base64,{inst_b64}"
        })

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Clean up temporary files
        shutil.rmtree(job_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    print(f"Starting Demucs AI Server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
