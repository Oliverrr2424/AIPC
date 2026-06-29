@echo off
set OLLAMA_HOST=100.103.114.92:11434
set OLLAMA_MODELS=E:\OllamaModels
set OLLAMA_KEEP_ALIVE=24h
if not exist D:\AIPC\data mkdir D:\AIPC\data
"C:\Users\Nemo\AppData\Local\Programs\Ollama\ollama.exe" serve 1>>D:\AIPC\data\ollama-serve.stdout.log 2>>D:\AIPC\data\ollama-serve.stderr.log
