FROM python:3.11-slim

# System deps:
#   ffmpeg, libsndfile  -> audio decode/encode
#   rubberband-cli      -> high-quality pitch shifting (pyrubberband backend)
#   build-essential     -> psycopg / native wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        rubberband-cli \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the CPU-only PyTorch build first so Demucs doesn't drag in the
# multi-GB CUDA wheels. Pin to a known-good pair for demucs 4.x.
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        torch==2.2.2 torchaudio==2.2.2 \
        --index-url https://download.pytorch.org/whl/cpu

# Install Python deps (resolves demucs/pyrubberband/etc. against the CPU torch).
COPY pyproject.toml ./
RUN pip install --no-cache-dir ".[dev]"

COPY . .
RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
