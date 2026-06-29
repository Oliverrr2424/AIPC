@echo off
setlocal
cd /d D:\AIPC
"C:\Program Files\nodejs\node.exe" scripts\crawl-parts.mjs --target 50 --output D:\AIPC\src\data\crawledParts.json --report D:\AIPC\data\catalog-crawl-report.json >> D:\AIPC\logs\catalog-crawl.log 2>&1
exit /b %ERRORLEVEL%
