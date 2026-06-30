FROM python:3.11-slim

ENV HF_HOME=/data/huggingface \
    MODEL_ID=nomic-ai/nomic-embed-text-v1.5 \
    PORT=7860 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Bake the model into the image so a Space wake-up does not need to download it.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)"

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
