FROM python:3.10-slim

WORKDIR /app

# Install system dependencies including ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download HTDemucs model weights into image for instant boot
RUN python -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs')"

COPY app.py .

EXPOSE 7860

CMD ["python", "app.py"]
