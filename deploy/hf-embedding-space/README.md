---
title: AIPC Nomic Embedding API
emoji: 🧭
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# AIPC Nomic Embedding API

Private-by-key OpenAI-compatible embeddings endpoint for AIPC. It runs
`nomic-ai/nomic-embed-text-v1.5` on the free Hugging Face Spaces CPU runtime.

Endpoints:

- `GET /health`
- `POST /v1/embeddings`

Set the Space secret `API_KEY`; clients must send it as a Bearer token.
