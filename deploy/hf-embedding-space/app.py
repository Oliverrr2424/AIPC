import hmac
import os
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL_ID = os.getenv("MODEL_ID", "nomic-ai/nomic-embed-text-v1.5")
API_KEY = os.getenv("API_KEY", "")
model: SentenceTransformer | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    model = SentenceTransformer(MODEL_ID, trust_remote_code=True, device="cpu")
    yield


app = FastAPI(title="AIPC Nomic Embedding API", lifespan=lifespan)


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: str | None = None
    dimensions: int = Field(default=384, ge=64, le=768)


def authorize(authorization: str | None = Header(default=None)) -> None:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="API_KEY is not configured")
    expected = f"Bearer {API_KEY}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid bearer token")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "aipc-nomic-embedding", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ready" if model is not None else "loading", "model": MODEL_ID}


@app.post("/v1/embeddings", dependencies=[Depends(authorize)])
def embeddings(request: EmbeddingRequest) -> dict:
    if model is None:
        raise HTTPException(status_code=503, detail="Model is still loading")
    texts = [request.input] if isinstance(request.input, str) else request.input
    if not texts or any(not text.strip() for text in texts):
        raise HTTPException(status_code=400, detail="input must contain non-empty text")

    started = time.perf_counter()
    vectors = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    vectors = vectors[:, : request.dimensions]
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.maximum(norms, 1e-12)

    return {
        "object": "list",
        "model": MODEL_ID,
        "data": [
            {"object": "embedding", "index": index, "embedding": vector.tolist()}
            for index, vector in enumerate(vectors)
        ],
        "usage": {
            "prompt_tokens": sum(len(text.split()) for text in texts),
            "total_tokens": sum(len(text.split()) for text in texts),
            "latency_ms": round((time.perf_counter() - started) * 1000),
        },
    }
