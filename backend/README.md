# ☁️ Free Demucs AI Cloud Backend

This folder allows you to run Meta's **HTDemucs AI Vocal Separator** on a **100% FREE cloud server**, so your mobile phones and low-RAM devices don't crash and get ultra-fast studio separation!

---

## ⚡ Option 1: Hugging Face Spaces (100% Free Forever, 16GB RAM) - RECOMMENDED

1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) and click **"Create new Space"**.
2. Give it a name (e.g. `my-vocal-separator`).
3. Select **Space SDK: Docker** (Blank).
4. Choose **Free CPU (16 GB RAM, 2 vCPUs)**.
5. In your new Space, upload the 3 files from this folder:
   - `app.py`
   - `requirements.txt`
   - `Dockerfile`
6. Click **Commit**. Hugging Face will automatically build and start your server in ~2 minutes!
7. Copy your Space URL:
   - Click the 3 dots in the top right of your Space -> **Embed this Space** -> Direct URL (e.g. `https://yourusername-my-vocal-separator.hf.space`).
8. Paste that URL into the **VocalCut Studio** web app under **AI Vocal Separator > Cloud Server URL**!

---

## 🚀 Option 2: Google Colab (Free NVIDIA T4 GPU - 8s Separation!)

1. Open [Google Colab](https://colab.research.google.com).
2. Upload `Demucs_Free_Colab_Server.ipynb`.
3. Go to **Runtime > Change runtime type** and select **T4 GPU** (Free).
4. Click **Run All**.
5. It will output a public HTTPS URL (e.g. `https://xxxx.loca.lt`).
6. Paste that URL into your web app and enjoy GPU-accelerated separation!
